/**
 * معرّفات الكيانات — نصوص UUID بصيغة v4.
 * تُستخدم كنصوص (وليس أرقامًا) حتى لا تُسرَّب أحجام الجداول ولا يسهل تخمين المعرّفات.
 */
export type Uuid = string;

export type UserId = Uuid;
export type FamilyId = Uuid;
export type PersonId = Uuid;
export type ScheduleId = Uuid;
export type ScheduleEntryId = Uuid;
export type CheckInId = Uuid;
export type TrustedContactId = Uuid;
export type ContactInvitationId = Uuid;
export type NotificationId = Uuid;
export type EscalationId = Uuid;
export type DeviceId = Uuid;
export type AuditLogId = Uuid;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_RE.test(value);
}
