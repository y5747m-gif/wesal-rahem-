import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type {
  EscalationStage,
  Locale,
  LocalTime,
  NotificationAudience,
  NotificationChannel,
  NotificationStatus,
  NotificationTemplate,
  UserId,
} from '@wesal/shared';
import type {
  AuditLogRecord,
  EscalationRecord,
  EscalationRuleRecord,
  NotificationRecord,
  ScheduledJobRecord,
} from '../../application/ports/records';
import type {
  AuditLogRepository,
  EscalationRepository,
  EscalationRuleRepository,
  NotificationRecordInput,
  NotificationRepository,
  ScheduledJobRepository,
} from '../../application/ports/repositories';
import { DATA_SOURCE } from './repository-tokens';
import {
  SqlRepository,
  asBoolean,
  asDate,
  asDateOrNull,
  asJson,
  asLocalTime,
  asStringOrNull,
  toPgTime,
} from './sql-repository';

/** مستودعات قواعد التصعيد وسجلاته والإشعارات وطابور المهام وسجل التدقيق. */

interface RuleRow {
  person_id: string;
  enabled: boolean;
  auto_escalation_enabled: boolean;
  reminder_delay_minutes: number;
  second_reminder_delay_minutes: number;
  trusted_contact_delay_minutes: number;
  next_contact_delay_minutes: number;
  max_contacts: number;
  grace_period_minutes: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_timezone: string;
  emergency_guidance: boolean;
  auto_escalation_consent_granted_at: Date | null;
  auto_escalation_consent_revoked_at: Date | null;
  consent_version: string | null;
  created_at: Date;
  updated_at: Date;
}

const RULE_COLUMNS = `person_id, enabled, auto_escalation_enabled, reminder_delay_minutes,
  second_reminder_delay_minutes, trusted_contact_delay_minutes, next_contact_delay_minutes,
  max_contacts, grace_period_minutes, quiet_hours_start, quiet_hours_end, quiet_hours_timezone,
  emergency_guidance, auto_escalation_consent_granted_at, auto_escalation_consent_revoked_at,
  consent_version, created_at, updated_at`;

@Injectable()
export class SqlEscalationRuleRepository extends SqlRepository implements EscalationRuleRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: RuleRow): EscalationRuleRecord {
    return {
      personId: row.person_id,
      enabled: asBoolean(row.enabled),
      autoEscalationEnabled: asBoolean(row.auto_escalation_enabled),
      reminderDelayMinutes: Number(row.reminder_delay_minutes),
      secondReminderDelayMinutes: Number(row.second_reminder_delay_minutes),
      trustedContactDelayMinutes: Number(row.trusted_contact_delay_minutes),
      nextContactDelayMinutes: Number(row.next_contact_delay_minutes),
      maxContacts: Number(row.max_contacts),
      gracePeriodMinutes: Number(row.grace_period_minutes),
      quietHoursStart: asLocalTime(row.quiet_hours_start) as LocalTime,
      quietHoursEnd: asLocalTime(row.quiet_hours_end) as LocalTime,
      quietHoursTimezone: row.quiet_hours_timezone,
      emergencyGuidance: asBoolean(row.emergency_guidance),
      autoEscalationConsentGrantedAt: asDateOrNull(row.auto_escalation_consent_granted_at),
      autoEscalationConsentRevokedAt: asDateOrNull(row.auto_escalation_consent_revoked_at),
      consentVersion: asStringOrNull(row.consent_version),
      createdAt: asDate(row.created_at),
      updatedAt: asDate(row.updated_at),
    };
  }

  async findByPerson(personId: string): Promise<EscalationRuleRecord | null> {
    const row = await this.one<RuleRow>(`SELECT ${RULE_COLUMNS} FROM escalation_rules WHERE person_id = $1`, [personId]);
    return row ? this.map(row) : null;
  }

  async upsert(data: Omit<EscalationRuleRecord, 'createdAt' | 'updatedAt'>): Promise<EscalationRuleRecord> {
    const row = await this.one<RuleRow>(
      `INSERT INTO escalation_rules (
         person_id, enabled, auto_escalation_enabled, reminder_delay_minutes, second_reminder_delay_minutes,
         trusted_contact_delay_minutes, next_contact_delay_minutes, max_contacts, grace_period_minutes,
         quiet_hours_start, quiet_hours_end, quiet_hours_timezone, emergency_guidance,
         auto_escalation_consent_granted_at, auto_escalation_consent_revoked_at, consent_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (person_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         reminder_delay_minutes = EXCLUDED.reminder_delay_minutes,
         second_reminder_delay_minutes = EXCLUDED.second_reminder_delay_minutes,
         trusted_contact_delay_minutes = EXCLUDED.trusted_contact_delay_minutes,
         next_contact_delay_minutes = EXCLUDED.next_contact_delay_minutes,
         max_contacts = EXCLUDED.max_contacts,
         grace_period_minutes = EXCLUDED.grace_period_minutes,
         quiet_hours_start = EXCLUDED.quiet_hours_start,
         quiet_hours_end = EXCLUDED.quiet_hours_end,
         quiet_hours_timezone = EXCLUDED.quiet_hours_timezone,
         emergency_guidance = EXCLUDED.emergency_guidance,
         consent_version = EXCLUDED.consent_version,
         -- لا يُفعَّل التصعيد التلقائي إلا بموافقة سارية (قيد في القاعدة أيضًا)
         auto_escalation_enabled = CASE
           WHEN EXCLUDED.auto_escalation_enabled AND EXCLUDED.auto_escalation_consent_granted_at IS NOT NULL
                AND EXCLUDED.auto_escalation_consent_revoked_at IS NULL THEN true
           ELSE false END,
         auto_escalation_consent_granted_at = COALESCE(escalation_rules.auto_escalation_consent_granted_at, EXCLUDED.auto_escalation_consent_granted_at),
         auto_escalation_consent_revoked_at = EXCLUDED.auto_escalation_consent_revoked_at
       RETURNING ${RULE_COLUMNS}`,
      [
        data.personId,
        data.enabled,
        data.autoEscalationEnabled,
        data.reminderDelayMinutes,
        data.secondReminderDelayMinutes,
        data.trustedContactDelayMinutes,
        data.nextContactDelayMinutes,
        data.maxContacts,
        data.gracePeriodMinutes,
        toPgTime(data.quietHoursStart),
        toPgTime(data.quietHoursEnd),
        data.quietHoursTimezone,
        data.emergencyGuidance,
        data.autoEscalationConsentGrantedAt,
        data.autoEscalationConsentRevokedAt,
        data.consentVersion,
      ],
    );
    if (!row) throw new Error('Failed to upsert escalation rule');
    return this.map(row);
  }

  async recordConsent(
    personId: string,
    consent: { grantedAt: Date | null; revokedAt: Date | null; version: string | null },
  ): Promise<void> {
    await this.query(
      `UPDATE escalation_rules
       SET auto_escalation_consent_granted_at = COALESCE($2, auto_escalation_consent_granted_at),
           auto_escalation_consent_revoked_at = $3,
           consent_version = COALESCE($4, consent_version),
           -- سحب الموافقة يوقف التصعيد التلقائي فورًا
           auto_escalation_enabled = CASE WHEN $3 IS NULL THEN auto_escalation_enabled ELSE false END
       WHERE person_id = $1`,
      [personId, consent.grantedAt, consent.revokedAt, consent.version],
    );
  }
}

interface EscalationRow {
  id: string;
  person_id: string;
  entry_id: string;
  stage: number;
  action: string;
  reason: string;
  triggered_at: Date;
  resolved_at: Date | null;
  status: EscalationRecord['status'];
  defer_until: Date | null;
  created_at: Date;
}

@Injectable()
export class SqlEscalationRepository extends SqlRepository implements EscalationRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: EscalationRow): EscalationRecord {
    return {
      id: row.id,
      personId: row.person_id,
      entryId: row.entry_id,
      stage: Number(row.stage) as EscalationStage,
      action: row.action,
      reason: row.reason,
      triggeredAt: asDate(row.triggered_at),
      resolvedAt: asDateOrNull(row.resolved_at),
      status: row.status,
      deferUntil: asDateOrNull(row.defer_until),
      createdAt: asDate(row.created_at),
    };
  }

  private static readonly COLUMNS =
    'id, person_id, entry_id, stage, action, reason, triggered_at, resolved_at, status, defer_until, created_at';

  async create(data: Omit<EscalationRecord, 'createdAt'>): Promise<EscalationRecord> {
    const row = await this.one<EscalationRow>(
      `INSERT INTO escalations (id, person_id, entry_id, stage, action, reason, triggered_at, resolved_at, status, defer_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (entry_id, stage) DO NOTHING
       RETURNING ${SqlEscalationRepository.COLUMNS}`,
      [
        data.id,
        data.personId,
        data.entryId,
        data.stage,
        data.action,
        data.reason,
        data.triggeredAt,
        data.resolvedAt,
        data.status,
        data.deferUntil,
      ],
    );
    if (row) return this.map(row);
    // مرحلة منفَّذة مسبقًا على نفس الموعد — لا تكرار
    const existing = await this.one<EscalationRow>(
      `SELECT ${SqlEscalationRepository.COLUMNS} FROM escalations WHERE entry_id = $1 AND stage = $2 LIMIT 1`,
      [data.entryId, data.stage],
    );
    if (existing) return this.map(existing);
    throw new Error('Failed to record escalation');
  }

  async listForEntry(entryId: string): Promise<EscalationRecord[]> {
    const rows = await this.query<EscalationRow>(
      `SELECT ${SqlEscalationRepository.COLUMNS} FROM escalations WHERE entry_id = $1 ORDER BY stage ASC`,
      [entryId],
    );
    return rows.map((r) => this.map(r));
  }

  async completedStagesForEntry(entryId: string): Promise<EscalationStage[]> {
    const rows = await this.query<{ stage: number }>(
      `SELECT stage FROM escalations WHERE entry_id = $1 AND status IN ('active','resolved','deferred') ORDER BY stage`,
      [entryId],
    );
    return rows.map((r) => Number(r.stage) as EscalationStage);
  }

  async resolveForPerson(personId: string, at: Date, reason: string): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `UPDATE escalations SET status = 'resolved', resolved_at = $2, reason = reason || ' | ' || $3
       WHERE person_id = $1 AND status IN ('active','deferred') RETURNING id`,
      [personId, at, reason],
    );
    return rows.length;
  }

  async countThirdPartyAlertsToday(personId: string, dayStartUtc: Date): Promise<number> {
    return this.count(
      `SELECT count(*)::int FROM escalations
       WHERE person_id = $1 AND triggered_at >= $2 AND action = 'alert_trusted_contact'`,
      [personId, dayStartUtc],
    );
  }

  async lastThirdPartyAlertAt(personId: string): Promise<Date | null> {
    return this.scalar<Date>(
      `SELECT max(triggered_at) FROM escalations WHERE person_id = $1 AND action = 'alert_trusted_contact'`,
      [personId],
    );
  }
}

interface NotificationRow {
  id: string;
  user_id: string | null;
  device_id: string | null;
  person_id: string | null;
  entry_id: string | null;
  invitation_id: string | null;
  channel: NotificationChannel;
  audience: NotificationAudience;
  template_key: NotificationTemplate;
  locale: string;
  title: string;
  body: string;
  actions: unknown;
  data: unknown;
  stage: number | null;
  status: NotificationStatus;
  scheduled_for: Date;
  sent_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  attempts: number;
  last_error: string | null;
  idempotency_key: string;
  read_at: Date | null;
  recipient_address_encrypted: string | null;
  created_at: Date;
}

const NOTIFICATION_COLUMNS = `id, user_id, device_id, person_id, entry_id, invitation_id, channel, audience,
  template_key, locale, title, body, actions, data, stage, status, scheduled_for, sent_at, delivered_at,
  failed_at, attempts, last_error, idempotency_key, read_at, recipient_address_encrypted, created_at`;

@Injectable()
export class SqlNotificationRepository extends SqlRepository implements NotificationRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: NotificationRow): NotificationRecord {
    return {
      id: row.id,
      userId: (asStringOrNull(row.user_id) as UserId | null) ?? null,
      deviceId: asStringOrNull(row.device_id),
      personId: asStringOrNull(row.person_id),
      entryId: asStringOrNull(row.entry_id),
      invitationId: asStringOrNull(row.invitation_id),
      channel: row.channel,
      audience: row.audience,
      templateKey: row.template_key,
      locale: (row.locale === 'en' ? 'en' : 'ar') as Locale,
      title: row.title,
      body: row.body,
      actionsJson: JSON.stringify(asJson(row.actions, [])),
      dataJson: JSON.stringify(asJson(row.data, {})),
      stage: row.stage === null ? null : (Number(row.stage) as EscalationStage),
      status: row.status,
      scheduledFor: asDate(row.scheduled_for),
      sentAt: asDateOrNull(row.sent_at),
      deliveredAt: asDateOrNull(row.delivered_at),
      failedAt: asDateOrNull(row.failed_at),
      attempts: Number(row.attempts),
      lastError: asStringOrNull(row.last_error),
      idempotencyKey: row.idempotency_key,
      readAt: asDateOrNull(row.read_at),
      recipientAddressEncrypted: asStringOrNull(row.recipient_address_encrypted),
      createdAt: asDate(row.created_at),
    };
  }

  async create(data: NotificationRecordInput): Promise<NotificationRecord> {
    const row = await this.one<NotificationRow>(
      `INSERT INTO notifications (
         user_id, device_id, person_id, entry_id, invitation_id, channel, audience, template_key,
         locale, title, body, actions, data, stage, status, scheduled_for, idempotency_key,
         recipient_address_encrypted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${NOTIFICATION_COLUMNS}`,
      [
        data.userId,
        data.deviceId ?? null,
        data.personId ?? null,
        data.entryId ?? null,
        data.invitationId ?? null,
        data.channel,
        data.audience,
        data.templateKey,
        data.locale,
        data.title,
        data.body,
        data.actionsJson,
        data.dataJson,
        data.stage ?? null,
        data.status,
        data.scheduledFor,
        data.idempotencyKey,
        data.recipientAddressEncrypted ?? null,
      ],
    );
    if (row) return this.map(row);
    const existing = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existing) return existing;
    throw new Error('Failed to create notification');
  }

  async findByIdempotencyKey(key: string): Promise<NotificationRecord | null> {
    const row = await this.one<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE idempotency_key = $1 LIMIT 1`,
      [key],
    );
    return row ? this.map(row) : null;
  }

  async updateStatus(
    id: string,
    patch: Partial<
      Pick<
        NotificationRecord,
        'status' | 'sentAt' | 'deliveredAt' | 'failedAt' | 'attempts' | 'lastError' | 'scheduledFor' | 'readAt'
      >
    >,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (patch.status !== undefined) push('status', patch.status);
    if (patch.sentAt !== undefined) push('sent_at', patch.sentAt);
    if (patch.deliveredAt !== undefined) push('delivered_at', patch.deliveredAt);
    if (patch.failedAt !== undefined) push('failed_at', patch.failedAt);
    if (patch.attempts !== undefined) push('attempts', patch.attempts);
    if (patch.lastError !== undefined) push('last_error', patch.lastError);
    if (patch.scheduledFor !== undefined) push('scheduled_for', patch.scheduledFor);
    if (patch.readAt !== undefined) push('read_at', patch.readAt);

    if (sets.length === 0) return;
    params.push(id);
    await this.query(`UPDATE notifications SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  }

  async listForUser(
    userId: UserId,
    options?: { unreadOnly?: boolean; limit?: number; offset?: number },
  ): Promise<{ items: NotificationRecord[]; total: number }> {
    const where = ['user_id = $1'];
    const params: unknown[] = [userId];
    if (options?.unreadOnly) where.push('read_at IS NULL');
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await this.count(`SELECT count(*)::int FROM notifications ${whereSql}`, params);
    params.push(options?.limit ?? 50, options?.offset ?? 0);
    const rows = await this.query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications ${whereSql}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.map((r) => this.map(r)), total };
  }

  async markRead(ids: string[], at: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.query<{ id: string }>(
      `UPDATE notifications SET read_at = $2 WHERE id = ANY($1) AND read_at IS NULL RETURNING id`,
      [ids, at],
    );
    return rows.length;
  }

  async markAllRead(userId: UserId, at: Date): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL RETURNING id`,
      [userId, at],
    );
    return rows.length;
  }

  /** الإيقاف الفوري: عند تأكيد الاطمئنان تُلغى كل التنبيهات المعلّقة لهذا الشخص */
  async cancelPendingForPerson(personId: string, reason: string): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `UPDATE notifications SET status = 'cancelled', last_error = $2
       WHERE person_id = $1 AND status IN ('queued') RETURNING id`,
      [personId, reason],
    );
    return rows.length;
  }

  async listPending(before: Date, limit: number): Promise<NotificationRecord[]> {
    const rows = await this.query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications
       WHERE status = 'queued' AND scheduled_for <= $1
       ORDER BY scheduled_for ASC LIMIT $2`,
      [before, limit],
    );
    return rows.map((r) => this.map(r));
  }

  async countByAudienceToday(
    audience: NotificationAudience,
    personId: string,
    dayStartUtc: Date,
  ): Promise<number> {
    return this.count(
      `SELECT count(*)::int FROM notifications
       WHERE audience = $1 AND person_id = $2 AND created_at >= $3
         AND status IN ('queued','sent','delivered')`,
      [audience, personId, dayStartUtc],
    );
  }
}

interface JobRow {
  id: string;
  kind: ScheduledJobRecord['kind'];
  run_at: Date;
  payload: unknown;
  status: ScheduledJobRecord['status'];
  attempts: number;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string;
  created_at: Date;
  completed_at: Date | null;
}

const JOB_COLUMNS = `id, kind, run_at, payload, status, attempts, locked_at, locked_by, last_error,
  idempotency_key, created_at, completed_at`;

@Injectable()
export class SqlScheduledJobRepository extends SqlRepository implements ScheduledJobRepository {
  private readonly logger = new Logger(SqlScheduledJobRepository.name);

  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: JobRow): ScheduledJobRecord {
    return {
      id: row.id,
      kind: row.kind,
      runAt: asDate(row.run_at),
      payloadJson: JSON.stringify(asJson(row.payload, {})),
      status: row.status,
      attempts: Number(row.attempts),
      lockedAt: asDateOrNull(row.locked_at),
      lockedBy: asStringOrNull(row.locked_by),
      lastError: asStringOrNull(row.last_error),
      idempotencyKey: row.idempotency_key,
      createdAt: asDate(row.created_at),
      completedAt: asDateOrNull(row.completed_at),
    };
  }

  /** إدراج مهمة مع منع التكرار عبر idempotency_key — يُعيد null إن كانت موجودة */
  async enqueue(data: Omit<ScheduledJobRecord, 'createdAt' | 'completedAt'>): Promise<ScheduledJobRecord | null> {
    const row = await this.one<JobRow>(
      `INSERT INTO scheduled_jobs (id, kind, run_at, payload, status, attempts, locked_at, locked_by, last_error, idempotency_key)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${JOB_COLUMNS}`,
      [
        data.id,
        data.kind,
        data.runAt,
        data.payloadJson,
        data.status,
        data.attempts,
        data.lockedAt,
        data.lockedBy,
        data.lastError,
        data.idempotencyKey,
      ],
    );
    return row ? this.map(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<ScheduledJobRecord | null> {
    const row = await this.one<JobRow>(
      `SELECT ${JOB_COLUMNS} FROM scheduled_jobs WHERE idempotency_key = $1 LIMIT 1`,
      [key],
    );
    return row ? this.map(row) : null;
  }

  /**
   * حجز المهام المستحقة — FOR UPDATE SKIP LOCKED يسمح بتشغيل أكثر من عامل
   * دون تكرار التنفيذ.
   */
  async claimDue(now: Date, limit: number, workerId: string): Promise<ScheduledJobRecord[]> {
    const rows = await this.query<JobRow>(
      `UPDATE scheduled_jobs
       SET status = 'running', locked_at = $2, locked_by = $3, attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM scheduled_jobs
         WHERE status = 'pending' AND run_at <= $1
         ORDER BY run_at ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED
       )
       RETURNING ${JOB_COLUMNS}`,
      [now, now, workerId, limit],
    );
    return rows.map((r) => this.map(r));
  }

  async markDone(id: string, at: Date): Promise<void> {
    await this.query(
      `UPDATE scheduled_jobs SET status = 'done', completed_at = $2, locked_at = NULL, locked_by = NULL WHERE id = $1`,
      [id, at],
    );
  }

  async markFailed(id: string, error: string, retryAt: Date | null): Promise<void> {
    await this.query(
      `UPDATE scheduled_jobs
       SET status = CASE WHEN $3::timestamptz IS NULL THEN 'failed' ELSE 'pending' END,
           run_at = COALESCE($3, run_at),
           last_error = $2, locked_at = NULL, locked_by = NULL
       WHERE id = $1`,
      [id, error.slice(0, 2000), retryAt],
    );
  }

  async cancelByEntry(entryId: string): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `UPDATE scheduled_jobs SET status = 'cancelled', completed_at = now()
       WHERE status IN ('pending','running') AND payload->>'entryId' = $1
       RETURNING id`,
      [entryId],
    );
    return rows.length;
  }

  async cancelByKindAndPerson(kind: ScheduledJobRecord['kind'], personId: string): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `UPDATE scheduled_jobs SET status = 'cancelled', completed_at = now()
       WHERE kind = $1 AND status IN ('pending','running') AND payload->>'personId' = $2
       RETURNING id`,
      [kind, personId],
    );
    return rows.length;
  }
}

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_kind: AuditLogRecord['actorKind'];
  action: string;
  entity_type: string;
  entity_id: string | null;
  person_id: string | null;
  family_id: string | null;
  metadata: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}

@Injectable()
export class SqlAuditLogRepository extends SqlRepository implements AuditLogRepository {
  private readonly logger = new Logger('AuditLog');

  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: AuditRow): AuditLogRecord {
    return {
      id: row.id,
      actorUserId: (asStringOrNull(row.actor_user_id) as UserId | null) ?? null,
      actorKind: row.actor_kind,
      action: row.action,
      entityType: row.entity_type,
      entityId: asStringOrNull(row.entity_id),
      personId: asStringOrNull(row.person_id),
      familyId: asStringOrNull(row.family_id),
      metadataJson: row.metadata === null ? null : JSON.stringify(row.metadata),
      ip: asStringOrNull(row.ip),
      userAgent: asStringOrNull(row.user_agent),
      createdAt: asDate(row.created_at),
    };
  }

  /** سجل التدقيق لا يُفشل العملية الأساسية: أي خطأ يُسجَّل في اللوج فقط */
  async append(data: Omit<AuditLogRecord, 'createdAt' | 'id'>): Promise<void> {
    try {
      await this.query(
        `INSERT INTO audit_logs (actor_user_id, actor_kind, action, entity_type, entity_id, person_id, family_id, metadata, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [
          data.actorUserId,
          data.actorKind,
          data.action,
          data.entityType,
          data.entityId,
          data.personId,
          data.familyId,
          data.metadataJson ?? null,
          data.ip,
          data.userAgent,
        ],
      );
    } catch (error) {
      this.logger.error(`Failed to write audit log for action=${data.action}: ${(error as Error).message}`);
    }
  }

  async listForPerson(personId: string, limit = 100): Promise<AuditLogRecord[]> {
    const rows = await this.query<AuditRow>(
      `SELECT * FROM audit_logs WHERE person_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [personId, limit],
    );
    return rows.map((r) => this.map(r));
  }
}
