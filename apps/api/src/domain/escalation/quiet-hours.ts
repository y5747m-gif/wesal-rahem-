import { DateTime } from 'luxon';
import type { LocalTime } from '@wesal/shared';
import { assertValidTimezone } from '../shared/time';

/**
 * ساعات الهدوء — لا تصعيد ليلًا ما لم يُحدَّد غير ذلك (ضمانة من القسم 7).
 * النافذة قد تعبر منتصف الليل (22:00 → 08:00).
 */
export interface QuietHours {
  start: LocalTime;
  end: LocalTime;
  timezone: string;
}

function toMinutes(time: LocalTime): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function isQuietHoursEnabled(qh: QuietHours | null | undefined): boolean {
  if (!qh) return false;
  return qh.start !== qh.end;
}

/** هل اللحظة داخل نافذة الهدوء (محليًا في المنطقة المحددة)؟ */
export function isWithinQuietHours(instant: Date | string, qh: QuietHours | null | undefined): boolean {
  if (!isQuietHoursEnabled(qh)) return false;
  const zone = assertValidTimezone(qh!.timezone);
  const dt = DateTime.fromJSDate(instant instanceof Date ? instant : new Date(instant), { zone: 'utc' }).setZone(zone);
  const current = dt.hour * 60 + dt.minute;
  const start = toMinutes(qh!.start);
  const end = toMinutes(qh!.end);

  if (start < end) return current >= start && current < end;
  // نافذة عابرة لمنتصف الليل
  return current >= start || current < end;
}

/**
 * إن كانت اللحظة داخل نافذة الهدوء → تُؤجَّل إلى نهايتها (مع تصحيح اليوم عند العبور).
 * وإلا تُعاد كما هي. لا نلغي التنبيه، فقط نؤجّله احترامًا للراحة.
 */
export function deferToNextAllowedInstant(instant: Date | string, qh: QuietHours | null | undefined): Date {
  if (!isQuietHoursEnabled(qh)) return instant instanceof Date ? new Date(instant.getTime()) : new Date(instant);
  const zone = assertValidTimezone(qh!.timezone);
  const dt = DateTime.fromJSDate(instant instanceof Date ? instant : new Date(instant), { zone: 'utc' }).setZone(zone);
  const current = dt.hour * 60 + dt.minute;
  const start = toMinutes(qh!.start);
  const end = toMinutes(qh!.end);

  const atEnd = (base: DateTime) =>
    base.set({ hour: Math.floor(end / 60), minute: end % 60, second: 0, millisecond: 0 });

  if (start < end) {
    if (current >= start && current < end) return atEnd(dt).toUTC().toJSDate();
    return dt.toUTC().toJSDate();
  }
  if (current >= start) return atEnd(dt.plus({ days: 1 })).toUTC().toJSDate();
  if (current < end) return atEnd(dt).toUTC().toJSDate();
  return dt.toUTC().toJSDate();
}
