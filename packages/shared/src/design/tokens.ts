/**
 * نظام تصميم وصال (WESAL Design System) — القسم 11 من الوثيقة.
 * الأسلوب: Soft Glass + Warm Family UI — دافئ، إنساني، هادئ، وموثوق.
 * لا طابع طبي أو أمني مخيف. الأحمر يُستخدم باعتدال شديد.
 */

export const StatusColors = {
  /** 🟢 تم الاطمئنان */
  checked: '#55C98A',
  /** 🟡 حان وقت الاطمئنان */
  due: '#F4C95D',
  /** 🟠 لم يتم التحقق */
  unverified: '#F29E62',
  /** 🔴 يحتاج متابعة */
  needsFollowUp: '#E86A6A',
  /** ⚪ موعد قادم */
  upcoming: '#C9D2CB',
  /** ⚫ تم الإبلاغ عن الوفاة (إدخال يدوي مخوّل فقط) */
  deceasedReported: '#3A403C',
  /** ⏸️ متوقف مؤقتًا */
  paused: '#9AA5A0',
} as const;

export type StatusColorKey = keyof typeof StatusColors;

export const LightTheme = {
  background: '#FFF9F3',
  surface: '#FFFFFF',
  surfaceMuted: '#FFF3E8',
  primary: '#174A3A',
  primarySoft: '#2C6B54',
  accentGold: '#F4C95D',
  text: '#182019',
  textMuted: '#5C6660',
  border: '#EADFD3',
  glassOverlay: 'rgba(255,255,255,0.62)',
  heart: '#E86A6A',
  success: '#55C98A',
} as const;

export const DarkTheme = {
  background: '#101411',
  surface: '#18201A',
  surfaceMuted: '#1E2A22',
  primary: '#65D59A',
  primarySoft: '#2E5C46',
  accentGold: '#F3CC72',
  text: '#F7F7F2',
  textMuted: '#A9B3AC',
  border: '#2A352D',
  glassOverlay: 'rgba(24,32,26,0.66)',
  heart: '#E86A6A',
  success: '#65D59A',
} as const;

export type WesalTheme = typeof LightTheme;
export type ThemeMode = 'light' | 'dark' | 'system';

export const Radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** الحركة: 150–350ms للعناصر الصغيرة، 300–500ms للانتقالات الأكبر */
export const Motion = {
  microMs: 150,
  smallMs: 220,
  mediumMs: 320,
  largeMs: 480,
  /** نبضة اكتمال الاطمئنان: نبضة قلب ← توهج أخضر ← استقرار */
  heartPulseMs: 900,
  easingStandard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  easingGentle: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
} as const;

/**
 * WESAL RING — حلقة دائرية تمثل العلاقة.
 * لا وميض قوي ولا حركة مزعجة، واحترام Reduced Motion.
 */
export const RingAnimation = {
  checked: { kind: 'steady-glow', periodMs: 0 },
  upcoming: { kind: 'steady', periodMs: 0 },
  due: { kind: 'slow-pulse', periodMs: 2600 },
  unverified: { kind: 'gentle-blink', periodMs: 1800 },
  needsFollowUp: { kind: 'slow-clear-pulse', periodMs: 2200 },
  paused: { kind: 'steady-dim', periodMs: 0 },
  deceasedReported: { kind: 'steady-dim', periodMs: 0 },
} as const;

/** أحجام الخط مع دعم تكبير الخط (إمكانية الوصول) */
export const FontSize = {
  caption: 12,
  body: 16,
  bodyLarge: 18,
  title: 22,
  heading: 28,
  /** وضع كبار السن: خط أكبر وأزرار ضخمة */
  seniorBody: 24,
  seniorTitle: 34,
  seniorButton: 28,
} as const;

export const FontScale = {
  small: 0.9,
  default: 1,
  large: 1.15,
  extraLarge: 1.3,
  senior: 1.5,
} as const;

export type FontScaleKey = keyof typeof FontScale;

/** الشعار: حلقتان متصلتان وقلب صغير داخل الوصلة */
export const Brand = {
  nameAr: 'وصال',
  nameEn: 'WESAL',
  taglineAr: 'لا تجعل الانشغال يجعلك تنسى من تحب.',
  taglineEn: 'Do not let busyness make you forget the ones you love.',
  dailyQuestionAr: 'من يحتاج منك أن تطمئن عليه اليوم؟',
  fontFamily: 'Cairo',
  fallbackFontFamily: 'Noto Sans Arabic',
} as const;
