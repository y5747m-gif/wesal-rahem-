/**
 * سجل الاطمئنان (check_ins) ومحاولات التواصل.
 * ملاحظة مهمة: لا نقرأ سجل المكالمات (ممنوع على iOS ومقيّد على Google Play).
 * الاعتماد على زر "اتصل" ثم سؤال المستخدم عند العودة: "هل تم الاطمئنان؟"
 */
export const CheckInMethod = {
  /** اتصال هاتفي */
  Call: 'call',
  /** رسالة نصية أو تطبيق محادثة */
  Message: 'message',
  /** زيارة */
  Visit: 'visit',
  /** لقاء عائلي */
  InPerson: 'in_person',
  /** عبر رابط "أنا بخير" من المتصفح (بدون تثبيت التطبيق) */
  WebLink: 'web_link',
  /** رد برقم "1" على الرسالة */
  SmsReply: 'sms_reply',
  /** زر "أنا بخير" في وضع كبار السن */
  SeniorButton: 'senior_button',
  /** تأكيد من جهة موثوقة → يوقف كل التنبيهات فورًا */
  TrustedContact: 'trusted_contact',
  /** إدخال يدوي من المستخدم */
  Manual: 'manual',
} as const;

export type CheckInMethod = (typeof CheckInMethod)[keyof typeof CheckInMethod];

export const ALL_CHECK_IN_METHODS: readonly CheckInMethod[] = Object.freeze(
  Object.values(CheckInMethod),
);

export const CheckInStatus = {
  /** تم الاطمئنان ❤️ */
  Reassured: 'reassured',
  /** اتصلت ولم يرد — تُسجَّل كمحاولة وتُعاد لاحقًا */
  CalledNoAnswer: 'called_no_answer',
  /** مؤجَّل (لاحقًا ⏰) */
  Snoozed: 'snoozed',
} as const;

export type CheckInStatus = (typeof CheckInStatus)[keyof typeof CheckInStatus];

/** من أكّد الاطمئنان؟ */
export const ConfirmedByKind = {
  Owner: 'owner',
  FamilyMember: 'family_member',
  TrustedContact: 'trusted_contact',
  PersonSelf: 'person_self',
  System: 'system',
} as const;

export type ConfirmedByKind = (typeof ConfirmedByKind)[keyof typeof ConfirmedByKind];

export const AttemptOutcome = {
  NoAnswer: 'no_answer',
  Answered: 'answered',
  Busy: 'busy',
  Unreachable: 'unreachable',
  WillRetry: 'will_retry',
} as const;

export type AttemptOutcome = (typeof AttemptOutcome)[keyof typeof AttemptOutcome];

export interface CheckInRecord {
  id: string;
  personId: string;
  entryId?: string | null;
  /** لحظة الاطمئنان الفعلية (قد تسبق المزامنة بساعات عند العمل دون اتصال) */
  occurredAt: string;
  method: CheckInMethod;
  status: CheckInStatus;
  confirmedByKind: ConfirmedByKind;
  confirmedById?: string | null;
  notes?: string | null;
  /** مفتاح عدم التكرار — يجعل إعادة الإرسال أثناء المزامنة آمنة */
  idempotencyKey: string;
  createdAt: string;
}
