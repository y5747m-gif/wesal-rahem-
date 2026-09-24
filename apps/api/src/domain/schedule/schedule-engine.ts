import { DateTime } from 'luxon';
import type { EntrySource, ExceptionAction, LocalTime } from '@wesal/shared';
import { EntrySource as Source, ExceptionAction as Action } from '@wesal/shared';
import type { WeeklyPattern } from './weekly-pattern';
import {
  addDaysToLocalDate,
  assertValidLocalDate,
  localDateRange,
  localToUtcInstant,
} from '../shared/time';
import { ValidationError } from '../shared/errors';

/**
 * محرّك الجدولة — دوال نقية بالكامل (لا قاعدة بيانات ولا وقت نظام).
 *
 * المسؤوليات:
 *  1. اشتقاق المواعيد من القاعدة الأسبوعية داخل نطاق زمني.
 *  2. تطبيق الاستثناءات ("هذا الأسبوع فقط اجعل موعد جدتي 6 م بدل 8 م").
 *  3. احترام الإيقاف المؤقت ووضع السفر ✈️.
 *  4. التعامل الصحيح مع المناطق الزمنية والتوقيت الصيفي.
 *
 * ⚠️ كل المواعيد تُحسب بالوقت المحلي للشخص (وليس المستخدم) لأن الجدول يخص الشخص.
 */

export interface ExceptionRecord {
  id?: string | null;
  /** تاريخ محلي YYYY-MM-DD في منطقة الشخص الزمنية */
  date: string;
  action: ExceptionAction;
  times: LocalTime[];
  note?: string | null;
}

export interface PauseWindowRecord {
  from: Date | string;
  /** فارغة = إيقاف مفتوح حتى يُرفع يدويًا */
  until?: Date | string | null;
}

export interface Occurrence {
  localDate: string;
  localTime: LocalTime;
  timezone: string;
  /** لحظة UTC بصيغة ISO 8601 — ما يُخزَّن في schedule_entries.scheduled_for */
  scheduledFor: string;
  source: EntrySource;
  exceptionId?: string | null;
  /** إن كان الاستثناء نقلًا، الوقت الأصلي الذي استُبدل */
  replacedTime?: LocalTime | null;
}

export interface ExpandRangeInput {
  pattern: WeeklyPattern;
  /** أول يوم محلي (شامل) */
  startLocalDate: string;
  /** عدد الأيام (افتراضيًا 7 = أسبوع) */
  days?: number;
  exceptions?: readonly ExceptionRecord[];
  pause?: PauseWindowRecord | null;
  /** حدود الجدول نفسه (تاريخ محلي) */
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

function toMillis(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isPausedAt(pause: PauseWindowRecord | null | undefined, instantIso: string): boolean {
  if (!pause) return false;
  const from = toMillis(pause.from);
  if (from === null) return false;
  const until = toMillis(pause.until ?? null);
  const instant = new Date(instantIso).getTime();
  if (instant < from) return false;
  if (until === null) return true; // إيقاف مفتوح
  return instant < until;
}

/** مواعيد يوم محلي واحد بعد تطبيق الاستثناء */
export function occurrencesForLocalDate(
  pattern: WeeklyPattern,
  localDate: string,
  exceptions: readonly ExceptionRecord[] = [],
): Occurrence[] {
  assertValidLocalDate(localDate);
  const tz = pattern.timezone;
  const forDate = exceptions.filter((e) => e.date === localDate);
  const baseTimes = pattern.timesForLocalDate(localDate);

  // إن وُجد استثناء skip لهذا اليوم: لا مواعيد إطلاقًا
  if (forDate.some((e) => e.action === Action.Skip)) return [];

  const moveExceptions = forDate.filter((e) => e.action === Action.Move);
  const addExceptions = forDate.filter((e) => e.action === Action.Add);

  const result: Occurrence[] = [];

  if (moveExceptions.length > 0) {
    // النقل يستبدل مواعيد اليوم الأساسية
    for (const exception of moveExceptions) {
      for (const time of exception.times) {
        result.push({
          localDate,
          localTime: time,
          timezone: tz,
          scheduledFor: localToUtcInstant(localDate, time, tz).toISO() as string,
          source: Source.Exception,
          exceptionId: exception.id ?? null,
          replacedTime: baseTimes[0] ?? null,
        });
      }
    }
  } else {
    for (const time of baseTimes) {
      result.push({
        localDate,
        localTime: time,
        timezone: tz,
        scheduledFor: localToUtcInstant(localDate, time, tz).toISO() as string,
        source: Source.Schedule,
        exceptionId: null,
      });
    }
  }

  // الإضافة تزيد على المواعيد الأساسية (أو على نتيجة النقل)
  for (const exception of addExceptions) {
    for (const time of exception.times) {
      if (result.some((r) => r.localTime === time)) continue;
      result.push({
        localDate,
        localTime: time,
        timezone: tz,
        scheduledFor: localToUtcInstant(localDate, time, tz).toISO() as string,
        source: Source.Exception,
        exceptionId: exception.id ?? null,
      });
    }
  }

  return result.sort((a, b) => a.localTime.localeCompare(b.localTime));
}

/** توسيع القاعدة الأسبوعية إلى مواعيد داخل نطاق (مع الاستثناءات والإيقاف) */
export function expandOccurrences(input: ExpandRangeInput): Occurrence[] {
  const days = input.days ?? 7;
  if (days <= 0 || days > 400) {
    throw new ValidationError(`days must be between 1 and 400`, { field: 'days' });
  }
  const startLocalDate = assertValidLocalDate(input.startLocalDate);
  const dates = localDateRange(startLocalDate, days);
  const out: Occurrence[] = [];

  for (const date of dates) {
    if (input.effectiveFrom && date < input.effectiveFrom) continue;
    if (input.effectiveTo && date > input.effectiveTo) continue;

    for (const occurrence of occurrencesForLocalDate(input.pattern, date, input.exceptions)) {
      if (isPausedAt(input.pause, occurrence.scheduledFor)) continue;
      out.push(occurrence);
    }
  }

  return out;
}

/** توسيع أسابيع كاملة متتالية (لإنشاء الأسبوع التالي تلقائيًا بنفس الجدول) */
export function expandWeeks(
  input: Omit<ExpandRangeInput, 'days'> & { weeks: number; weekStartLocalDate: string },
): Occurrence[][] {
  if (input.weeks < 1 || input.weeks > 26) {
    throw new ValidationError('weeks must be between 1 and 26', { field: 'weeks' });
  }
  const weeks: Occurrence[][] = [];
  for (let w = 0; w < input.weeks; w += 1) {
    const startLocalDate = addDaysToLocalDate(input.weekStartLocalDate, w * 7);
    weeks.push(expandOccurrences({ ...input, startLocalDate, days: 7 }));
  }
  return weeks;
}

/**
 * الموعد التالي بعد لحظة معينة — يُستخدم لحساب nextEntryAt ولإنشاء التذكيرات.
 * يبحث يومًا بيوم حتى 60 يومًا (يتوقف عند الإيقاف المفتوح).
 */
export function nextOccurrenceAfter(
  pattern: WeeklyPattern,
  afterInstant: Date | string,
  options: {
    exceptions?: readonly ExceptionRecord[];
    pause?: PauseWindowRecord | null;
    timezoneForDates?: string;
    maxDays?: number;
  } = {},
): Occurrence | null {
  const tz = options.timezoneForDates ?? pattern.timezone;
  const after = afterInstant instanceof Date ? afterInstant : new Date(afterInstant);
  const afterIso = after.toISOString();
  let cursor = DateTime.fromJSDate(after, { zone: 'utc' }).setZone(tz).startOf('day');
  const maxDays = options.maxDays ?? 60;

  // إن كان الإيقاف مفتوحًا بلا نهاية: لا موعد تالٍ
  if (options.pause && toMillis(options.pause.until ?? null) === null) {
    const from = toMillis(options.pause.from);
    if (from !== null && after.getTime() >= from) return null;
  }

  for (let i = 0; i < maxDays; i += 1) {
    const localDate = cursor.toISODate() as string;
    const dayOccurrences = occurrencesForLocalDate(pattern, localDate, options.exceptions);
    for (const occurrence of dayOccurrences) {
      if (occurrence.scheduledFor > afterIso && !isPausedAt(options.pause, occurrence.scheduledFor)) {
        return occurrence;
      }
    }
    cursor = cursor.plus({ days: 1 });
  }
  return null;
}

/** هل هذا اليوم داخل فترة إيقاف؟ (يُستخدم لعرض "متوقف مؤقتًا" في الأسبوع) */
export function isDatePaused(pattern: WeeklyPattern, localDate: string, pause: PauseWindowRecord | null): boolean {
  if (!pause) return false;
  const dayOccurrences = occurrencesForLocalDate(pattern, localDate);
  if (dayOccurrences.length === 0) return false;
  return dayOccurrences.every((o) => isPausedAt(pause, o.scheduledFor));
}
