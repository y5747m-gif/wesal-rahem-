import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Locale,
  NotificationAction,
  NotificationAudience,
  NotificationChannel,
  NotificationTemplate,
  UserId,
} from '@wesal/shared';
import { getMessages } from '@wesal/shared';
import type { EscalationStage } from '@wesal/shared';
import type { PersonRecord, ScheduleEntryRecord, UserRecord } from '../ports/records';
import type { NotificationRepository } from '../ports/repositories';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import { SYMBOLS, type NotificationDispatcher } from '../ports/services';
import {
  buildCheckInDone,
  buildPersonIsFine,
  buildReminderDue,
  buildReminderRetry,
  buildTrustedContactAlert,
  buildUnverifiedForOwner,
  type NotificationContent,
} from '../../domain/notification/templates';
import { Clock } from '../../domain/shared/clock';

/**
 * خدمة الإشعارات — تبني المحتوى من القوالب المعتمدة، تحفظه (Idempotency) ثم تُسلّمه.
 *
 * قواعد غير قابلة للتفاوض:
 *  - "لم يتم التحقق" بسبب نسيان المستخدم → إشعار للمستخدم **فقط**، ولا شيء لأي طرف ثالث.
 *  - تنبيه الجهة الموثوقة لا يُبنى هنا إلا باستدعاء صريح من محرّك التصعيد بعد اجتياز
 *    بوابة الموافقة (consent + قبول الدعوة + حدود + ساعات الهدوء).
 *  - النبرة إنسانية دائمًا: لا لغة تخويف ولا استنتاج خطر.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('NotificationService');

  constructor(
    @Inject(REPOSITORIES.notifications) private readonly notifications: NotificationRepository,
    @Inject(SYMBOLS.NotificationDispatcher) private readonly dispatcher: NotificationDispatcher,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
  ) {}

  /** 1) تذكير عند الموعد — الأزرار: اتصل الآن / تم الاطمئنان / لاحقًا */
  async sendDueReminder(input: {
    user: UserRecord;
    person: PersonRecord;
    entry: ScheduleEntryRecord;
    relationshipLabel: string;
  }): Promise<void> {
    const content = buildReminderDue({
      personId: input.person.id,
      personName: input.person.displayName,
      relationshipLabel: input.relationshipLabel,
      entryId: input.entry.id,
      timezone: input.person.timezone,
      locale: input.user.locale,
    });
    await this.persistAndDispatch({
      content,
      channel: 'push',
      audience: 'owner',
      userId: input.user.id,
      personId: input.person.id,
      entryId: input.entry.id,
      stage: 1,
      idempotencyKey: `reminder.due:${input.entry.id}`,
    });
  }

  /** 2) إعادة محاولة بعد المهلة — بلا تأنيب */
  async sendRetryReminder(input: {
    user: UserRecord;
    person: PersonRecord;
    entry: ScheduleEntryRecord;
  }): Promise<void> {
    const content = buildReminderRetry({
      personId: input.person.id,
      personName: input.person.displayName,
      entryId: input.entry.id,
      timezone: input.person.timezone,
      locale: input.user.locale,
    });
    await this.persistAndDispatch({
      content,
      channel: 'push',
      audience: 'owner',
      userId: input.user.id,
      personId: input.person.id,
      entryId: input.entry.id,
      stage: 2,
      idempotencyKey: `reminder.retry:${input.entry.id}`,
    });
  }

  /** ✅ تغذية راجعة إيجابية بعد تسجيل الاطمئنان */
  async sendCheckInConfirmation(input: {
    user: UserRecord;
    person: PersonRecord;
    occurredAt: Date;
  }): Promise<void> {
    const content = buildCheckInDone({
      personId: input.person.id,
      personName: input.person.displayName,
      timezone: input.person.timezone,
      locale: input.user.locale,
    });
    await this.persistAndDispatch({
      content,
      channel: 'in_app',
      audience: 'owner',
      userId: input.user.id,
      personId: input.person.id,
      entryId: null,
      stage: null,
      idempotencyKey: `check_in.done:${input.person.id}:${input.occurredAt.toISOString()}`,
    });
  }

  /** 🟠 إشعار "لم يتم التحقق" للمستخدم نفسه فقط (السبب الأول: نسي التسجيل) */
  async sendUnverifiedToOwner(input: {
    user: UserRecord;
    person: PersonRecord;
    entry: ScheduleEntryRecord;
  }): Promise<void> {
    const content = buildUnverifiedForOwner({
      personId: input.person.id,
      personName: input.person.displayName,
      entryId: input.entry.id,
      timezone: input.person.timezone,
      locale: input.user.locale,
    });
    await this.persistAndDispatch({
      content,
      channel: 'push',
      audience: 'owner',
      userId: input.user.id,
      personId: input.person.id,
      entryId: input.entry.id,
      stage: null,
      idempotencyKey: `unverified.owner:${input.entry.id}`,
    });
  }

  /**
   * 3–4) تنبيه الجهة الموثوقة — النص المعتمد حرفيًا.
   * ⚠️ يُستدعى فقط من محرّك التصعيد بعد اجتياز بوابة الموافقة.
   */
  async sendTrustedContactAlert(input: {
    person: PersonRecord;
    entry: ScheduleEntryRecord;
    contact: { id: string; userId: UserId | null; fullName: string; phone: string };
    stage: EscalationStage;
    locale: Locale;
    confirmUrl: string;
  }): Promise<void> {
    const content = buildTrustedContactAlert({
      personId: input.person.id,
      personName: input.person.displayName,
      entryId: input.entry.id,
      timezone: input.person.timezone,
      locale: input.locale,
      confirmUrl: input.confirmUrl,
    });
    await this.persistAndDispatch({
      content,
      channel: input.contact.userId ? 'push' : 'sms',
      audience: 'trusted_contact',
      userId: input.contact.userId,
      personId: input.person.id,
      entryId: input.entry.id,
      stage: input.stage,
      idempotencyKey: `trusted.alert:${input.entry.id}:${input.stage}:${input.contact.id}`,
    });
  }

  /** ❤️ رسالة العائلة عندما يضغط الشخص "أنا بخير" */
  async sendPersonIsFine(input: {
    person: PersonRecord;
    recipients: UserRecord[];
    verifiedAt: Date;
  }): Promise<void> {
    for (const recipient of input.recipients) {
      const content = buildPersonIsFine({
        personId: input.person.id,
        personName: input.person.displayName,
        timezone: input.person.timezone,
        locale: recipient.locale,
        verifiedAt: input.verifiedAt,
      });
      await this.persistAndDispatch({
        content,
        channel: 'push',
        audience: 'owner',
        userId: recipient.id,
        personId: input.person.id,
        entryId: null,
        stage: null,
        idempotencyKey: `person.fine:${input.person.id}:${input.verifiedAt.toISOString()}:${recipient.id}`,
      });
    }
  }

  /**
   * إرشاد الطوارئ — يُعرض عند وجود قلق حقيقي فقط، وبصيغة توجيهية لا استنتاجية:
   * "وصال لا يحل محل الطوارئ".
   */
  async sendEmergencyGuidance(input: { user: UserRecord; person: PersonRecord; entry: ScheduleEntryRecord }): Promise<void> {
    const m = getMessages(input.user.locale);
    const content: NotificationContent = {
      templateKey: 'reminder.retry' as NotificationTemplate,
      locale: input.user.locale,
      title: m.escalation.emergencyGuidanceTitle,
      body: `${m.escalation.emergencyGuidanceBody} ${m.escalation.notADangerStatement}`,
      actions: [
        { key: 'call_now', label: m.actions.callNow, personId: input.person.id },
        { key: 'open_person', label: input.person.displayName, personId: input.person.id },
      ],
      data: { personId: input.person.id, entryId: input.entry.id, guidance: 'emergency' },
    };
    await this.persistAndDispatch({
      content,
      channel: 'in_app',
      audience: 'owner',
      userId: input.user.id,
      personId: input.person.id,
      entryId: input.entry.id,
      stage: 4,
      idempotencyKey: `emergency.guidance:${input.entry.id}`,
    });
  }

  /** الإيقاف الفوري: إلغاء كل التنبيهات المعلّقة لشخص بعد تأكيد الاطمئنان */
  async cancelPendingForPerson(personId: string, reason: string): Promise<number> {
    const cancelled = await this.notifications.cancelPendingForPerson(personId, reason);
    if (cancelled > 0) this.logger.log(`Cancelled ${cancelled} pending notifications for ${personId} (${reason})`);
    return cancelled;
  }

  private async persistAndDispatch(input: {
    content: NotificationContent;
    channel: NotificationChannel;
    audience: NotificationAudience;
    userId: UserId | null;
    personId: string | null;
    entryId: string | null;
    stage: EscalationStage | null;
    idempotencyKey: string;
  }): Promise<void> {
    const now = this.clock.now();
    await this.dispatcher.dispatch({
      record: {
        userId: input.userId,
        deviceId: null,
        personId: input.personId,
        entryId: input.entryId,
        invitationId: null,
        channel: input.channel,
        audience: input.audience,
        templateKey: input.content.templateKey,
        locale: input.content.locale,
        title: input.content.title,
        body: input.content.body,
        actionsJson: JSON.stringify(input.content.actions satisfies NotificationAction[]),
        dataJson: JSON.stringify(input.content.data),
        stage: input.stage,
        status: 'queued',
        scheduledFor: now,
        idempotencyKey: input.idempotencyKey,
        recipientAddressEncrypted: null,
      },
      content: input.content,
      channel: input.channel,
      recipient: { userId: input.userId, deviceId: null, addressEncrypted: null },
    });
  }
}

/** يُستخدم في الاختبارات للتحقق من أن الرسائل مبنية من القوالب المعتمدة */
export const TEMPLATES_IN_USE = {
  reminderDue: 'reminder.due',
  reminderRetry: 'reminder.retry',
  checkInDone: 'check_in.done',
  unverifiedOwnerOnly: 'unverified.owner_only',
  trustedAlert: 'trusted_contact.alert',
  personIsFine: 'person.is_fine',
} as const;
