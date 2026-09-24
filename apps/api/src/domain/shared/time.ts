import { DateTime, IANAZone } from 'luxon';
import type { LocalTime, Weekday } from '@wesal/shared';
import { ValidationError } from './errors';

/**
 * أدوات الزمن — كل الحسابات تمر من هنا لضمان معالجة صحيحة للمناطق الزمنية
 * (لكل شخص منطقة، ولكل مستخدم منطقة، وتُعالَج بشكل صحيح عند السفر وتغيير التوقيت).
 */

export const DEFAULT_TIMEZONE = 'Africa/Cairo';

export function isValidTimezone(timezone: string | undefined | null): boolean {
  if (!timezone) return false;
  return IANAZone.isValidZone(timezone);
}

export function assertValidTimezone(timezone: string | undefined | null): string {
  if (!isValidTimezone(timezone)) {
    throw new ValidationError(`Unsupported timezone: ${String(timezone)}`, { field: 'timezone' });
  }
  return timezone as string;
}

export function assertValidLocalTime(time: string): LocalTime {
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
    throw new ValidationError(`Invalid local time: ${time}`, { field: 'time' });
  }
  return time as LocalTime;
}

export function assertValidLocalDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError(`Invalid local date: ${date}`, { field: 'date' });
  }
  const parsed = DateTime.fromISO(date, { zone: 'utc' });
  if (!parsed.isValid) throw new ValidationError(`Invalid local date: ${date}`, { field: 'date' });
  return date;
}

/** لحظة UTC من تاريخ ووقت محليين في منطقة زمنية (آمن مع التوقيت الصيفي) */
export function localToUtcInstant(localDate: string, localTime: LocalTime, timezone: string): DateTime {
  assertValidTimezone(timezone);
  const dt = DateTime.fromISO(`${localDate}T${localTime}`, { zone: timezone });
  if (!dt.isValid) {
    throw new ValidationError(`Invalid local datetime: ${localDate}T${localTime}`, {
      field: 'scheduledFor',
    });
  }
  // إن لم يوجد هذا الوقت محليًا (قفزة الربيع) ينقله Luxon للأمام تلقائيًا.
  return dt.toUTC();
}

export function utcToLocal(instant: Date | string, timezone: string): DateTime {
  assertValidTimezone(timezone);
  return DateTime.fromJSDate(instant instanceof Date ? instant : new Date(instant), { zone: 'utc' }).setZone(
    timezone,
  );
}

export function toLocalDate(instant: Date | string, timezone: string): string {
  return utcToLocal(instant, timezone).toISODate() as string;
}

export function toLocalTimeLabel(instant: Date | string, timezone: string): string {
  return utcToLocal(instant, timezone).toFormat('HH:mm');
}

export function weekdayOfLocalDate(localDate: string): Weekday {
  return DateTime.fromISO(localDate, { zone: 'utc' }).weekday as Weekday;
}

/** بداية الأسبوع محليًا. الافتراضي السبت (الشائع عربياً) ويمكن جعله الاثنين. */
export function startOfWeek(localDate: string, timezone: string, weekStartsOn: 6 | 1 = 6): string {
  assertValidTimezone(timezone);
  const dt = DateTime.fromISO(localDate, { zone: timezone }).startOf('day');
  const diff = (dt.weekday - weekStartsOn + 7) % 7;
  return dt.minus({ days: diff }).toISODate() as string;
}

export function addDaysToLocalDate(localDate: string, days: number): string {
  return (DateTime.fromISO(localDate, { zone: 'utc' }).plus({ days }).toISODate() as string);
}

export function localDateRange(startLocalDate: string, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) out.push(addDaysToLocalDate(startLocalDate, i));
  return out;
}

export function diffMinutes(from: Date | string, to: Date | string): number {
  const a = from instanceof Date ? from.getTime() : new Date(from).getTime();
  const b = to instanceof Date ? to.getTime() : new Date(to).getTime();
  return (b - a) / 60_000;
}

export function addMinutes(instant: Date | string, minutes: number): Date {
  const base = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  return new Date(base + minutes * 60_000);
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/** مقارنة نصّي HH:mm */
export function compareLocalTimes(a: LocalTime, b: LocalTime): number {
  return a.localeCompare(b);
}

export function uniqueSortedTimes(times: readonly LocalTime[]): LocalTime[] {
  return Array.from(new Set(times.map(assertValidLocalTime))).sort(compareLocalTimes);
}

export function uniqueSortedWeekdays(days: readonly Weekday[]): Weekday[] {
  const valid = days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  if (valid.length !== days.length) {
    throw new ValidationError('Weekday must be between 1 (Monday) and 7 (Sunday)', { field: 'weekdays' });
  }
  return Array.from(new Set(valid)).sort((a, b) => a - b) as Weekday[];
}
