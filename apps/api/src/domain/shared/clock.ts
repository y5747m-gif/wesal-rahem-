/**
 * الساعة — تُحقن دائمًا حتى تكون كل حسابات الجدولة قابلة للاختبار بزمن ثابت.
 */
export interface Clock {
  now(): Date;
  nowIso(): string;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  set(value: Date | string): void {
    this.current = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }

  advanceDays(days: number): void {
    this.advanceHours(days * 24);
  }
}
