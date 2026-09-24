import type { EntryStatus } from '@wesal/shared';
import type { EscalationStage } from '@wesal/shared';
import { ESCALATION_LIMITS } from '@wesal/shared';
import type { EscalationRuleSettings } from '@wesal/shared';
import { DEFAULT_ESCALATION_RULE } from '@wesal/shared';
import { addMinutes } from '../shared/time';
import { deferToNextAllowedInstant, isWithinQuietHours, type QuietHours } from './quiet-hours';

/**
 * محرك التصعيد — أربع مراحل فقط (القسم 7).
 *
 * الضمانات المطبَّقة هنا كمنطق نقي قابل للاختبار:
 *  - لا تصعيد لطرف ثالث بدون موافقة صريحة + جهة قبلت الدعوة + تفعيل الميزة.
 *  - ساعات هدوء: التنبيه لا يُلغى بل يُؤجَّل إلى نهاية النافذة.
 *  - حدود واضحة: حد أقصى للرسائل والمحاولات، ولا إعادة اتصال بلا نهاية.
 *  - الإيقاف الفوري عند أي تأكيد اطمئنان (حتى من جهة موثوقة).
 *  - لا استنتاج وفاة أو خطر: المرحلة الأخيرة تعرض **إرشاد** الطوارئ فقط عند قلق حقيقي.
 *
 * ⚠️ في المرحلة الأولى (MVP) `autoEscalationEnabled = false` دائمًا،
 *    فتُنفَّذ المرحلتان 1 و2 (تذكير المستخدم وإعادة المحاولة) فقط.
 */

export type EscalationAction =
  | 'none'
  | 'remind_user'
  | 'alert_trusted_contact'
  | 'show_emergency_guidance';

export type EscalationBlockReason =
  | 'not_due_yet'
  | 'all_steps_done'
  | 'resolved'
  | 'paused'
  | 'deceased_reported'
  | 'consent'
  | 'no_trusted_contact'
  | 'feature_disabled'
  | 'rate_limit'
  | 'quiet_hours';

export interface PlannedStep {
  stage: EscalationStage;
  action: EscalationAction;
  dueAt: Date;
  /** رقم الجهة الموثوقة المستهدفة (1 أو 2) لمراحل الطرف الثالث */
  targetContactIndex?: number;
  /** هل يُعرض إرشاد الطوارئ مع هذه المرحلة؟ */
  withEmergencyGuidance?: boolean;
  label: string;
}

export interface EscalationContext {
  entryId: string;
  entryStatus: EntryStatus;
  scheduledFor: Date;
  graceUntil: Date;
  now: Date;
  rule: Partial<EscalationRuleSettings>;
  quietHours: QuietHours | null;
  consent: { autoEscalationGranted: boolean; revokedAt?: Date | null };
  /** عدد الجهات الموثوقة التي **قبلت** الدعوة فعلًا */
  acceptedTrustedContacts: number;
  /** المراحل المنفَّذة مسبقًا لهذا الموعد (من جدول escalations) */
  completedStages: EscalationStage[];
  /** عدّادات الحدود */
  remindersSentForEntry: number;
  thirdPartyAlertsToday: number;
  lastThirdPartyAlertAt: Date | null;
  /** إيقافات */
  personPaused: boolean;
  deceasedReported: boolean;
  /** تفعيل التصعيد التلقائي (المرحلة 2 من خارطة الطريق) */
  autoEscalationEnabled: boolean;
  maxContacts?: number;
}

export interface EscalationDecision {
  action: EscalationAction;
  stage: EscalationStage | null;
  reason: EscalationBlockReason | 'due';
  /** إن أُجِّلت بسبب ساعات الهدوء */
  deferUntil: Date | null;
  targetContactIndex: number | null;
  withEmergencyGuidance: boolean;
  nextStepAt: Date | null;
  explanation: string;
}

export function withDefaults(rule: Partial<EscalationRuleSettings>): EscalationRuleSettings {
  return { ...DEFAULT_ESCALATION_RULE, ...rule };
}

/** الخطة الزمنية الكاملة لموعد واحد — نفس الترتيب دائمًا، وقابلة للاختبار */
export function planEntryTimeline(ctx: Pick<
  EscalationContext,
  'scheduledFor' | 'graceUntil' | 'rule' | 'maxContacts'
>): PlannedStep[] {
  const rule = withDefaults(ctx.rule);
  const maxContacts = Math.max(0, Math.min(ctx.maxContacts ?? rule.maxContacts, 2));

  const stage1At = addMinutes(ctx.scheduledFor, rule.reminderDelayMinutes);
  const stage2At = later(
    addMinutes(ctx.scheduledFor, Math.max(rule.secondReminderDelayMinutes, rule.reminderDelayMinutes)),
    stage1At,
  );
  const stage3At = later(addMinutes(ctx.graceUntil, rule.trustedContactDelayMinutes), stage2At);
  const stage4At = later(addMinutes(stage3At, rule.nextContactDelayMinutes), stage3At);

  const steps: PlannedStep[] = [
    { stage: 1 as EscalationStage, action: 'remind_user', dueAt: stage1At, label: 'تذكير للمستخدم عند الموعد' },
    { stage: 2 as EscalationStage, action: 'remind_user', dueAt: stage2At, label: 'إعادة محاولة بعد مهلة' },
  ];

  if (maxContacts >= 1) {
    steps.push({
      stage: 3 as EscalationStage,
      action: 'alert_trusted_contact',
      dueAt: stage3At,
      targetContactIndex: 1,
      label: 'تنبيه الجهة الموثوقة الأولى',
    });
  }
  if (maxContacts >= 2) {
    steps.push({
      stage: 4 as EscalationStage,
      action: 'alert_trusted_contact',
      dueAt: stage4At,
      targetContactIndex: 2,
      withEmergencyGuidance: rule.emergencyGuidance,
      label: 'تنبيه الجهة الثانية ثم إرشاد الطوارئ',
    });
  }
  return steps;
}

function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

/** القرار الحالي لموعد واحد */
export function decideEscalation(ctx: EscalationContext): EscalationDecision {
  const base: Omit<EscalationDecision, 'action' | 'stage' | 'reason' | 'explanation'> = {
    deferUntil: null,
    targetContactIndex: null,
    withEmergencyGuidance: false,
    nextStepAt: null,
  };
  const none = (reason: EscalationBlockReason, explanation: string, nextStepAt: Date | null = null) => ({
    ...base,
    action: 'none' as const,
    stage: null,
    reason,
    nextStepAt,
    explanation,
  });

  // إيقافات فورية — لا شيء يُرسل إطلاقًا
  if (ctx.deceasedReported) return none('deceased_reported', 'التذكيرات متوقفة بعد الإبلاغ (إدخال يدوي مخوّل).');
  if (ctx.personPaused) return none('paused', 'الجدول متوقف مؤقتًا (سفر أو إيقاف).');
  if (
    ctx.entryStatus === 'checked' ||
    ctx.entryStatus === 'cancelled' ||
    ctx.entryStatus === 'skipped'
  ) {
    return none('resolved', 'تم الاطمئنان أو أُلغي الموعد — توقفت كل التنبيهات فورًا.');
  }

  const steps = planEntryTimeline(ctx);
  const pending = steps.filter((s) => !ctx.completedStages.includes(s.stage));
  if (pending.length === 0) return none('all_steps_done', 'اكتملت كل مراحل هذا الموعد.');

  const due = pending.filter((s) => s.dueAt.getTime() <= ctx.now.getTime());
  const nextStepAt = pending[0]?.dueAt ?? null;
  if (due.length === 0) return none('not_due_yet', 'لم يحن وقت أي مرحلة بعد.', nextStepAt);

  // نأخذ أبكر مرحلة مستحقة غير منفَّذة (ترتيب إنساني: لا قفزات)
  const step = due[0];
  if (!step) return none('all_steps_done', 'لا مراحل مستحقة.', nextStepAt);

  // حدود التذكيرات للمستخدم
  if (step.action === 'remind_user') {
    if (ctx.remindersSentForEntry >= ESCALATION_LIMITS.maxRemindersPerEntry) {
      return none('rate_limit', 'بلغنا الحد الأقصى للتذكيرات على هذا الموعد.', nextStepAt);
    }
    if (isWithinQuietHours(step.dueAt, ctx.quietHours)) {
      const deferred = deferToNextAllowedInstant(ctx.now, ctx.quietHours);
      return {
        ...base,
        action: 'remind_user',
        stage: step.stage,
        reason: 'quiet_hours',
        deferUntil: deferred,
        nextStepAt: deferred,
        explanation: 'ساعات الهدوء مفعّلة — سيُؤجَّل التنبيه حتى نهايتها.',
      };
    }
    return {
      ...base,
      action: 'remind_user',
      stage: step.stage,
      reason: 'due',
      nextStepAt,
      explanation: step.label,
    };
  }

  // ── مراحل الطرف الثالث: بوابة صارمة ──
  if (!ctx.autoEscalationEnabled) {
    return none('feature_disabled', 'التصعيد التلقائي غير مفعّل في هذه المرحلة من المنتج.', nextStepAt);
  }
  if (!ctx.consent.autoEscalationGranted || ctx.consent.revokedAt) {
    return none('consent', 'لا موافقة صريحة من الشخص — لا يُرسل أي تنبيه لأي طرف ثالث.', nextStepAt);
  }
  const contactIndex = step.targetContactIndex ?? 1;
  if (ctx.acceptedTrustedContacts < contactIndex) {
    return none('no_trusted_contact', 'لا توجد جهة موثوقة **قبلت** الدعوة لهذا المستوى.', nextStepAt);
  }
  if (ctx.thirdPartyAlertsToday >= ESCALATION_LIMITS.maxThirdPartyAlertsPerDay) {
    return none('rate_limit', 'بلغنا الحد الأقصى لتنبيهات الطرف الثالث اليوم.', nextStepAt);
  }
  if (
    ctx.lastThirdPartyAlertAt &&
    (ctx.now.getTime() - ctx.lastThirdPartyAlertAt.getTime()) / 60_000 <
      ESCALATION_LIMITS.minMinutesBetweenThirdPartyAlerts
  ) {
    return none('rate_limit', 'مرّ وقت قصير جدًا منذ آخر تنبيه لطرف ثالث.', nextStepAt);
  }
  if (isWithinQuietHours(ctx.now, ctx.quietHours)) {
    const deferred = deferToNextAllowedInstant(ctx.now, ctx.quietHours);
    return {
      ...base,
      action: 'alert_trusted_contact',
      stage: step.stage,
      reason: 'quiet_hours',
      deferUntil: deferred,
      targetContactIndex: contactIndex,
      withEmergencyGuidance: Boolean(step.withEmergencyGuidance),
      nextStepAt: deferred,
      explanation: 'ساعات الهدوء مفعّلة — يُؤجَّل تنبيه الطرف الثالث حتى الصباح.',
    };
  }

  return {
    ...base,
    action: step.withEmergencyGuidance ? 'show_emergency_guidance' : 'alert_trusted_contact',
    stage: step.stage,
    reason: 'due',
    targetContactIndex: contactIndex,
    withEmergencyGuidance: Boolean(step.withEmergencyGuidance),
    nextStepAt,
    explanation: step.label,
  };
}

/**
 * الإيقاف الفوري: إذا أكّد أي شخص (بما فيه جهة موثوقة) "تم الاطمئنان عليه ❤️"
 * تتوقف كل التنبيهات فورًا وتعود الحالة إلى 🟢.
 */
export function shouldStopAllAlerts(checkInConfirmed: boolean): boolean {
  return checkInConfirmed;
}
