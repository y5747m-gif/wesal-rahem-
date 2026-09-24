import type {
  AttemptOutcome,
  CheckInMethod,
  CheckInStatus,
  ConfirmedByKind,
  EntrySource,
  EntryStatus,
  ExceptionAction,
  InviteStatus,
  LocalTime,
  Locale,
  NotificationAudience,
  NotificationChannel,
  NotificationStatus,
  NotificationTemplate,
  PauseReason,
  PersonStatus,
  Relationship,
  ScheduleKind,
  UserId,
  Weekday,
} from '@wesal/shared';
import type { FontScaleKey, ThemeMode } from '@wesal/shared';
import type { EscalationStage } from '@wesal/shared';

/**
 * سجلات القراءة/الكتابة بين طبقة التطبيق وطبقة البنية التحتية.
 * أشكال مسطّحة (لا كيانات TypeORM) حتى يبقى النطاق والتطبيق مستقلين عن قاعدة البيانات.
 */

export interface UserRecord {
  id: UserId;
  phone: string;
  phoneHash: string;
  phoneVerifiedAt: Date | null;
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
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface OtpRecord {
  id: string;
  phoneHash: string;
  codeHash: string;
  purpose: 'login';
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface SessionRecord {
  id: string;
  userId: UserId;
  refreshTokenHash: string;
  deviceId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface DeviceRecord {
  id: string;
  userId: UserId;
  platform: 'ios' | 'android' | 'web';
  pushToken: string | null;
  pushTokenHash: string | null;
  locale: Locale;
  timezone: string;
  appVersion: string | null;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface PersonRecord {
  id: string;
  ownerUserId: UserId;
  familyId: string | null;
  displayName: string;
  relationship: Relationship;
  /** مشفّر في القاعدة — يُفكّ عند القراءة فقط لمن يملك الصلاحية */
  phone: string | null;
  phoneHash: string | null;
  photoUrl: string | null;
  notes: string | null;
  timezone: string;
  seniorMode: boolean;
  isAppUser: boolean;
  linkedUserId: UserId | null;
  gracePeriodMinutes: number;
  quietHoursStart: LocalTime | null;
  quietHoursEnd: LocalTime | null;
  pausedUntil: Date | null;
  pauseReason: PauseReason | null;
  pauseNote: string | null;
  deceasedReportedAt: Date | null;
  deceasedReportedBy: UserId | null;
  consentStatus: 'pending' | 'granted' | 'revoked' | 'not_required';
  lastCheckInAt: Date | null;
  lastCheckInMethod: CheckInMethod | null;
  lastContactAt: Date | null;
  /** الحالة المخزّنة (يحدّثها العامل) — تُعاد حساباتها عند القراءة لضمان الدقة */
  cachedStatus: PersonStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ScheduleRecord {
  id: string;
  personId: string;
  kind: ScheduleKind;
  weekdays: Weekday[];
  times: LocalTime[];
  timezone: string;
  active: boolean;
  /** جدول مؤقت أثناء السفر — يُستخدم بدل الجدول الأساسي خلال نافذته */
  isTemporary: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleExceptionRecord {
  id: string;
  personId: string;
  date: string;
  action: ExceptionAction;
  times: LocalTime[];
  note: string | null;
  createdAt: Date;
}

export interface ScheduleEntryRecord {
  id: string;
  personId: string;
  scheduledFor: Date;
  localDate: string;
  localTime: LocalTime;
  timezone: string;
  status: EntryStatus;
  source: EntrySource;
  exceptionId: string | null;
  graceUntil: Date | null;
  snoozedUntil: Date | null;
  completedAt: Date | null;
  completedBy: UserId | null;
  cancelledAt: Date | null;
  lastEvaluatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CheckInRecord {
  id: string;
  personId: string;
  entryId: string | null;
  occurredAt: Date;
  method: CheckInMethod;
  status: CheckInStatus;
  confirmedByKind: ConfirmedByKind;
  confirmedById: UserId | null;
  notes: string | null;
  idempotencyKey: string;
  clientOccurredAt: Date | null;
  syncedAt: Date | null;
  createdAt: Date;
}

export interface CommunicationAttemptRecord {
  id: string;
  personId: string;
  entryId: string | null;
  attemptedAt: Date;
  kind: 'call' | 'message';
  outcome: AttemptOutcome;
  retryAfter: Date | null;
  idempotencyKey: string;
  createdBy: UserId | null;
  createdAt: Date;
}

/**
 * دعوة جهة موثوقة — الرقم يُخزَّن **مشفّرًا** هنا فقط حتى القبول،
 * ولا يصبح `trusted_contact` دائمًا إلا بعد قبول الدعوة.
 */
export interface ContactInvitationRecord {
  id: string;
  personId: string;
  invitedByUserId: UserId;
  fullName: string;
  phoneEncrypted: string;
  phoneHash: string;
  relationship: Relationship | null;
  tokenHash: string;
  status: InviteStatus;
  scopes: string[];
  personalNote: string | null;
  invitedAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  createdAt: Date;
}

export interface TrustedContactRecord {
  id: string;
  personId: string;
  invitationId: string | null;
  userId: UserId | null;
  fullName: string;
  phone: string;
  phoneHash: string;
  relationship: Relationship | null;
  scopes: string[];
  status: InviteStatus;
  acceptedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
}

export interface EscalationRuleRecord {
  personId: string;
  enabled: boolean;
  autoEscalationEnabled: boolean;
  reminderDelayMinutes: number;
  secondReminderDelayMinutes: number;
  trustedContactDelayMinutes: number;
  nextContactDelayMinutes: number;
  maxContacts: number;
  gracePeriodMinutes: number;
  quietHoursStart: LocalTime;
  quietHoursEnd: LocalTime;
  quietHoursTimezone: string;
  emergencyGuidance: boolean;
  autoEscalationConsentGrantedAt: Date | null;
  autoEscalationConsentRevokedAt: Date | null;
  consentVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EscalationRecord {
  id: string;
  personId: string;
  entryId: string;
  stage: EscalationStage;
  action: string;
  reason: string;
  triggeredAt: Date;
  resolvedAt: Date | null;
  status: 'active' | 'resolved' | 'cancelled' | 'deferred';
  deferUntil: Date | null;
  createdAt: Date;
}

export interface NotificationRecord {
  id: string;
  userId: UserId | null;
  deviceId: string | null;
  personId: string | null;
  entryId: string | null;
  invitationId: string | null;
  channel: NotificationChannel;
  audience: NotificationAudience;
  templateKey: NotificationTemplate;
  locale: Locale;
  title: string;
  body: string;
  actionsJson: string;
  dataJson: string;
  stage: EscalationStage | null;
  status: NotificationStatus;
  scheduledFor: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  attempts: number;
  lastError: string | null;
  idempotencyKey: string;
  readAt: Date | null;
  recipientAddressEncrypted: string | null;
  createdAt: Date;
}

export interface ConsentRecord {
  id: string;
  subjectType: 'user' | 'person';
  subjectId: string;
  scope: 'auto_escalation' | 'data_sharing' | 'ai_features' | 'notifications' | 'web_check_in';
  granted: boolean;
  version: string;
  grantedAt: Date | null;
  revokedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: UserId | null;
  actorKind: 'user' | 'trusted_contact' | 'system' | 'worker';
  action: string;
  entityType: string;
  entityId: string | null;
  personId: string | null;
  familyId: string | null;
  metadataJson: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface SyncOperationRecord {
  id: string;
  userId: UserId;
  idempotencyKey: string;
  opType: string;
  payloadJson: string;
  clientOccurredAt: Date;
  status: 'applied' | 'duplicated' | 'rejected' | 'conflicted';
  entityId: string | null;
  errorCode: string | null;
  messageAr: string | null;
  resultJson: string | null;
  appliedAt: Date | null;
  createdAt: Date;
}

export interface ScheduledJobRecord {
  id: string;
  kind: 'reminder' | 'retry' | 'escalation' | 'entry_generation' | 'invite_expiry' | 'report';
  runAt: Date;
  payloadJson: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  attempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  idempotencyKey: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface WebCheckInLinkRecord {
  id: string;
  personId: string;
  entryId: string | null;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdBy: UserId | null;
  createdAt: Date;
}

export interface PrivacySettingsRecord {
  userId: UserId;
  shareCheckInWithFamily: boolean;
  allowTrustedContactAlerts: boolean;
  aiEnabled: boolean;
  locationSharingEnabled: boolean;
  dataRetentionDays: number;
  updatedAt: Date;
}
