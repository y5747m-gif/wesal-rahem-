import type { Locale, NotificationChannel, UserId } from '@wesal/shared';
import type { NotificationContent } from '../../domain/notification/templates';
import type { NotificationRecordInput } from './repositories';

/** منافذ الخدمات الخارجية — تُنفَّذ في البنية التحتية وتُستبدل بسهولة في الاختبارات. */

export const SYMBOLS = {
  Clock: Symbol('CLOCK'),
  IdGenerator: Symbol('ID_GENERATOR'),
  TokenService: Symbol('TOKEN_SERVICE'),
  OtpService: Symbol('OTP_SERVICE'),
  FieldEncryption: Symbol('FIELD_ENCRYPTION'),
  NotificationDispatcher: Symbol('NOTIFICATION_DISPATCHER'),
  MessageChannel: Symbol('MESSAGE_CHANNEL'),
  AuditLogger: Symbol('AUDIT_LOGGER'),
  UrlBuilder: Symbol('URL_BUILDER'),
  Repositories: Symbol('REPOSITORIES'),
  ScheduleService: Symbol('SCHEDULE_SERVICE'),
  StatusEvaluator: Symbol('STATUS_EVALUATOR'),
} as const;

export interface IdGenerator {
  uuid(): string;
  /** رمز دعوة/رابط عالي العشوائية (يُخزَّن كبصمة فقط) */
  randomToken(bytes?: number): string;
  /** رمز تحقق رقمي بطول محدد */
  numericCode(length: number): string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
}

export interface AccessTokenClaims {
  userId: UserId;
  sessionId: string;
  locale: Locale;
}

export interface TokenService {
  /** يوقّع رمز وصول قصير العمر يحمل معرّف الجلسة (لإمكانية الإبطال) */
  signAccessToken(claims: AccessTokenClaims): { token: string; expiresIn: number };
  /** يرمي DomainError إن كان الرمز غير صالح أو منتهيًا */
  verifyAccessToken(token: string): AccessTokenClaims;
  /** رمز تحديث عالي العشوائية — لا يُخزَّن إلا كبصمة SHA-256 */
  generateRefreshToken(): string;
  hashRefreshToken(token: string): string;
  refreshExpiresAt(from: Date): Date;
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' | 'rate_limited' };

export interface OtpService {
  /**
   * يُنشئ رمزًا ويخزّن بصمته. في وضع التطوير يُعاد الرمز لتسهيل التجربة،
   * وفي الإنتاج يُرسل عبر القناة المختارة ولا يُعاد أبدًا.
   */
  issue(input: {
    phone: string;
    purpose: 'login';
    ip?: string | null;
    userAgent?: string | null;
    locale: Locale;
  }): Promise<{ expiresAt: Date; resendAfterSeconds: number; devCode?: string }>;
  verify(input: { phone: string; code: string }): Promise<OtpVerifyResult>;
}

export interface FieldEncryptionService {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string | null;
  /** بصمة ثابتة للبحث والمقارنة بدون كشف القيمة */
  hmac(value: string): string;
  mask(phone: string): string;
}

export interface DeliveryResult {
  status: 'sent' | 'failed' | 'suppressed';
  providerMessageId?: string;
  error?: string;
}

export interface NotificationDispatcher {
  /** يرسل إشعارًا عبر القناة المناسبة (push/sms/in_app) مع إعادة محاولة وتسجيل حالة التسليم */
  dispatch(input: {
    record: NotificationRecordInput & { id?: string };
    content: NotificationContent;
    channel: NotificationChannel;
    recipient: { userId?: UserId | null; deviceId?: string | null; addressEncrypted?: string | null };
  }): Promise<DeliveryResult>;
}

/** قناة إرسال الروابط العامة (دعوة جهة موثوقة / رابط "أنا بخير") */
export interface MessageChannel {
  sendInviteLink(input: { toPhoneEncrypted: string; fullName: string; acceptUrl: string; locale: Locale }): Promise<DeliveryResult>;
  sendWebCheckInLink(input: { toPhoneEncrypted: string; fullName: string; checkInUrl: string; locale: Locale }): Promise<DeliveryResult>;
}

export interface AuditContext {
  actorUserId?: UserId | null;
  actorKind?: 'user' | 'trusted_contact' | 'system' | 'worker';
  action: string;
  entityType: string;
  entityId?: string | null;
  personId?: string | null;
  familyId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditLogger {
  log(ctx: AuditContext): Promise<void>;
}

export interface UrlBuilder {
  inviteAcceptUrl(token: string): string;
  webCheckInUrl(token: string): string;
  personUrl(personId: string): string;
}
