/** رموز الحقن لكل مستودع — تفصل طبقة التطبيق عن تفاصيل TypeORM. */
export const REPOSITORIES = {
  users: Symbol('UserRepository'),
  otp: Symbol('OtpRepository'),
  sessions: Symbol('SessionRepository'),
  devices: Symbol('DeviceRepository'),
  persons: Symbol('PersonRepository'),
  schedules: Symbol('ScheduleRepository'),
  scheduleExceptions: Symbol('ScheduleExceptionRepository'),
  scheduleEntries: Symbol('ScheduleEntryRepository'),
  checkIns: Symbol('CheckInRepository'),
  attempts: Symbol('AttemptRepository'),
  contactInvitations: Symbol('ContactInvitationRepository'),
  trustedContacts: Symbol('TrustedContactRepository'),
  escalationRules: Symbol('EscalationRuleRepository'),
  escalations: Symbol('EscalationRepository'),
  notifications: Symbol('NotificationRepository'),
  consents: Symbol('ConsentRepository'),
  auditLogs: Symbol('AuditLogRepository'),
  syncOperations: Symbol('SyncOperationRepository'),
  scheduledJobs: Symbol('ScheduledJobRepository'),
  webCheckInLinks: Symbol('WebCheckInLinkRepository'),
  privacySettings: Symbol('PrivacySettingsRepository'),
} as const;

export const DATA_SOURCE = Symbol('WESAL_DATA_SOURCE');
export const MIGRATOR = Symbol('WESAL_MIGRATOR');
