/**
 * الجهة الموثوقة.
 * القاعدة: تُدعى أولًا وتقبل الدعوة **قبل** تخزين رقمها بشكل دائم أو وصول أي تنبيه إليها.
 * لذلك يُخزَّن الرقم في `contact_invitations` (مشفّرًا + بصمة للبحث) حتى القبول.
 */
export const InviteStatus = {
  Invited: 'invited',
  Accepted: 'accepted',
  Declined: 'declined',
  Revoked: 'revoked',
  Expired: 'expired',
} as const;

export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

/** ما الذي وافقت الجهة الموثوقة عليه */
export const ConsentScope = {
  /** استقبال تنبيه عند عدم تسجيل الاطمئنان */
  ReceiveAlerts: 'receive_alerts',
  /** تأكيد الاطمئنان نيابةً عن الشخص (يوقف التنبيهات فورًا) */
  ConfirmCheckIn: 'confirm_check_in',
  /** رؤية الاسم وصلة القرابة فقط — لا بيانات إضافية */
  SeeBasicProfile: 'see_basic_profile',
} as const;

export type ConsentScope = (typeof ConsentScope)[keyof typeof ConsentScope];

export const DEFAULT_TRUSTED_CONTACT_SCOPES: readonly ConsentScope[] = Object.freeze([
  ConsentScope.ReceiveAlerts,
  ConsentScope.ConfirmCheckIn,
  ConsentScope.SeeBasicProfile,
]);
