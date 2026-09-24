import type { Locale, NotificationAction, NotificationTemplate } from '@wesal/shared';
import {
  getMessages,
  formatTime,
} from '@wesal/shared';

/**
 * قوالب الإشعارات — النصوص كلها من `@wesal/shared/i18n` حتى تتطابق بين الخادم والتطبيق.
 *
 * ⚠️ لا تُرسل قوالب الطرف الثالث (trusted_contact.alert) إلا بعد اجتياز
 *    بوابة الموافقة في `escalation-policy`.
 */

export interface NotificationContent {
  templateKey: NotificationTemplate;
  locale: Locale;
  title: string;
  body: string;
  actions: NotificationAction[];
  /** بيانات إضافية تُمرَّر للتطبيق (معرّفات فقط — لا أرقام هواتف ولا أسماء كاملة) */
  data: Record<string, string>;
}

interface PersonContext {
  personId: string;
  personName: string;
  relationshipLabel?: string;
  entryId?: string | null;
  timezone: string;
  locale: Locale;
}

const T = {
  reminderDue: 'reminder.due',
  reminderRetry: 'reminder.retry',
  checkInDone: 'check_in.done',
  unverifiedOwnerOnly: 'unverified.owner_only',
  trustedAlert: 'trusted_contact.alert',
  personIsFine: 'person.is_fine',
  webCheckIn: 'web.check_in_link',
  weeklyReport: 'report.weekly',
} as const satisfies Record<string, NotificationTemplate>;

/** 1) تذكير إنساني عند الموعد — مع الأزرار الثلاثة من الوثيقة */
export function buildReminderDue(ctx: PersonContext): NotificationContent {
  const m = getMessages(ctx.locale);
  return {
    templateKey: T.reminderDue,
    locale: ctx.locale,
    title: m.notifications.reminderTitle(ctx.personName),
    body: ctx.relationshipLabel
      ? m.notifications.reminderBody(ctx.personName, ctx.relationshipLabel)
      : m.notifications.reminderBodyVariantB(ctx.personName),
    actions: [
      { key: 'call_now', label: m.actions.callNow, personId: ctx.personId, entryId: ctx.entryId ?? undefined },
      { key: 'reassured', label: m.actions.reassured, personId: ctx.personId, entryId: ctx.entryId ?? undefined },
      { key: 'snooze', label: m.actions.snooze, personId: ctx.personId, entryId: ctx.entryId ?? undefined },
    ],
    data: { personId: ctx.personId, entryId: ctx.entryId ?? '' },
  };
}

/** 2) إعادة محاولة — لا لغة تأنيب */
export function buildReminderRetry(ctx: PersonContext): NotificationContent {
  const m = getMessages(ctx.locale);
  return {
    templateKey: T.reminderRetry,
    locale: ctx.locale,
    title: m.notifications.retryTitle,
    body: m.notifications.retryBody(ctx.personName),
    actions: [
      { key: 'call_now', label: m.actions.callNow, personId: ctx.personId, entryId: ctx.entryId ?? undefined },
      { key: 'called_no_answer', label: m.actions.calledNoAnswer, personId: ctx.personId, entryId: ctx.entryId ?? undefined },
      { key: 'reassured', label: m.actions.reassured, personId: ctx.personId, entryId: ctx.entryId ?? undefined },
    ],
    data: { personId: ctx.personId, entryId: ctx.entryId ?? '' },
  };
}

/** ✅ تأكيد التسجيل — تغذية راجعة إيجابية */
export function buildCheckInDone(ctx: PersonContext): NotificationContent {
  const m = getMessages(ctx.locale);
  return {
    templateKey: T.checkInDone,
    locale: ctx.locale,
    title: m.notifications.checkInDoneTitle,
    body: m.notifications.checkInDoneBody(ctx.personName),
    actions: [{ key: 'open_person', label: ctx.personName, personId: ctx.personId }],
    data: { personId: ctx.personId },
  };
}

/**
 * 🟠 "لم يتم التحقق" — **للمستخدم نفسه فقط**.
 * السبب الأول لعدم التحقق (المستخدم لم يسجّل) لا يُرسل لأي طرف ثالث أبدًا.
 */
export function buildUnverifiedForOwner(ctx: PersonContext): NotificationContent {
  const m = getMessages(ctx.locale);
  return {
    templateKey: T.unverifiedOwnerOnly,
    locale: ctx.locale,
    title: m.notifications.unverifiedTitle,
    body: m.notifications.unverifiedBody(ctx.personName),
    actions: [
      { key: 'call_now', label: m.actions.callNow, personId: ctx.personId },
      { key: 'reassured', label: m.actions.reassured, personId: ctx.personId },
    ],
    data: { personId: ctx.personId },
  };
}

/**
 * 3–4) تنبيه الجهة الموثوقة — النص المعتمد في الوثيقة حرفيًا،
 * ولا يُرسل إلا بعد الموافقة وقبول الدعوة.
 */
export function buildTrustedContactAlert(
  ctx: PersonContext & { acceptUrl?: string; confirmUrl?: string },
): NotificationContent {
  const m = getMessages(ctx.locale);
  return {
    templateKey: T.trustedAlert,
    locale: ctx.locale,
    title: m.notifications.trustedAlertTitle,
    body: `${m.notifications.trustedAlertBody(ctx.personName)} ${m.notifications.trustedAlertDisclaimer}`,
    actions: [
      {
        key: 'call_now',
        label: m.notifications.trustedAlertCallAction(ctx.personName),
        personId: ctx.personId,
        target: ctx.acceptUrl,
      },
      { key: 'confirm_fine', label: m.notifications.trustedAlertConfirmAction, personId: ctx.personId, target: ctx.confirmUrl },
    ],
    data: { personId: ctx.personId },
  };
}

/** رسالة العائلة عندما يضغط الشخص "أنا بخير" (وضع كبار السن / الرابط) */
export function buildPersonIsFine(ctx: PersonContext & { verifiedAt: Date | string }): NotificationContent {
  const m = getMessages(ctx.locale);
  const timeLabel = formatTime(ctx.verifiedAt, ctx.timezone, ctx.locale);
  return {
    templateKey: T.personIsFine,
    locale: ctx.locale,
    title: m.notifications.checkInDoneTitle,
    body: m.notifications.familyPersonIsFine(ctx.personName, timeLabel),
    actions: [{ key: 'open_person', label: ctx.personName, personId: ctx.personId }],
    data: { personId: ctx.personId },
  };
}

/** رسالة الرابط لمن لا يثبّت التطبيق (الرد بدون تثبيت — أولوية عالية) */
export function buildWebCheckInLink(
  ctx: PersonContext & { checkInUrl: string; expiresAt: Date | string },
): NotificationContent {
  const m = getMessages(ctx.locale);
  return {
    templateKey: T.webCheckIn,
    locale: ctx.locale,
    title: m.notifications.webCheckInTitle(ctx.personName),
    body: m.notifications.webCheckInBody(ctx.personName),
    actions: [{ key: 'confirm_fine', label: m.notifications.webCheckInButton, target: ctx.checkInUrl }],
    data: { personId: ctx.personId, expiresAt: new Date(ctx.expiresAt).toISOString() },
  };
}

/** التقرير الأسبوعي — نبرة إيجابية دائمًا، لا يُستخدم لتأنيب المستخدم */
export function buildWeeklyReport(ctx: { locale: Locale; completedCount: number }): NotificationContent {
  const m = getMessages(ctx.locale);
  return {
    templateKey: T.weeklyReport,
    locale: ctx.locale,
    title: m.notifications.weeklyReportTitle,
    body: m.notifications.weeklyReportBody(ctx.completedCount),
    actions: [],
    data: {},
  };
}
