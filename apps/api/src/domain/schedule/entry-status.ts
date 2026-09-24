import type { CheckInStatus, EntryStatus } from '@wesal/shared';
import { EntryStatus as Status } from '@wesal/shared';
import { addMinutes } from '../shared/time';

/**
 * حساب حالة الموعد (Entry) — دالة نقية.
 *
 * القاعدة الحاكمة: انتهاء الموعد وفترة السماح دون تسجيل يعني **فقط** "لم يتم التحقق".
 * لا يُستنتج خطر أو وفاة أبدًا.
 */

export interface EntryStateInput {
  id: string;
  scheduledFor: Date | string;
  /** نهاية مهلة السماح — تُحسب من scheduledFor + gracePeriodMinutes */
  graceUntil?: Date | string | null;
  /** تأجيل قصير (⏰ لاحقًا) */
  snoozedUntil?: Date | string | null;
  /** أُلغي (حذف موعد أو إيقاف) */
  cancelled?: boolean;
  /** تخطّي عبر استثناء skip */
  skipped?: boolean;
}

export interface CheckInSignal {
  entryId?: string | null;
  occurredAt: Date | string;
  status: CheckInStatus;
}

function ms(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export function computeGraceUntil(scheduledFor: Date | string, gracePeriodMinutes: number): Date {
  const safeGrace = Math.max(0, Math.min(gracePeriodMinutes, 60 * 24 * 7));
  return addMinutes(scheduledFor, safeGrace);
}

export function computeEntryStatus(
  entry: EntryStateInput,
  now: Date,
  options: {
    checkIns?: readonly CheckInSignal[];
    /** مهلة السماح الافتراضية إن لم تُخزَّن على الموعد */
    defaultGraceMinutes?: number;
  } = {},
): EntryStatus {
  if (entry.cancelled) return Status.Cancelled;
  if (entry.skipped) return Status.Skipped;

  const nowMs = now.getTime();
  const checkIns = options.checkIns ?? [];

  // 1) أي اطمئنان مسجَّل لهذا الموعد يُغلقه فورًا (حتى لو سجّله شخص آخر مخوّل)
  const reassured = checkIns.some(
    (c) =>
      c.status === ('reassured' as CheckInStatus) &&
      (c.entryId === entry.id || (c.entryId == null && ms(c.occurredAt) !== null)),
  );
  if (reassured) return Status.Checked;

  // 2) تأجيل قصير ساري المفعول
  const snoozedUntil = ms(entry.snoozedUntil);
  if (snoozedUntil !== null && snoozedUntil > nowMs) return Status.Snoozed;

  const scheduledFor = ms(entry.scheduledFor);
  if (scheduledFor === null) return Status.Upcoming;

  // 3) لم يحن الوقت بعد
  if (nowMs < scheduledFor) return Status.Upcoming;

  // 4) حان الوقت وما زلنا داخل مهلة السماح
  const graceUntil = ms(entry.graceUntil) ?? (options.defaultGraceMinutes
    ? computeGraceUntil(entry.scheduledFor, options.defaultGraceMinutes).getTime()
    : null);
  if (graceUntil === null || nowMs <= graceUntil) return Status.Due;

  // 5) انتهى الموعد ومهلة السماح دون تسجيل → "لم يتم التحقق" فقط
  return Status.Unverified;
}

/** هل الموعد قابل لتنفيذ إجراء عليه الآن (اتصل / تم / لاحقًا)؟ */
export function isEntryActionable(status: EntryStatus): boolean {
  return status === Status.Due || status === Status.Snoozed || status === Status.Unverified || status === Status.Upcoming;
}

export function isOpenEntryStatus(status: EntryStatus): boolean {
  return status !== Status.Checked && status !== Status.Cancelled && status !== Status.Skipped;
}
