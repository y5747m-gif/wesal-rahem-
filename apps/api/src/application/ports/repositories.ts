import type {
  AttemptOutcome,
  CheckInStatus,
  EntryStatus,
  ExceptionAction,
  InviteStatus,
  LocalTime,
  Locale,
  NotificationAudience,
  NotificationChannel,
  NotificationStatus,
  PersonStatus,
  UserId,
  Weekday,
} from '@wesal/shared';
import type { EscalationStage } from '@wesal/shared';
import type {
  AuditLogRecord,
  CheckInRecord,
  CommunicationAttemptRecord,
  ConsentRecord,
  ContactInvitationRecord,
  DeviceRecord,
  EscalationRecord,
  EscalationRuleRecord,
  NotificationRecord,
  OtpRecord,
  PersonRecord,
  PrivacySettingsRecord,
  ScheduleEntryRecord,
  ScheduleExceptionRecord,
  ScheduleRecord,
  ScheduledJobRecord,
  SessionRecord,
  SyncOperationRecord,
  TrustedContactRecord,
  UserRecord,
  WebCheckInLinkRecord,
} from './records';

/**
 * منافذ المستودعات (Ports) — طبقة التطبيق تعرف "ماذا" تحتاج فقط،
 * وطبقة البنية التحتية تنفّذ "كيف". كل التحقق من الصلاحيات يحدث في الخادم.
 */

export interface ListPersonsFilter {
  ownerUserId: UserId;
  q?: string;
  statuses?: PersonStatus[];
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

export interface UserRepository {
  findById(id: UserId): Promise<UserRecord | null>;
  findByPhoneHash(phoneHash: string): Promise<UserRecord | null>;
  create(data: Omit<UserRecord, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<UserRecord>;
  update(id: UserId, patch: Partial<UserRecord>): Promise<UserRecord>;
  softDelete(id: UserId): Promise<void>;
}

export interface OtpRepository {
  create(data: Omit<OtpRecord, 'createdAt'>): Promise<OtpRecord>;
  findLatestActive(phoneHash: string, now: Date): Promise<OtpRecord | null>;
  incrementAttempts(id: string): Promise<void>;
  markConsumed(id: string, at: Date): Promise<void>;
  countRecentRequests(phoneHash: string, since: Date): Promise<number>;
  revokePrevious(phoneHash: string, beforeId: string): Promise<void>;
}

export interface SessionRepository {
  create(data: Omit<SessionRecord, 'createdAt'>): Promise<SessionRecord>;
  findByRefreshTokenHash(hash: string): Promise<SessionRecord | null>;
  findById(id: string): Promise<SessionRecord | null>;
  revoke(id: string, at: Date): Promise<void>;
  revokeAllForUser(userId: UserId, at: Date): Promise<void>;
}

export interface DeviceRepository {
  upsertByToken(data: {
    userId: UserId;
    platform: DeviceRecord['platform'];
    pushToken: string | null;
    pushTokenHash: string | null;
    locale: Locale;
    timezone: string;
    appVersion: string | null;
    lastSeenAt: Date;
  }): Promise<DeviceRecord>;
  findById(id: string): Promise<DeviceRecord | null>;
  findActiveByUser(userId: UserId): Promise<DeviceRecord[]>;
  touch(id: string, at: Date): Promise<void>;
}

export interface PersonRepository {
  findById(id: string): Promise<PersonRecord | null>;
  findByIdForUser(id: string, userId: UserId): Promise<PersonRecord | null>;
  list(filter: ListPersonsFilter): Promise<{ items: PersonRecord[]; total: number }>;
  listAllOwned(ownerUserId: UserId): Promise<PersonRecord[]>;
  listActive(limit?: number): Promise<PersonRecord[]>;
  countOwned(ownerUserId: UserId): Promise<number>;
  create(data: Omit<PersonRecord, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<PersonRecord>;
  update(id: string, patch: Partial<PersonRecord>): Promise<PersonRecord>;
  softDelete(id: string): Promise<void>;
  updateStatusCache(id: string, status: PersonStatus, at: Date): Promise<void>;
  touchLastCheckIn(
    id: string,
    data: { lastCheckInAt: Date; lastCheckInMethod: CheckInRecord['method']; lastContactAt: Date },
  ): Promise<void>;
}

export interface ScheduleRepository {
  findByPerson(personId: string, options?: { activeOnly?: boolean }): Promise<ScheduleRecord | null>;
  findTemporaryForPerson(personId: string, at: Date): Promise<ScheduleRecord | null>;
  create(
    data: Omit<ScheduleRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<ScheduleRecord>;
  update(id: string, patch: Partial<ScheduleRecord>): Promise<ScheduleRecord>;
  deactivate(id: string): Promise<void>;
}

export interface ScheduleExceptionRepository {
  listForPerson(personId: string, fromDate?: string, toDate?: string): Promise<ScheduleExceptionRecord[]>;
  findByPersonAndDate(personId: string, date: string, action?: ExceptionAction): Promise<ScheduleExceptionRecord | null>;
  create(data: Omit<ScheduleExceptionRecord, 'createdAt'>): Promise<ScheduleExceptionRecord>;
  remove(id: string): Promise<void>;
}

export interface EntryRangeFilter {
  personIds?: string[];
  fromLocalDate?: string;
  toLocalDate?: string;
  from?: Date;
  to?: Date;
  statuses?: EntryStatus[];
  limit?: number;
}

export interface ScheduleEntryRepository {
  findById(id: string): Promise<ScheduleEntryRecord | null>;
  findByPersonAndLocalDate(personId: string, localDate: string): Promise<ScheduleEntryRecord[]>;
  findByPersonAndInstant(personId: string, scheduledFor: Date): Promise<ScheduleEntryRecord | null>;
  list(filter: EntryRangeFilter): Promise<ScheduleEntryRecord[]>;
  insertMany(
    rows: Omit<ScheduleEntryRecord, 'createdAt' | 'updatedAt'>[],
  ): Promise<number>;
  updateStatus(
    id: string,
    patch: Pick<Partial<ScheduleEntryRecord>, 'status' | 'completedAt' | 'completedBy' | 'snoozedUntil' | 'cancelledAt' | 'lastEvaluatedAt'>,
  ): Promise<void>;
  markEvaluated(ids: string[], at: Date): Promise<void>;
  hasEntryForLocalDateTime(personId: string, localDate: string, localTime: LocalTime): Promise<boolean>;
  deleteUpcomingForPerson(personId: string, afterLocalDate: string): Promise<number>;
}

export interface CheckInRepository {
  findByIdempotencyKey(userId: UserId | null, key: string): Promise<CheckInRecord | null>;
  findById(id: string): Promise<CheckInRecord | null>;
  create(data: Omit<CheckInRecord, 'createdAt'>): Promise<CheckInRecord>;
  listForPerson(personId: string, options?: { limit?: number; from?: Date; to?: Date }): Promise<CheckInRecord[]>;
  listForEntries(entryIds: string[]): Promise<CheckInRecord[]>;
  latestForPerson(personId: string): Promise<CheckInRecord | null>;
  countForPersonBetween(personId: string, from: Date, to: Date): Promise<number>;
  countSnoozesForEntry(entryId: string): Promise<number>;
}

export interface AttemptRepository {
  create(data: Omit<CommunicationAttemptRecord, 'createdAt'>): Promise<CommunicationAttemptRecord>;
  findByIdempotencyKey(key: string): Promise<CommunicationAttemptRecord | null>;
  listForPerson(personId: string, options?: { limit?: number; from?: Date; to?: Date }): Promise<CommunicationAttemptRecord[]>;
  latestForPerson(personId: string): Promise<CommunicationAttemptRecord | null>;
  listPendingRetries(before: Date, limit: number): Promise<CommunicationAttemptRecord[]>;
}

export interface ContactInvitationRepository {
  create(data: Omit<ContactInvitationRecord, 'createdAt'>): Promise<ContactInvitationRecord>;
  findById(id: string): Promise<ContactInvitationRecord | null>;
  findByTokenHash(tokenHash: string): Promise<ContactInvitationRecord | null>;
  listForPerson(personId: string): Promise<ContactInvitationRecord[]>;
  listExpirable(now: Date, limit: number): Promise<ContactInvitationRecord[]>;
  updateStatus(id: string, status: InviteStatus, respondedAt: Date): Promise<ContactInvitationRecord>;
  purgePhone(id: string): Promise<void>;
  findActiveByPhoneHash(personId: string, phoneHash: string): Promise<ContactInvitationRecord | null>;
}

export interface TrustedContactRepository {
  create(data: Omit<TrustedContactRecord, 'createdAt'>): Promise<TrustedContactRecord>;
  listForPerson(personId: string, options?: { acceptedOnly?: boolean }): Promise<TrustedContactRecord[]>;
  findById(id: string): Promise<TrustedContactRecord | null>;
  countAcceptedForPerson(personId: string): Promise<number>;
  withdraw(id: string, at: Date): Promise<void>;
  removeForInvitation(invitationId: string): Promise<void>;
}

export interface EscalationRuleRepository {
  findByPerson(personId: string): Promise<EscalationRuleRecord | null>;
  upsert(data: Omit<EscalationRuleRecord, 'createdAt' | 'updatedAt'>): Promise<EscalationRuleRecord>;
  recordConsent(
    personId: string,
    consent: { grantedAt: Date | null; revokedAt: Date | null; version: string | null },
  ): Promise<void>;
}

export interface EscalationRepository {
  create(data: Omit<EscalationRecord, 'createdAt'>): Promise<EscalationRecord>;
  listForEntry(entryId: string): Promise<EscalationRecord[]>;
  completedStagesForEntry(entryId: string): Promise<EscalationStage[]>;
  resolveForPerson(personId: string, at: Date, reason: string): Promise<number>;
  countThirdPartyAlertsToday(personId: string, dayStartUtc: Date): Promise<number>;
  lastThirdPartyAlertAt(personId: string): Promise<Date | null>;
}

export interface NotificationRecordInput {
  userId: UserId | null;
  deviceId?: string | null;
  personId?: string | null;
  entryId?: string | null;
  invitationId?: string | null;
  channel: NotificationChannel;
  audience: NotificationAudience;
  templateKey: NotificationRecord['templateKey'];
  locale: Locale;
  title: string;
  body: string;
  actionsJson: string;
  dataJson: string;
  stage?: EscalationStage | null;
  status: NotificationStatus;
  scheduledFor: Date;
  idempotencyKey: string;
  recipientAddressEncrypted?: string | null;
}

export interface NotificationRepository {
  create(data: NotificationRecordInput): Promise<NotificationRecord>;
  findByIdempotencyKey(key: string): Promise<NotificationRecord | null>;
  updateStatus(
    id: string,
    patch: Partial<Pick<NotificationRecord, 'status' | 'sentAt' | 'deliveredAt' | 'failedAt' | 'attempts' | 'lastError' | 'scheduledFor' | 'readAt'>>,
  ): Promise<void>;
  listForUser(userId: UserId, options?: { unreadOnly?: boolean; limit?: number; offset?: number }): Promise<{
    items: NotificationRecord[];
    total: number;
  }>;
  markRead(ids: string[], at: Date): Promise<number>;
  markAllRead(userId: UserId, at: Date): Promise<number>;
  cancelPendingForPerson(personId: string, reason: string): Promise<number>;
  listPending(before: Date, limit: number): Promise<NotificationRecord[]>;
  countByAudienceToday(audience: NotificationAudience, personId: string, dayStartUtc: Date): Promise<number>;
}

export interface ConsentRepository {
  create(data: Omit<ConsentRecord, 'createdAt'>): Promise<ConsentRecord>;
  findActive(subjectType: ConsentRecord['subjectType'], subjectId: string, scope: ConsentRecord['scope']): Promise<ConsentRecord | null>;
  revoke(id: string, at: Date): Promise<void>;
  listForSubject(subjectType: ConsentRecord['subjectType'], subjectId: string): Promise<ConsentRecord[]>;
}

export interface AuditLogRepository {
  append(data: Omit<AuditLogRecord, 'createdAt' | 'id'>): Promise<void>;
  listForPerson(personId: string, limit?: number): Promise<AuditLogRecord[]>;
}

export interface SyncOperationRepository {
  findByIdempotencyKey(userId: UserId, key: string): Promise<SyncOperationRecord | null>;
  create(data: Omit<SyncOperationRecord, 'createdAt'>): Promise<SyncOperationRecord>;
  markApplied(id: string, entityId: string | null, resultJson: string | null, at: Date): Promise<void>;
  markRejected(id: string, errorCode: string, messageAr: string, at: Date): Promise<void>;
}

export interface ScheduledJobRepository {
  enqueue(data: Omit<ScheduledJobRecord, 'createdAt' | 'completedAt'>): Promise<ScheduledJobRecord | null>;
  findByIdempotencyKey(key: string): Promise<ScheduledJobRecord | null>;
  claimDue(now: Date, limit: number, workerId: string): Promise<ScheduledJobRecord[]>;
  markDone(id: string, at: Date): Promise<void>;
  markFailed(id: string, error: string, retryAt: Date | null): Promise<void>;
  cancelByKindAndPerson(kind: ScheduledJobRecord['kind'], personId: string): Promise<number>;
  /** الإيقاف الفوري لمهام موعد محدد بعد تسجيل الاطمئنان */
  cancelByEntry(entryId: string): Promise<number>;
}

export interface WebCheckInLinkRepository {
  create(data: Omit<WebCheckInLinkRecord, 'createdAt'>): Promise<WebCheckInLinkRecord>;
  findByTokenHash(tokenHash: string): Promise<WebCheckInLinkRecord | null>;
  markUsed(id: string, at: Date): Promise<void>;
  listActiveForPerson(personId: string, now: Date): Promise<WebCheckInLinkRecord[]>;
}

export interface PrivacySettingsRepository {
  findByUser(userId: UserId): Promise<PrivacySettingsRecord | null>;
  upsert(data: Omit<PrivacySettingsRecord, 'updatedAt'>): Promise<PrivacySettingsRecord>;
}

export interface AllRepositories {
  users: UserRepository;
  otps: OtpRepository;
  sessions: SessionRepository;
  devices: DeviceRepository;
  persons: PersonRepository;
  schedules: ScheduleRepository;
  scheduleExceptions: ScheduleExceptionRepository;
  scheduleEntries: ScheduleEntryRepository;
  checkIns: CheckInRepository;
  attempts: AttemptRepository;
  contactInvitations: ContactInvitationRepository;
  trustedContacts: TrustedContactRepository;
  escalationRules: EscalationRuleRepository;
  escalations: EscalationRepository;
  notifications: NotificationRepository;
  consents: ConsentRepository;
  auditLogs: AuditLogRepository;
  syncOperations: SyncOperationRepository;
  scheduledJobs: ScheduledJobRepository;
  webCheckInLinks: WebCheckInLinkRepository;
  privacySettings: PrivacySettingsRepository;
}

/** أنواع غير مستخدمة مباشرة أعلاه لكن تُصدَّر للاتساق */
export type { Weekday, AttemptOutcome, CheckInStatus };
