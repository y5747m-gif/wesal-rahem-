/**
 * نصوص وصال — النبرة إنسانية دائمًا: طمأنينة ورحمة واهتمام وصلة وعائلة.
 * ❌ ممنوع: لغة التخويف، أو أي صياغة توحي بوفاة أو خطر مؤكد.
 *
 * هذا الملف هو العقد: كل نص يُعرض للمستخدم أو يُرسل في إشعار يجب أن يمر من هنا،
 * حتى تبقى الصياغة متطابقة بين التطبيق والخادم والإشعارات.
 */
import type { Relationship } from '../domain/relationships';
import type { CheckInMethod, CheckInStatus } from '../domain/checkin';
import type { PersonStatus } from '../domain/status';
import type { Weekday } from '../domain/schedule';
import type { EscalationStage } from '../domain/escalation';

export type Locale = 'ar' | 'en';

export interface WesalMessages {
  locale: Locale;
  direction: 'rtl' | 'ltr';
  brand: { name: string; tagline: string; dailyQuestion: string };
  nav: { home: string; family: string; schedule: string; logs: string; settings: string };
  common: {
    save: string;
    cancel: string;
    back: string;
    next: string;
    done: string;
    optional: string;
    required: string;
    search: string;
    close: string;
    retry: string;
    loading: string;
    today: string;
    tomorrow: string;
    yesterday: string;
    atTime: (time: string) => string;
    offlineNotice: string;
    syncingNotice: string;
    syncedNotice: string;
  };
  status: Record<PersonStatus, string>;
  statusHint: Record<PersonStatus, string>;
  relationship: Record<Relationship, string>;
  weekday: Record<Weekday, string>;
  weekdayShort: Record<Weekday, string>;
  checkInMethod: Record<CheckInMethod, string>;
  checkInStatus: Record<CheckInStatus, string>;
  actions: {
    reassured: string;
    calledNoAnswer: string;
    snooze: string;
    callNow: string;
    sendMessage: string;
    addPerson: string;
    editSchedule: string;
    pausePerson: string;
    resumePerson: string;
    iamFine: string;
    callYourFamily: string;
  };
  home: {
    morningGreeting: (count: number) => string;
    eveningGreeting: (count: number) => string;
    genericGreeting: (count: number) => string;
    noneDue: string;
    emptyTitle: string;
    emptyBody: string;
    sectionDueToday: string;
    sectionUpcoming: string;
    sectionDone: string;
    aiAssistantHint: string;
  };
  person: {
    title: string;
    addTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    relationshipLabel: string;
    scheduleLabel: string;
    phoneLabel: string;
    timezoneLabel: string;
    notesLabel: string;
    trustedContactLabel: string;
    lastCheckIn: string;
    lastCall: string;
    neverYet: string;
    weekSchedule: string;
    addedConfirmation: (name: string, relationship: string) => string;
    deletedConfirmation: (name: string) => string;
    pauseUntil: string;
    travelMode: string;
    seniorMode: string;
  };
  schedule: {
    kindDaily: string;
    kindSeveralDays: string;
    kindWeekly: string;
    kindCustom: string;
    pickDays: string;
    pickTime: string;
    pickTimes: string;
    weekTitle: string;
    nextWeekAutoCreated: string;
    exceptionTitle: string;
    exceptionThisWeekOnly: (name: string, time: string) => string;
    exceptionMove: string;
    exceptionSkip: string;
    exceptionAdd: string;
    removeException: string;
  };
  logs: {
    title: string;
    columns: { day: string; time: string; person: string; method: string; status: string };
    empty: string;
  };
  onboarding: {
    step1Title: string;
    step1Body: string;
    step2Title: string;
    step2Body: string;
    step3Title: string;
    step3Body: string;
    step4Title: string;
    step4Body: string;
    skip: string;
    getStarted: string;
  };
  auth: {
    phoneTitle: string;
    phoneBody: string;
    phoneLabel: string;
    sendCode: string;
    otpTitle: string;
    otpBody: (phone: string) => string;
    verify: string;
    resend: string;
    devCodeNotice: (code: string) => string;
    invalidCode: string;
    expiredCode: string;
    tooManyAttempts: string;
  };
  trustedContacts: {
    title: string;
    body: string;
    inviteTitle: string;
    nameLabel: string;
    phoneLabel: string;
    inviteSent: (name: string) => string;
    inviteAccepted: (name: string) => string;
    inviteDeclined: (name: string) => string;
    noTrustedContacts: string;
    removeInvite: string;
    consentReminder: string;
    /** صفحة قبول الدعوة (عامة) */
    acceptPageTitle: (inviterName: string, personName: string) => string;
    acceptPageBody: (personName: string) => string;
    acceptPageWhatIsShared: string[];
    acceptPageWhatIsNotShared: string[];
    accept: string;
    decline: string;
    withdrawn: string;
    withdrawAnytime: string;
  };
  notifications: {
    /** ❤️ تذكير إنساني عند الموعد */
    reminderTitle: (personName: string) => string;
    reminderBody: (personName: string, relationship: string) => string;
    reminderBodyVariantB: (personName: string) => string;
    reminderBodyVariantC: (relationship: string) => string;
    /** إعادة المحاولة */
    retryTitle: string;
    retryBody: (personName: string) => string;
    /** تم التسجيل */
    checkInDoneTitle: string;
    checkInDoneBody: (personName: string) => string;
    /** لم يتم التحقق — للمستخدم نفسه فقط (لا يُرسل لأي طرف ثالث) */
    unverifiedTitle: string;
    unverifiedBody: (personName: string) => string;
    /** رسالة الجهة الموثوقة بعد قبولها — النص المعتمد في الوثيقة حرفيًا */
    trustedAlertTitle: string;
    trustedAlertBody: (personName: string) => string;
    trustedAlertDisclaimer: string;
    trustedAlertCallAction: (personName: string) => string;
    trustedAlertConfirmAction: string;
    /** رسالة العائلة عندما يضغط الشخص "أنا بخير" */
    familyPersonIsFine: (personName: string, time: string) => string;
    /** رسالة الرابط لمن لا يثبّت التطبيق */
    webCheckInTitle: (personName: string) => string;
    webCheckInBody: (personName: string) => string;
    webCheckInButton: string;
    webCheckInExpired: string;
    webCheckInThanks: (personName: string) => string;
    /** تقرير أسبوعي (المرحلة 2) — النبرة إيجابية دائمًا ولا تُستخدم للتأنيب */
    weeklyReportTitle: string;
    weeklyReportBody: (count: number) => string;
  };
  senior: {
    greeting: string;
    question: (personName: string) => string;
    iAmFine: string;
    callFamily: string;
    confirmedToFamily: string;
  };
  escalation: {
    stage: Record<EscalationStage, string>;
    autoConsentTitle: string;
    autoConsentBody: string;
    autoConsentAccept: string;
    autoConsentDecline: string;
    quietHoursNotice: string;
    emergencyGuidanceTitle: string;
    emergencyGuidanceBody: string;
    stoppedBecauseConfirmed: string;
    notADangerStatement: string;
  };
  privacy: {
    whoSeesMeTitle: string;
    whoSeesMeBody: string;
    noMonitoringStatement: string;
    dataMinimisationStatement: string;
    consentRevocable: string;
    deleteAccount: string;
    deleteAccountWarning: string;
  };
  errors: {
    generic: string;
    network: string;
    notFound: string;
    forbidden: string;
    unauthorized: string;
    validation: string;
    conflict: string;
    rateLimited: string;
    serverError: string;
  };
}
