import type { Locale, WesalMessages } from './messages';
import { ar } from './ar';
import { en } from './en';

export const messagesByLocale: Readonly<Record<Locale, WesalMessages>> = Object.freeze({ ar, en });

export const DEFAULT_LOCALE: Locale = 'ar';

export function getMessages(locale: Locale | string | undefined | null): WesalMessages {
  if (locale === 'en') return en;
  return ar;
}

export function detectLocaleFromAcceptLanguage(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const primary = header.split(',')[0]?.trim().toLowerCase() ?? '';
  return primary.startsWith('en') ? 'en' : DEFAULT_LOCALE;
}

export type { Locale, WesalMessages };
export { ar, en };
