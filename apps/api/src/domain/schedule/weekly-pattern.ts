import type { LocalTime, ScheduleKind, Weekday } from '@wesal/shared';
import { inferScheduleKind } from '@wesal/shared';
import { ValidationError } from '../shared/errors';
import {
  assertValidTimezone,
  uniqueSortedTimes,
  uniqueSortedWeekdays,
  weekdayOfLocalDate,
} from '../shared/time';
import { LIMITS } from '@wesal/shared';

/**
 * القاعدة الأسبوعية — كائن قيمة (Value Object) غير قابل للتغيير.
 * الأنواع: يوميًا · عدة أيام · أسبوعيًا · مخصص (أيام + أوقات).
 */
export class WeeklyPattern {
  private constructor(
    readonly weekdays: readonly Weekday[],
    readonly times: readonly LocalTime[],
    readonly timezone: string,
  ) {}

  static create(input: {
    weekdays: readonly number[];
    times: readonly string[];
    timezone: string;
  }): WeeklyPattern {
    const weekdays = uniqueSortedWeekdays(input.weekdays as Weekday[]);
    const times = uniqueSortedTimes(input.times as LocalTime[]);
    const timezone = assertValidTimezone(input.timezone);

    if (weekdays.length === 0) {
      throw new ValidationError('Schedule needs at least one day', { field: 'weekdays' });
    }
    if (weekdays.length > 7) {
      throw new ValidationError('A week has 7 days at most', { field: 'weekdays' });
    }
    if (times.length === 0) {
      throw new ValidationError('Schedule needs at least one time', { field: 'times' });
    }
    if (times.length > LIMITS.maxScheduleTimesPerDay) {
      throw new ValidationError(
        `At most ${LIMITS.maxScheduleTimesPerDay} times per day — WESAL is about calm consistency, not pressure`,
        { field: 'times' },
      );
    }
    return new WeeklyPattern(weekdays, times, timezone);
  }

  get kind(): ScheduleKind {
    return inferScheduleKind({ weekdays: [...this.weekdays], times: [...this.times] });
  }

  /** الأوقات المقررة في تاريخ محلي (بدون اعتبار الاستثناءات) */
  timesForLocalDate(localDate: string): LocalTime[] {
    const weekday = weekdayOfLocalDate(localDate);
    return this.weekdays.includes(weekday) ? [...this.times] : [];
  }

  isDayScheduled(localDate: string): boolean {
    return this.weekdays.includes(weekdayOfLocalDate(localDate));
  }

  equals(other: WeeklyPattern): boolean {
    return (
      this.timezone === other.timezone &&
      this.weekdays.join(',') === other.weekdays.join(',') &&
      this.times.join(',') === other.times.join(',')
    );
  }

  toJSON(): { weekdays: Weekday[]; times: LocalTime[]; timezone: string; kind: ScheduleKind } {
    return {
      weekdays: [...this.weekdays] as Weekday[],
      times: [...this.times] as LocalTime[],
      timezone: this.timezone,
      kind: this.kind,
    };
  }
}
