import type { Locale } from '../i18n/messages';
import type { ThemeMode, FontScaleKey } from '../design/tokens';
import type { UserId } from '../domain/ids';

export interface RequestOtpRequest {
  /** E.164 مثل ‎+201001234567 */
  phone: string;
  locale?: Locale;
  /** معلومات الجهاز (اختياري) — تُستخدم في سجل التدقيق فقط */
  deviceInfo?: string;
}

export interface RequestOtpResponse {
  /** مدة الصلاحية بالدقائق */
  expiresInMinutes: number;
  /** في بيئة التطوير فقط يُعاد الرمز لتسهيل التجربة — ممنوع في الإنتاج */
  devCode?: string;
  resendAfterSeconds: number;
}

export interface VerifyOtpRequest {
  phone: string;
  code: string;
  locale?: Locale;
  timezone?: string;
  displayName?: string;
  device?: DeviceRegistration;
}

export interface DeviceRegistration {
  platform: 'ios' | 'android' | 'web';
  pushToken?: string;
  appVersion?: string;
  locale?: Locale;
  timezone?: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** ثوانٍ */
  accessExpiresIn: number;
}

export interface VerifyOtpResponse extends SessionTokens {
  user: UserProfile;
  /** هل هذا حساب جديد؟ (يُستخدم لعرض onboarding) */
  isNewUser: boolean;
}

export interface RefreshSessionRequest {
  refreshToken: string;
}

export interface UserProfile {
  id: UserId;
  phone: string;
  displayName: string | null;
  email: string | null;
  locale: Locale;
  timezone: string;
  theme: ThemeMode;
  fontScale: FontScaleKey;
  reducedMotion: boolean;
  seniorMode: boolean;
  hapticsEnabled: boolean;
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface UpdateProfileRequest {
  displayName?: string | null;
  email?: string | null;
  locale?: Locale;
  timezone?: string;
  theme?: ThemeMode;
  fontScale?: FontScaleKey;
  reducedMotion?: boolean;
  seniorMode?: boolean;
  hapticsEnabled?: boolean;
  onboardingCompleted?: boolean;
}

export interface LogoutRequest {
  refreshToken: string;
}
