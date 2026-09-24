import type { Locale } from './messages';
import { getMessages } from './index';

/**
 * تنسيق الوقت والتاريخ بمنطقة زمنية محددة — مهم جدًا لأن لكل شخص منطقة زمنية،
 * ولأن المستخدم قد يسافر. نستخدم Intl (متوفر في Node 20+ مع full-ICU وفي RN عبر Hermes).
 *
 * ملاحظة: العربية تستخدم أرقامًا لاتينية (`-u-nu-latn`) لأن الوثيقة تعرض "8:42 م".
 */
export const LOCALE_TAG: Record<Locale, string> = {
  ar: 'ar-u-nu-latn',
  en: 'en',
};

export function formatDate(
  value: string | Date,
  timezone: string,
  locale: Locale = 'ar',
  options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' },
): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], { ...options, timeZone: timezone }).format(
    toDate(value),
  );
}

export function formatTime(value: string | Date, timezone: string, locale: Locale = 'ar'): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(toDate(value));
}

export function formatDateTime(value: string | Date, timezone: string, locale: Locale = 'ar'): string {
  return `${formatDate(value, timezone, locale)} — ${formatTime(value, timezone, locale)}`;
}

/** "اليوم / غدًا / أمس" إن انطبقت، وإلا اسم اليوم */
export function formatRelativeDay(date: string, timezone: string, locale: Locale = 'ar'): string {
  const m = getMessages(locale);
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  const targetLocal = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(toDate(date));
  if (todayLocal === targetLocal) return m.common.today;
  const shift = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);
  };
  if (targetLocal === shift(1)) return m.common.tomorrow;
  if (targetLocal === shift(-1)) return m.common.yesterday;
  return formatDate(date, timezone, locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
