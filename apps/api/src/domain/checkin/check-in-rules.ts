import type { AttemptOutcome, CheckInMethod, CheckInStatus } from '@wesal/shared';
import { CheckInStatus as Status } from '@wesal/shared';
import { ValidationError, ConflictError } from '../shared/errors';
import { diffMinutes } from '../shared/time';

/**
 * قواعد تسجيل الاطمئنان والمزامنة دون اتصال.
 *
 * مبدآن حاكمان:
 *  1. عدم التكرار (Idempotency): نفس `idempotencyKey` لا يُنشئ سجلين.
 *  2. حل التعارضات: الأحدث بوقت التنفيذ على الجهاز (clientOccurredAt) هو المعتمد.
 */

export interface OpenEntryCandidate {
  id: string;
  scheduledFor: Date | string;
  status: 'upcoming' | 'due' | 'snoozed' | 'unverified' | 'checked' | 'cancelled' | 'skipped';
}

const IDEMPOTENCY_RE = /^[0-9a-zA-Z_-]{8,128}$/;

export function assertIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' || !IDEMPOTENCY_RE.test(key)) {
    throw new ValidationError('idempotencyKey must be 8–128 chars of [A-Za-z0-9_-]', {
      field: 'idempotencyKey',
    });
  }
  return key;
}

/**
 * اختيار الموعد الذي يُغلقه هذا الاطمئنان:
 *  - إن حُدِّد entryId وصالح → هو.
 *  - وإلا: أقرب موعد مفتوح (الماضي أولًا خلال نافذة الرجوع، ثم القادم القريب).
 */
export function resolveTargetEntry(
  entries: readonly OpenEntryCandidate[],
  requestedEntryId: string | null | undefined,
  now: Date,
  options: { lookbackHours?: number; lookAheadHours?: number } = {},
): OpenEntryCandidate | null {
  const lookbackHours = options.lookbackHours ?? 72;
  const lookAheadHours = options.lookAheadHours ?? 6;

  if (requestedEntryId) {
    const found = entries.find((e) => e.id === requestedEntryId) ?? null;
    if (found && found.status !== 'cancelled' && found.status !== 'skipped') return found;
    return found; // يُعاد حتى لو مغلقًا — الطبقة الأعلى تقرر (duplicated/no-op)
  }

  const actionable = entries.filter((e) => e.status !== 'checked' && e.status !== 'cancelled' && e.status !== 'skipped');
  const past = actionable
    .filter((e) => {
      const minutes = diffMinutes(e.scheduledFor, now);
      return minutes >= 0 && minutes <= lookbackHours * 60;
    })
    .sort((a, b) => new Date(b.scheduledFor as string).getTime() - new Date(a.scheduledFor as string).getTime());
  if (past[0]) return past[0];

  const future = actionable
    .filter((e) => {
      const minutes = diffMinutes(now, e.scheduledFor);
      return minutes > 0 && minutes <= lookAheadHours * 60;
    })
    .sort((a, b) => new Date(a.scheduledFor as string).getTime() - new Date(b.scheduledFor as string).getTime());
  return future[0] ?? null;
}

/**
 * عند تسجيل اطمئنان، تُغلق أيضًا المواعيد المفتوحة الأقدم لنفس الشخص:
 * من تواصل فعلًا لا يحتاج تنبيهًا على موعد فات. هذا يمنع البرتقالي القديم المزعج.
 */
export function entriesClosedByCheckIn(
  entries: readonly OpenEntryCandidate[],
  targetEntryId: string | null,
  now: Date,
): string[] {
  const target = entries.find((e) => e.id === targetEntryId);
  const limit = target ? new Date(target.scheduledFor as string).getTime() : now.getTime();
  return entries
    .filter(
      (e) =>
        e.id !== targetEntryId &&
        e.status !== 'checked' &&
        e.status !== 'cancelled' &&
        e.status !== 'skipped' &&
        new Date(e.scheduledFor as string).getTime() <= limit,
    )
    .map((e) => e.id);
}

/** حل تعارض المزامنة: من الأحدث؟ */
export function isNewerClientOperation(
  existingClientOccurredAt: Date | string | null | undefined,
  incomingClientOccurredAt: Date | string,
): boolean {
  if (!existingClientOccurredAt) return true;
  return new Date(incomingClientOccurredAt).getTime() > new Date(existingClientOccurredAt).getTime();
}

/** محاولة "اتصلت ولم يرد" → متى نعيد التذكير؟ */
export function computeRetryAfter(
  now: Date,
  outcome: AttemptOutcome,
  options: { requestedRetryMinutes?: number; defaultRetryMinutes?: number; maxRetryMinutes?: number },
): Date | null {
  if (outcome === ('answered' as AttemptOutcome)) return null;
  const requested = options.requestedRetryMinutes;
  const fallback = options.defaultRetryMinutes ?? 60;
  const minutes = Math.max(5, Math.min(requested ?? fallback, options.maxRetryMinutes ?? 24 * 60));
  return new Date(now.getTime() + minutes * 60_000);
}

export function defaultCheckInStatus(method: CheckInMethod, explicit?: CheckInStatus): CheckInStatus {
  if (explicit) return explicit;
  return Status.Reassured;
}

/** حد أقصى لمحاولات التأجيل على نفس الموعد (منع المماطلة بلا نهاية) */
export function assertSnoozeAllowed(snoozeCountForEntry: number, maxSnoozes: number): void {
  if (snoozeCountForEntry >= maxSnoozes) {
    throw new ConflictError(
      'This appointment was postponed too many times — record a check-in or let the day pass gently',
      { maxSnoozes },
    );
  }
}
