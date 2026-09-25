import type { DataSource, EntityManager } from 'typeorm';
import type { LocalTime } from '@wesal/shared';

/**
 * قاعدة مشتركة للمستودعات: SQL صريح مُعامَل (parameterized) — بدون تجميع نصوص (string concatenation).
 * كل الاستعلامات تمر من هنا حتى يسهل تدقيقها وإضافة القياس لاحقًا.
 */
export abstract class SqlRepository {
  protected constructor(protected readonly dataSource: DataSource) {}

  protected async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const raw: unknown = await this.dataSource.query(sql, params);
    return normalizeRows<T>(raw);
  }

  protected async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  protected async scalar<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const row = await this.one<Record<string, T>>(sql, params);
    if (!row) return null;
    const first = Object.values(row)[0];
    return (first ?? null) as T | null;
  }

  protected async count(sql: string, params: unknown[] = []): Promise<number> {
    const value = await this.scalar<string | number>(sql, params);
    return Number(value ?? 0);
  }

  protected transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}

/**
 * TypeORM (postgres) يعيد لاستعلامات UPDATE/DELETE الشكل `[rows, affectedCount]`
 * بينما يعيد `rows` مباشرة لـ SELECT/INSERT. نوحّد الشكل هنا حتى تعمل
 * `UPDATE … RETURNING` و`DELETE … RETURNING` مثل بقية الاستعلامات.
 */
export function normalizeRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length === 2 && Array.isArray(raw[0]) && (typeof raw[1] === 'number' || raw[1] === null)) {
    return raw[0] as T[];
  }
  return raw as T[];
}

// ─────────────────────────────── تحويل الأنواع ───────────────────────────────

export function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(value as string);
}

export function asDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = asDate(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** PostgreSQL يعيد `time` بصيغة HH:mm:ss — التعاقد الداخلي HH:mm */
export function asLocalTime(value: unknown): LocalTime | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return (text.length >= 5 ? text.slice(0, 5) : text) as LocalTime;
}

export function asLocalTimeArray(value: unknown): LocalTime[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asLocalTime(v)).filter((v): v is LocalTime => v !== null);
}

export function toPgTime(time: LocalTime | null | undefined): string | null {
  if (!time) return null;
  return time.length === 5 ? `${time}:00` : time;
}

export function toPgTimeArray(times: readonly LocalTime[] | null | undefined): string[] {
  if (!times) return [];
  return times.map((t) => (t.length === 5 ? `${t}:00` : t));
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v));
}

export function asWeekdayArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((n) => Number.isInteger(n));
}

export function asStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 't' || value === 1;
}

export function asJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

/** FontScale: camelCase في التطبيق ↔ snake_case في القاعدة */
export function fontScaleToDb(value: string): string {
  return value === 'extraLarge' ? 'extra_large' : value;
}

export function fontScaleFromDb(value: string): 'small' | 'default' | 'large' | 'extraLarge' | 'senior' {
  if (value === 'extra_large') return 'extraLarge';
  if (value === 'small' || value === 'large' || value === 'senior') return value;
  return 'default';
}

/** بناء قائمة $1,$2,… للاستعلامات الديناميكية */
export function placeholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, i) => `$${start + i}`).join(', ');
}

/** عمود DATE في PostgreSQL يصل ككائن Date (منتصف ليل التوقيت المحلي للعملية) أو كنص — نعيده YYYY-MM-DD دون إزاحة */
export function asLocalDateString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}
