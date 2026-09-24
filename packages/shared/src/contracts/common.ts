/** أشكال الاستجابات والأخطاء المشتركة بين الخادم والتطبيق. */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: ApiErrorBody;
}

export interface ApiErrorBody {
  /** رمز ثابت يعتمد عليه التطبيق (لا يترجم) */
  code: ErrorCode;
  /** رسالة جاهزة للعرض بلغة المستخدم */
  message: string;
  details?: FieldError[];
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** رموز الأخطاء — تُستخدم في التطبيق لاتخاذ قرار (مثل إعادة المحاولة أو تسجيل الدخول) */
export const ErrorCode = {
  ValidationError: 'validation_error',
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  Conflict: 'conflict',
  RateLimited: 'rate_limited',
  InvalidOtp: 'invalid_otp',
  ExpiredOtp: 'expired_otp',
  TooManyOtpAttempts: 'too_many_otp_attempts',
  InvalidPhone: 'invalid_phone',
  InviteNotFound: 'invite_not_found',
  InviteExpired: 'invite_expired',
  InviteNotAcceptable: 'invite_not_acceptable',
  ConsentRequired: 'consent_required',
  PersonPaused: 'person_paused',
  EntryNotActionable: 'entry_not_actionable',
  DeceasedReportedRestricted: 'deceased_report_restricted',
  SyncConflict: 'sync_conflict',
  InternalError: 'internal_error',
  ServiceUnavailable: 'service_unavailable',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  time: string;
  database: 'up' | 'down';
}

/** قيود الإدخال المشتركة (تُستخدم في الخادم والتطبيق معًا) */
export const LIMITS = {
  personNameMin: 1,
  personNameMax: 80,
  notesMax: 500,
  trustedContactNameMax: 80,
  otpLength: 6,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  snoozeMinutesOptions: [15, 30, 60, 120] as const,
  maxPersonsPerUser: 200,
  maxScheduleTimesPerDay: 4,
  maxWeeksGeneratedAhead: 4,
} as const;

/** E.164 مبسّط: + ثم 7–15 رقمًا */
export const PHONE_E164_RE = /^\+[1-9]\d{6,14}$/;

export function isValidE164Phone(value: unknown): value is string {
  return typeof value === 'string' && PHONE_E164_RE.test(value);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}
