import { DateTime } from 'luxon';
import type { EntryStatus, PersonStatus, Weekday } from '@wesal/shared';
import { PersonStatus as PS } from '@wesal/shared';
import type { Occurrence } from './schedule-engine';

/**
 * إسقاط المواعيد على شكل أسبوع للعرض (WESAL WEEK).
 * منطق نقية حتى تكون قابلة للاختبار بدون قاعدة بيانات.
 */

export interface WeekDayBucket<TEntry> {
  date: string;
  weekday: Weekday;
  isToday: boolean;
  entries: TEntry[];
  counts: {
    total: number;
    checked: number;
    due: number;
    unverified: number;
    upcoming: number;
  };
}

export interface BuildWeekInput<TEntry> {
  weekStartLocalDate: string;
  timezone: string;
  todayLocalDate: string;
  entriesByLocalDate: Map<string, TEntry[]>;
  entryLocalDate: (entry: TEntry) => string;
  entryStatus: (entry: TEntry) => EntryStatus;
}

export function buildWeekBuckets<TEntry>(input: BuildWeekInput<TEntry>): WeekDayBucket<TEntry>[] {
  const buckets: WeekDayBucket<TEntry>[] = [];
  const start = DateTime.fromISO(input.weekStartLocalDate, { zone: input.timezone }).startOf('day');

  for (let i = 0; i < 7; i += 1) {
    const day = start.plus({ days: i });
    const date = day.toISODate() as string;
    const entries = input.entriesByLocalDate.get(date) ?? [];
    const counts = { total: entries.length, checked: 0, due: 0, unverified: 0, upcoming: 0 };

    for (const entry of entries) {
      const status = input.entryStatus(entry);
      if (status === 'checked') counts.checked += 1;
      else if (status === 'due' || status === 'snoozed') counts.due += 1;
      else if (status === 'unverified') counts.unverified += 1;
      else if (status === 'upcoming') counts.upcoming += 1;
    }

    buckets.push({
      date,
      weekday: day.weekday as Weekday,
      isToday: date === input.todayLocalDate,
      entries,
      counts,
    });
  }
  return buckets;
}

/** تجميع حالات المواعيد إلى حالة شخص (القسم 4 من الوثيقة) */
export function derivePersonStatusFromEntries(
  entryStatuses: readonly EntryStatus[],
  options: {
    deceasedReported?: boolean;
    paused?: boolean;
    /** وصل إلى مرحلة التصعيد (يُستخدم باعتدال شديد) */
    needsFollowUp?: boolean;
  } = {},
): PersonStatus {
  if (options.deceasedReported) return PS.DeceasedReported;
  if (options.paused) return PS.Paused;
  if (options.needsFollowUp) return PS.NeedsFollowUp;

  const has = (s: EntryStatus) => entryStatuses.includes(s);
  if (has('unverified')) return PS.Unverified;
  if (has('due') || has('snoozed')) return PS.Due;
  if (has('checked')) return PS.Checked;
  if (has('upcoming')) return PS.Upcoming;
  return PS.Upcoming;
}

/** ترتيب بطاقات الرئيسية حسب الأولوية: الأعلى إلحاحًا أولًا، ثم الأقدم موعدًا */
export function compareCardsByPriority(
  a: { status: PersonStatus; entryAt: string | null; priority: number },
  b: { status: PersonStatus; entryAt: string | null; priority: number },
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const at = (v: string | null) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY);
  return at(a.entryAt) - at(b.entryAt);
}

/** اقتراح لطيف عند انخفاض التواصل — حساب بسيط لا يحتاج AI (القسم 12) */
export function buildLowContactSuggestion(input: {
  personId: string;
  personName: string;
  daysSinceLastContact: number;
  locale: 'ar' | 'en';
  thresholdDays?: number;
}): { personId: string; text: string } | null {
  const threshold = input.thresholdDays ?? 10;
  if (input.daysSinceLastContact < threshold) return null;
  const text =
    input.locale === 'ar'
      ? `لاحظنا أن تواصلك مع ${input.personName} انخفض هذا الأسبوع. هل نضيف موعدًا يوم الجمعة؟`
      : `We noticed your contact with ${input.personName} dropped this week. Shall we add a Friday appointment?`;
  return { personId: input.personId, text };
}

export type { Occurrence };
