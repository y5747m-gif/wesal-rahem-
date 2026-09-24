import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@wesal/shared';
import type { NotificationContent } from '../../domain/notification/templates';
import type {
  DeviceRepository,
  NotificationRecordInput,
  NotificationRepository,
} from '../../application/ports/repositories';
import type { DeliveryResult, NotificationDispatcher } from '../../application/ports/services';
import { REPOSITORIES } from '../persistence/repository-tokens';
import { CONFIG, type AppConfig } from '../../config/configuration';

/**
 * مُرسِل الإشعارات — يحفظ الإشعار أولًا (Idempotency) ثم يحاول تسليمه.
 *
 * الموثوقية:
 *  - مفتاح عدم تكرار يمنع إرسال الإشعار نفسه مرتين.
 *  - إعادة محاولة مع Backoff أُسّي (1 → 2 → 4 دقائق) بحد أقصى 3 محاولات.
 *  - تتبع حالة التسليم (queued → sent → delivered / failed / cancelled).
 *
 * ⚠️ في هذه البيئة `NOTIFICATION_DRIVER=log`: يُسجَّل الإشعار ويظهر في صندوق
 *    التطبيق الداخلي (in_app) — وهو كافٍ لاختبار التجربة كاملة. للإنتاج الفعلي
 *    يُربط FCM/APNs عبر مزوّد الدفع (انظر docs/NOTIFICATIONS.md).
 */
@Injectable()
export class WesalNotificationDispatcher implements NotificationDispatcher {
  private readonly logger = new Logger('Notifications');
  private static readonly MAX_ATTEMPTS = 3;

  constructor(
    @Inject(REPOSITORIES.notifications) private readonly notifications: NotificationRepository,
    @Inject(REPOSITORIES.devices) private readonly devices: DeviceRepository,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async dispatch(input: {
    record: NotificationRecordInput & { id?: string };
    content: NotificationContent;
    channel: NotificationChannel;
    recipient: { userId?: string | null; deviceId?: string | null; addressEncrypted?: string | null };
  }): Promise<DeliveryResult> {
    const record = await this.notifications.create({ ...input.record, channel: input.channel });

    // سُجِّل مسبقًا ونُفِّذ → لا إعادة إرسال (منع التكرار)
    if (record.status !== 'queued') {
      return { status: 'suppressed', error: `already ${record.status}` };
    }

    try {
      const result = await this.deliver(record.id, input.channel, input.recipient, input.content);
      if (result.status === 'sent') {
        await this.notifications.updateStatus(record.id, {
          status: 'sent',
          sentAt: new Date(),
          attempts: record.attempts + 1,
        });
      } else if (result.status === 'suppressed') {
        await this.notifications.updateStatus(record.id, { status: 'cancelled', lastError: result.error ?? 'suppressed' });
      } else {
        await this.scheduleRetryOrFail(record.id, record.attempts + 1, result.error ?? 'delivery failed');
      }
      return result;
    } catch (error) {
      const message = (error as Error).message;
      await this.scheduleRetryOrFail(record.id, record.attempts + 1, message);
      return { status: 'failed', error: message };
    }
  }

  private async deliver(
    notificationId: string,
    channel: NotificationChannel,
    recipient: { userId?: string | null; deviceId?: string | null; addressEncrypted?: string | null },
    content: NotificationContent,
  ): Promise<DeliveryResult> {
    switch (channel) {
      case 'in_app':
        // محفوظ في القاعدة ويظهر في صندوق الإشعارات داخل التطبيق
        return { status: 'sent', providerMessageId: notificationId };

      case 'push': {
        if (!recipient.userId) return { status: 'suppressed', error: 'no recipient user' };
        const devices = await this.devices.findActiveByUser(recipient.userId);
        const targets = devices.filter((d) => d.pushToken && !d.revokedAt);
        if (targets.length === 0) {
          // لا أجهزة دفع → يبقى الإشعار داخل التطبيق (in_app) دون فشل
          this.logger.debug(`No push devices for user; keeping notification ${notificationId} in-app`);
          return { status: 'sent', providerMessageId: `in-app:${notificationId}` };
        }
        if (this.config.notifications.driver !== 'push') {
          this.logger.log(
            `🔔 [push:log] ${content.title} — ${content.body} (devices=${targets.length}, id=${notificationId})`,
          );
          return { status: 'sent', providerMessageId: `log:${notificationId}` };
        }
        return this.sendViaPushProvider(targets.map((t) => t.pushToken as string), content, notificationId);
      }

      case 'sms':
      case 'whatsapp': {
        if (!recipient.addressEncrypted) return { status: 'suppressed', error: 'no recipient address' };
        if (this.config.notifications.smsDriver !== 'sms_provider') {
          this.logger.log(`📨 [sms:log] ${content.title} — ${content.body} (id=${notificationId})`);
          return { status: 'sent', providerMessageId: `log-sms:${notificationId}` };
        }
        return this.sendViaSmsProvider(recipient.addressEncrypted, content, notificationId);
      }

      case 'email':
      default:
        return { status: 'suppressed', error: `channel not supported yet: ${channel}` };
    }
  }

  /**
   * نقطة الربط بمزوّد الدفع (FCM/APNs).
   * تُنفَّذ عبر `@wesal/push-fcm` في النشر الفعلي؛ هنا نرجع فشلًا واضحًا حتى لا
   * يظن أحد أن الرسالة وصلت.
   */
  private async sendViaPushProvider(
    _tokens: string[],
    content: NotificationContent,
    notificationId: string,
  ): Promise<DeliveryResult> {
    this.logger.warn(
      `NOTIFICATION_DRIVER=push but no push provider adapter is registered (id=${notificationId}, title="${content.title}")`,
    );
    return { status: 'failed', error: 'push provider adapter not configured' };
  }

  private async sendViaSmsProvider(
    _addressEncrypted: string,
    content: NotificationContent,
    notificationId: string,
  ): Promise<DeliveryResult> {
    this.logger.warn(
      `SMS_DRIVER=sms_provider but no SMS adapter is registered (id=${notificationId}, title="${content.title}")`,
    );
    return { status: 'failed', error: 'sms provider adapter not configured' };
  }

  private async scheduleRetryOrFail(notificationId: string, attempts: number, error: string): Promise<void> {
    if (attempts >= WesalNotificationDispatcher.MAX_ATTEMPTS) {
      await this.notifications.updateStatus(notificationId, {
        status: 'failed',
        attempts,
        failedAt: new Date(),
        lastError: error.slice(0, 500),
      });
      this.logger.error(`Notification ${notificationId} failed permanently: ${error}`);
      return;
    }
    // Backoff أُسّي: 1، 2، 4 دقائق
    const backoffMinutes = 2 ** (attempts - 1);
    await this.notifications.updateStatus(notificationId, {
      status: 'queued',
      attempts,
      lastError: error.slice(0, 500),
      scheduledFor: new Date(Date.now() + backoffMinutes * 60_000),
    });
    this.logger.warn(`Notification ${notificationId} retry #${attempts} in ${backoffMinutes}m: ${error}`);
  }
}
