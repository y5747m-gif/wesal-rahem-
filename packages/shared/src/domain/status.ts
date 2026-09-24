import type { PersonId } from './ids';

/**
 * حالات الشخص في وصال.
 * ⚠️ قاعدة غير قابلة للتفاوض: لا توجد حالة تعني "وفاة" أو "خطر مؤكد".
 * "لم يتم التحقق" تعني فقط أنه لم يُسجَّل اطمئنان — قد يكون نائمًا أو مسافرًا أو هاتفه مغلقًا.
 */
export const PersonStatus = {
  /** 🟢 تم تسجيل الاطمئنان */
  Checked: 'checked',
  /** ⚪ لم يحن موعد الاطمئنان بعد */
  Upcoming: 'upcoming',
  /** 🟡 حان وقت الاطمئنان */
  Due: 'due',
  /** 🟠 انتهى الموعد وفترة السماح دون تسجيل */
  Unverified: 'unverified',
  /** 🔴 وصل إلى مرحلة "يحتاج متابعة" (تُستخدم باعتدال شديد) */
  NeedsFollowUp: 'needs_followup',
  /** ⚫ إدخال يدوي من شخص مخوّل فقط — تتوقف بعده كل التذكيرات */
  DeceasedReported: 'deceased_reported',
  /** ⏸️ متوقف مؤقتًا (سفر/إيقاف) — لا مواعيد ولا تذكيرات */
  Paused: 'paused',
} as const;

export type PersonStatus = (typeof PersonStatus)[keyof typeof PersonStatus];

export const ALL_PERSON_STATUSES: readonly PersonStatus[] = Object.freeze(
  Object.values(PersonStatus),
);

/**
 * أولوية العرض على الشاشة الرئيسية: الأعلى أولًا.
 * الترتيب إنساني: من يحتاج متابعة، ثم من لم يتم التحقق، ثم من حان وقته.
 */
export const STATUS_PRIORITY: Readonly<Record<PersonStatus, number>> = Object.freeze({
  [PersonStatus.NeedsFollowUp]: 0,
  [PersonStatus.Unverified]: 1,
  [PersonStatus.Due]: 2,
  [PersonStatus.Paused]: 3,
  [PersonStatus.Upcoming]: 4,
  [PersonStatus.Checked]: 5,
  [PersonStatus.DeceasedReported]: 6,
});

/** حالات تعتبر "تحتاج إجراء من المستخدم اليوم" */
export const ACTIONABLE_STATUSES: readonly PersonStatus[] = Object.freeze([
  PersonStatus.NeedsFollowUp,
  PersonStatus.Unverified,
  PersonStatus.Due,
]);

export function isActionable(status: PersonStatus): boolean {
  return ACTIONABLE_STATUSES.includes(status);
}

/** سببان مختلفان لـ"لم يتم التحقق" — التمييز مهم لأن أحدهما فقط قد يدخل مسار التصعيد */
export const UnverifiedReason = {
  /** المستخدم لم يسجّل اطمئنانًا (ربما نسي الاتصال) → تذكيره فقط، ولا يُرسل شيء لأي طرف ثالث */
  OwnerDidNotCheckIn: 'owner_did_not_check_in',
  /** الشخص المُتابَع لم يرد أو لم يضغط "أنا بخير" → وحدها قد تدخل مسار التصعيد وبشرط الموافقة */
  PersonDidNotRespond: 'person_did_not_respond',
} as const;

export type UnverifiedReason = (typeof UnverifiedReason)[keyof typeof UnverifiedReason];

export interface PersonStatusSnapshot {
  personId: PersonId;
  status: PersonStatus;
  /** سبب "لم يتم التحقق" إن وُجد — لا يُستخدم أبدًا كدليل على خطر */
  unverifiedReason?: UnverifiedReason;
  /** آخر اطمئنان مسجّل (ISO 8601) */
  lastCheckInAt?: string;
  /** الموعد التالي (ISO 8601) */
  nextEntryAt?: string;
}
