/**
 * نموذج الجدول الأسبوعي (WESAL WEEK).
 *
 * المبادئ:
 * - الجدول يُخزَّن كقاعدة أسبوعية (أيام + أوقات محلية) + منطقة زمنية.
 * - المواعيد تُشتق أسبوعيًا في `schedule_entries` (تُخزَّن بلحظة UTC + تاريخ/وقت محلي).
 * - الاستثناء يعدّل يومًا واحدًا فقط ثم يعود الجدول الأساسي تلقائيًا.
 */

/** أيام الأسبوع: 1 = الاثنين … 7 = الأحد (نفس ترقيم ISO 8601 وLuxon) */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = Object.freeze([1, 2, 3, 4, 5, 6, 7]);

export const ScheduleKind = {
  /** كل يوم */
  Daily: 'daily',
  /** عدة أيام محددة */
  SeveralDays: 'several_days',
  /** مرة أسبوعيًا */
  Weekly: 'weekly',
  /** مخصص: أيام + أوقات متعددة */
  Custom: 'custom',
} as const;

export type ScheduleKind = (typeof ScheduleKind)[keyof typeof ScheduleKind];

/** وقت محلي بصيغة HH:mm (24 ساعة) */
export type LocalTime = string;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

/** القاعدة الأسبوعية: أي الأيام وفي أي الأوقات (بالمنطقة الزمنية للشخص) */
export interface WeeklyPattern {
  weekdays: Weekday[];
  /** وقت واحد أو أكثر لكل يوم */
  times: LocalTime[];
  timezone: string;
}

/** إيقاف جدول شخص حتى تاريخ محدد (وضع السفر ✈️ أو إيقاف مؤقت) */
export interface PauseWindow {
  from: string;
  /** إن كانت فارغة فالإيقاف مفتوح حتى يُرفع يدويًا */
  until?: string;
  reason?: PauseReason;
  note?: string;
}

export const PauseReason = {
  Travel: 'travel',
  Manual: 'manual',
  FamilyPause: 'family_pause',
  NotificationPause: 'notification_pause',
  EscalationPause: 'escalation_pause',
} as const;

export type PauseReason = (typeof PauseReason)[keyof typeof PauseReason];

/** استثناء ليوم واحد: "هذا الأسبوع فقط اجعل موعد جدتي 6 م بدل 8 م" */
export const ExceptionAction = {
  /** نقل الموعد إلى أوقات أخرى في نفس اليوم */
  Move: 'move',
  /** إلغاء مواعيد هذا اليوم */
  Skip: 'skip',
  /** إضافة موعد غير معتاد في هذا اليوم */
  Add: 'add',
} as const;

export type ExceptionAction = (typeof ExceptionAction)[keyof typeof ExceptionAction];

export interface ScheduleExceptionInput {
  /** تاريخ محلي YYYY-MM-DD في منطقة الشخص الزمنية */
  date: string;
  action: ExceptionAction;
  /** مطلوبة مع move وadd */
  times?: LocalTime[];
  note?: string;
}

/** مصدر الموعد داخل الأسبوع */
export const EntrySource = {
  Schedule: 'schedule',
  Exception: 'exception',
  Manual: 'manual',
} as const;

export type EntrySource = (typeof EntrySource)[keyof typeof EntrySource];

/** حالة الموعد (مستوى الموعد، بينما PersonStatus مستوى الشخص) */
export const EntryStatus = {
  Upcoming: 'upcoming',
  Due: 'due',
  Checked: 'checked',
  Unverified: 'unverified',
  Snoozed: 'snoozed',
  Cancelled: 'cancelled',
  Skipped: 'skipped',
} as const;

export type EntryStatus = (typeof EntryStatus)[keyof typeof EntryStatus];

/** اشتقاق نوع الجدول من القاعدة الأسبوعية (للعرض فقط) */
export function inferScheduleKind(pattern: Pick<WeeklyPattern, 'weekdays' | 'times'>): ScheduleKind {
  const days = new Set(pattern.weekdays);
  const times = new Set(pattern.times);
  if (days.size === 7 && times.size <= 1) return ScheduleKind.Daily;
  if (days.size === 7 && times.size > 1) return ScheduleKind.Custom;
  if (days.size === 1 && times.size === 1) return ScheduleKind.Weekly;
  if (times.size > 1) return ScheduleKind.Custom;
  return ScheduleKind.SeveralDays;
}

/** ترتيب الأيام من السبت في الواجهة العربية (بداية الأسبوع الشائعة) — يُستخدم للعرض فقط */
export const WEEK_DISPLAY_ORDER_AR: readonly Weekday[] = Object.freeze([6, 7, 1, 2, 3, 4, 5]);
export const WEEK_DISPLAY_ORDER_EN: readonly Weekday[] = Object.freeze([7, 1, 2, 3, 4, 5, 6]);
