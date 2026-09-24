import { ErrorCode } from '@wesal/shared';
import { DomainError, ValidationError } from './errors';

/**
 * أرقام الهاتف — تطبيع وتحقق صارم.
 *
 * نطلب E.164 (مثل ‎+201001234567) لأن:
 *  - تسجيل الدخول بالهاتف يحتاج رقمًا لا لبس فيه،
 *  - إرسال الدعوات يعتمد عليه،
 *  - البصمة (HMAC) لا تكون مستقرة إلا بعد التطبيع.
 */
export const E164_RE = /^\+[1-9]\d{6,14}$/;

export class InvalidPhoneError extends DomainError {
  constructor(phone?: string) {
    super(ErrorCode.InvalidPhone, 'Enter a valid phone number with the country code, e.g. +201001234567', 400, {
      phone: phone ? maskForLog(phone) : undefined,
    });
  }
}

/** يزيل المسافات والأقواس والشرطات ويقبل صيغًا شائعة، ثم يتحقق من E.164 */
export function normalizePhone(input: string, options: { defaultCountryCode?: string } = {}): string {
  if (typeof input !== 'string') throw new InvalidPhoneError();
  let value = input.replace(/[\s().-]/g, '');

  // 00 كبادئة دولية شائعة في المنطقة العربية
  if (value.startsWith('00')) value = `+${value.slice(2)}`;

  if (!value.startsWith('+') && options.defaultCountryCode) {
    const cc = options.defaultCountryCode.replace(/\D/g, '');
    value = `+${cc}${value.replace(/^0+/, '')}`;
  }

  if (!E164_RE.test(value)) throw new InvalidPhoneError(input);
  return value;
}

export function isValidE164(value: string): boolean {
  return E164_RE.test(value);
}

/** لا نكتب الرقم كاملًا في السجلات — حماية للبيانات الشخصية */
export function maskForLog(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length <= 5) return '***';
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

export function assertValidPhone(input: unknown, field = 'phone'): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new ValidationError('Phone number is required', { field });
  }
  try {
    return normalizePhone(input);
  } catch {
    throw new ValidationError('Enter a valid phone number with the country code', { field });
  }
}
