/**
 * محرك التصعيد — أربع مراحل فقط (القسم 7 من الوثيقة).
 * ⚠️ في المرحلة الأولى (MVP) التصعيد التلقائي للطرف الثالث **معطّل**:
 *    تُنفَّذ المرحلتان 1 و2 فقط (تذكير المستخدم + إعادة المحاولة)،
 *    بينما تُخزَّن القواعد والموافقات جاهزة للمرحلة الثانية.
 */
export const EscalationStage = {
  /** 1. تذكير للمستخدم عند الموعد */
  UserReminder: 1,
  /** 2. إعادة محاولة بعد مهلة قابلة للتعديل */
  RetryReminder: 2,
  /** 3. تنبيه الجهة الموثوقة الأولى (بموافقة مسبقة) */
  FirstTrustedContact: 3,
  /** 4. تنبيه الجهة الثانية ثم عرض إرشاد الطوارئ عند وجود قلق حقيقي */
  SecondTrustedContact: 4,
} as const;

export type EscalationStage = (typeof EscalationStage)[keyof typeof EscalationStage];

/** قيم افتراضية إنسانية وغير مرهقة (بالدقائق) */
export const DEFAULT_ESCALATION_RULE = {
  reminderDelayMinutes: 0,
  secondReminderDelayMinutes: 60,
  trustedContactDelayMinutes: 180,
  nextContactDelayMinutes: 240,
  maxContacts: 2,
  gracePeriodMinutes: 90,
  /** ساعات الهدوء: لا تصعيد ليلًا ما لم يُحدَّد غير ذلك */
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  emergencyGuidance: true,
} as const;

export interface EscalationRuleSettings {
  reminderDelayMinutes: number;
  secondReminderDelayMinutes: number;
  trustedContactDelayMinutes: number;
  nextContactDelayMinutes: number;
  maxContacts: number;
  gracePeriodMinutes: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  /** هل تُعرض إرشادات الطوارئ المحلية عند وجود قلق حقيقي؟ */
  emergencyGuidance: boolean;
}

/**
 * حدود صارمة ضد الإزعاج (Rate limits) — لا إعادة اتصال بلا نهاية.
 */
export const ESCALATION_LIMITS = {
  maxRemindersPerEntry: 3,
  maxThirdPartyAlertsPerDay: 2,
  minMinutesBetweenThirdPartyAlerts: 120,
  maxSnoozesPerEntry: 3,
} as const;
