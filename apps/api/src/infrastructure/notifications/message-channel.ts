import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale } from '@wesal/shared';
import { getMessages } from '@wesal/shared';
import type { DeliveryResult, FieldEncryptionService, MessageChannel } from '../../application/ports/services';
import { SYMBOLS } from '../../application/ports/services';
import { CONFIG, type AppConfig } from '../../config/configuration';

/**
 * قناة إرسال الروابط العامة (دعوة جهة موثوقة / رابط "أنا بخير").
 *
 * الوثيقة تترك قناة تنبيه الطرف الثالث سؤالًا مفتوحًا (SMS أم واتساب أم Push).
 * لذلك نُجرّد القناة هنا: في التطوير تُطبع الرسالة والرابط في السجل، وفي الإنتاج
 * تُربط بمزوّد SMS أو WhatsApp Business API بتبديل `SMS_DRIVER` وتنفيذ الواجهة نفسها.
 */
@Injectable()
export class LoggingMessageChannel implements MessageChannel {
  private readonly logger = new Logger('MessageChannel');

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
  ) {}

  async sendInviteLink(input: {
    toPhoneEncrypted: string;
    fullName: string;
    acceptUrl: string;
    locale: Locale;
  }): Promise<DeliveryResult> {
    const m = getMessages(input.locale);
    const phone = this.crypto.decrypt(input.toPhoneEncrypted);
    const text =
      input.locale === 'ar'
        ? `${m.trustedContacts.acceptPageTitle('عائلتك', input.fullName)}\n${m.trustedContacts.acceptPageBody(input.fullName)}\n${input.acceptUrl}\n${m.trustedContacts.withdrawAnytime}`
        : `${m.trustedContacts.acceptPageTitle('your family', input.fullName)}\n${m.trustedContacts.acceptPageBody(input.fullName)}\n${input.acceptUrl}\n${m.trustedContacts.withdrawAnytime}`;

    if (this.config.notifications.smsDriver !== 'sms_provider') {
      this.logger.log(
        `✉️ [sms:log] invite → ${maskPhone(phone)}\n${text.replace(/\n/g, ' | ')}`,
      );
      return { status: 'sent', providerMessageId: `log-invite:${Date.now()}` };
    }

    this.logger.warn(`SMS_DRIVER=sms_provider but no SMS adapter registered; invite link not delivered (${input.acceptUrl})`);
    return { status: 'failed', error: 'sms provider adapter not configured' };
  }

  async sendWebCheckInLink(input: {
    toPhoneEncrypted: string;
    fullName: string;
    checkInUrl: string;
    locale: Locale;
  }): Promise<DeliveryResult> {
    const m = getMessages(input.locale);
    const phone = this.crypto.decrypt(input.toPhoneEncrypted);
    const text = `${m.notifications.webCheckInBody(input.fullName)}\n${m.notifications.webCheckInButton}: ${input.checkInUrl}`;

    if (this.config.notifications.smsDriver !== 'sms_provider') {
      this.logger.log(`✉️ [sms:log] web check-in → ${maskPhone(phone)}\n${text.replace(/\n/g, ' | ')}`);
      return { status: 'sent', providerMessageId: `log-fine:${Date.now()}` };
    }

    this.logger.warn(`SMS_DRIVER=sms_provider but no SMS adapter registered; check-in link not delivered (${input.checkInUrl})`);
    return { status: 'failed', error: 'sms provider adapter not configured' };
  }
}

function maskPhone(phone: string | null): string {
  if (!phone) return '***';
  return phone.length > 5 ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : '***';
}
