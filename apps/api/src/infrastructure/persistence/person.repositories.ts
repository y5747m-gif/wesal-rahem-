import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type {
  EntrySource,
  EntryStatus,
  ExceptionAction,
  LocalTime,
  PauseReason,
  PersonStatus,
  Relationship,
  ScheduleKind,
  UserId,
  Weekday,
} from '@wesal/shared';
import type {
  PersonRecord,
  ScheduleEntryRecord,
  ScheduleExceptionRecord,
  ScheduleRecord,
} from '../../application/ports/records';
import type {
  EntryRangeFilter,
  ListPersonsFilter,
  PersonRepository,
  ScheduleEntryRepository,
  ScheduleExceptionRepository,
  ScheduleRepository,
} from '../../application/ports/repositories';
import { SYMBOLS, type FieldEncryptionService } from '../../application/ports/services';
import { DATA_SOURCE } from './repository-tokens';
import {
  SqlRepository,
  asBoolean,
  asDate,
  asDateOrNull,
  asLocalTime,
  asLocalTimeArray,
  asStringOrNull,
  asWeekdayArray,
  placeholders,
  toPgTime,
  toPgTimeArray,
} from './sql-repository';

/**
 * مستودعات الأشخاص والجداول والمواعيد.
 *
 * ملاحظة أمنية: `list` و`findByIdForUser` تفرضان ملكية الشخص على مستوى الاستعلام
 * (وليس في الذاكرة فقط) — التحقق من الصلاحيات يحدث دائمًا على الخادم.
 */

interface PersonRow {
  id: string;
  owner_user_id: string;
  family_id: string | null;
  display_name: string;
  relationship: Relationship;
  phone_hash: string | null;
  phone_encrypted: string | null;
  photo_url: string | null;
  notes: string | null;
  timezone: string;
  senior_mode: boolean;
  is_app_user: boolean;
  linked_user_id: string | null;
  grace_period_minutes: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  paused_until: Date | null;
  pause_reason: PauseReason | null;
  pause_note: string | null;
  deceased_reported_at: Date | null;
  deceased_reported_by: string | null;
  consent_status: PersonRecord['consentStatus'];
  last_check_in_at: Date | null;
  last_check_in_method: PersonRecord['lastCheckInMethod'];
  last_contact_at: Date | null;
  cached_status: PersonStatus;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const PERSON_COLUMNS = `
  id, owner_user_id, family_id, display_name, relationship, phone_hash, phone_encrypted, photo_url,
  notes, timezone, senior_mode, is_app_user, linked_user_id, grace_period_minutes,
  quiet_hours_start, quiet_hours_end, paused_until, pause_reason, pause_note,
  deceased_reported_at, deceased_reported_by, consent_status,
  last_check_in_at, last_check_in_method, last_contact_at, cached_status,
  created_at, updated_at, deleted_at`;

/** نفس الأعمدة مع بادئة الجدول (للاستعلامات التي تستخدم اسمًا مستعارًا) */
const PERSON_COLUMNS_P = PERSON_COLUMNS.split(',')
  .map((c) => `p.${c.trim()}`)
  .join(', ');

@Injectable()
export class SqlPersonRepository extends SqlRepository implements PersonRepository {
  constructor(
    @Inject(DATA_SOURCE) dataSource: DataSource,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
  ) {
    super(dataSource);
  }

  private map(row: PersonRow): PersonRecord {
    return {
      id: row.id,
      ownerUserId: row.owner_user_id as UserId,
      familyId: asStringOrNull(row.family_id),
      displayName: row.display_name,
      relationship: row.relationship,
      phone: row.phone_encrypted ? this.crypto.decrypt(row.phone_encrypted) : null,
      phoneHash: asStringOrNull(row.phone_hash),
      photoUrl: asStringOrNull(row.photo_url),
      notes: asStringOrNull(row.notes),
      timezone: row.timezone,
      seniorMode: asBoolean(row.senior_mode),
      isAppUser: asBoolean(row.is_app_user),
      linkedUserId: (asStringOrNull(row.linked_user_id) as UserId | null) ?? null,
      gracePeriodMinutes: Number(row.grace_period_minutes),
      quietHoursStart: asLocalTime(row.quiet_hours_start),
      quietHoursEnd: asLocalTime(row.quiet_hours_end),
      pausedUntil: asDateOrNull(row.paused_until),
      pauseReason: row.pause_reason ?? null,
      pauseNote: asStringOrNull(row.pause_note),
      deceasedReportedAt: asDateOrNull(row.deceased_reported_at),
      deceasedReportedBy: (asStringOrNull(row.deceased_reported_by) as UserId | null) ?? null,
      consentStatus: row.consent_status ?? 'not_required',
      lastCheckInAt: asDateOrNull(row.last_check_in_at),
      lastCheckInMethod: row.last_check_in_method ?? null,
      lastContactAt: asDateOrNull(row.last_contact_at),
      cachedStatus: row.cached_status,
      createdAt: asDate(row.created_at),
      updatedAt: asDate(row.updated_at),
      deletedAt: asDateOrNull(row.deleted_at),
    };
  }

  async findById(id: string): Promise<PersonRecord | null> {
    const row = await this.one<PersonRow>(
      `SELECT ${PERSON_COLUMNS} FROM persons WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return row ? this.map(row) : null;
  }

  async findByIdForUser(id: string, userId: UserId): Promise<PersonRecord | null> {
    const row = await this.one<PersonRow>(
      `SELECT ${PERSON_COLUMNS} FROM persons
       WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
      [id, userId],
    );
    return row ? this.map(row) : null;
  }

  async list(filter: ListPersonsFilter): Promise<{ items: PersonRecord[]; total: number }> {
    const where: string[] = ['p.owner_user_id = $1'];
    const params: unknown[] = [filter.ownerUserId];
    const push = (value: unknown): number => {
      params.push(value);
      return params.length;
    };

    if (!filter.includeDeleted) where.push('p.deleted_at IS NULL');

    const term = filter.q?.trim();
    if (term) {
      const likeIdx = push(`%${term.toLowerCase()}%`);
      const conditions = [`wesal_search_key(p.display_name) LIKE $${likeIdx}`, `p.relationship LIKE $${likeIdx}`];
      // إن كان المدخل رقم هاتف: نطابق بصمته (لا يمكن البحث داخل قيمة مشفّرة)
      if (/^[\d+\s()-]{6,}$/.test(term)) {
        const hashIdx = push(this.crypto.hmac(term.replace(/[\s()-]/g, '')));
        conditions.push(`p.phone_hash = $${hashIdx}`);
      }
      where.push(`(${conditions.join(' OR ')})`);
    }

    if (filter.statuses && filter.statuses.length > 0) {
      where.push(`p.cached_status = ANY($${push(filter.statuses)})`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await this.count(`SELECT count(*)::int FROM persons p ${whereSql}`, params);

    const limitIdx = push(filter.limit);
    const offsetIdx = push(filter.offset);
    const rows = await this.query<PersonRow>(
      `SELECT ${PERSON_COLUMNS_P}
       FROM persons p ${whereSql}
       ORDER BY
         CASE p.cached_status
           WHEN 'needs_followup' THEN 0
           WHEN 'unverified' THEN 1
           WHEN 'due' THEN 2
           WHEN 'paused' THEN 3
           WHEN 'upcoming' THEN 4
           WHEN 'checked' THEN 5
           ELSE 6
         END,
         p.last_check_in_at NULLS FIRST,
         p.created_at ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return { items: rows.map((r) => this.map(r)), total };
  }

  async listAllOwned(ownerUserId: UserId): Promise<PersonRecord[]> {
    const rows = await this.query<PersonRow>(
      `SELECT ${PERSON_COLUMNS} FROM persons WHERE owner_user_id = $1 AND deleted_at IS NULL`,
      [ownerUserId],
    );
    return rows.map((r) => this.map(r));
  }

  async countOwned(ownerUserId: UserId): Promise<number> {
    return this.count('SELECT count(*)::int FROM persons WHERE owner_user_id = $1 AND deleted_at IS NULL', [
      ownerUserId,
    ]);
  }

  async create(data: Omit<PersonRecord, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<PersonRecord> {
    const row = await this.one<PersonRow>(
      `INSERT INTO persons (
         id, owner_user_id, family_id, display_name, relationship, phone_hash, phone_encrypted,
         photo_url, notes, timezone, senior_mode, is_app_user, linked_user_id, grace_period_minutes,
         quiet_hours_start, quiet_hours_end, paused_until, pause_reason, pause_note,
         consent_status, cached_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING ${PERSON_COLUMNS}`,
      [
        data.id,
        data.ownerUserId,
        data.familyId,
        data.displayName.trim(),
        data.relationship,
        data.phoneHash,
        data.phone ? this.crypto.encrypt(data.phone) : null,
        data.photoUrl,
        data.notes,
        data.timezone,
        data.seniorMode,
        data.isAppUser,
        data.linkedUserId,
        data.gracePeriodMinutes,
        toPgTime(data.quietHoursStart),
        toPgTime(data.quietHoursEnd),
        data.pausedUntil,
        data.pauseReason,
        data.pauseNote,
        data.consentStatus,
        data.cachedStatus,
      ],
    );
    if (!row) throw new Error('Failed to create person');
    return this.map(row);
  }

  async update(id: string, patch: Partial<PersonRecord>): Promise<PersonRecord> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (patch.displayName !== undefined) push('display_name', patch.displayName.trim());
    if (patch.relationship !== undefined) push('relationship', patch.relationship);
    if (patch.photoUrl !== undefined) push('photo_url', patch.photoUrl);
    if (patch.notes !== undefined) push('notes', patch.notes);
    if (patch.timezone !== undefined) push('timezone', patch.timezone);
    if (patch.seniorMode !== undefined) push('senior_mode', patch.seniorMode);
    if (patch.isAppUser !== undefined) push('is_app_user', patch.isAppUser);
    if (patch.linkedUserId !== undefined) push('linked_user_id', patch.linkedUserId);
    if (patch.gracePeriodMinutes !== undefined) push('grace_period_minutes', patch.gracePeriodMinutes);
    if (patch.quietHoursStart !== undefined) push('quiet_hours_start', toPgTime(patch.quietHoursStart));
    if (patch.quietHoursEnd !== undefined) push('quiet_hours_end', toPgTime(patch.quietHoursEnd));
    if (patch.pausedUntil !== undefined) push('paused_until', patch.pausedUntil);
    if (patch.pauseReason !== undefined) push('pause_reason', patch.pauseReason);
    if (patch.pauseNote !== undefined) push('pause_note', patch.pauseNote);
    if (patch.consentStatus !== undefined) push('consent_status', patch.consentStatus);
    if (patch.cachedStatus !== undefined) push('cached_status', patch.cachedStatus);
    if (patch.deceasedReportedAt !== undefined) push('deceased_reported_at', patch.deceasedReportedAt);
    if (patch.deceasedReportedBy !== undefined) push('deceased_reported_by', patch.deceasedReportedBy);
    if (patch.phone !== undefined) {
      push('phone_encrypted', patch.phone ? this.crypto.encrypt(patch.phone) : null);
      push('phone_hash', patch.phone ? (patch.phoneHash ?? this.crypto.hmac(patch.phone)) : null);
    }

    if (sets.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error('Person not found');
      return existing;
    }

    params.push(id);
    const row = await this.one<PersonRow>(
      `UPDATE persons SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING ${PERSON_COLUMNS}`,
      params,
    );
    if (!row) throw new Error('Person not found');
    return this.map(row);
  }

  async softDelete(id: string): Promise<void> {
    await this.query('UPDATE persons SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
  }

  async updateStatusCache(id: string, status: PersonStatus, at: Date): Promise<void> {
    await this.query('UPDATE persons SET cached_status = $2, updated_at = $3 WHERE id = $1', [id, status, at]);
  }

  async touchLastCheckIn(
    id: string,
    data: { lastCheckInAt: Date; lastCheckInMethod: PersonRecord['lastCheckInMethod']; lastContactAt: Date },
  ): Promise<void> {
    await this.query(
      `UPDATE persons
       SET last_check_in_at = GREATEST(COALESCE(last_check_in_at, $2), $2),
           last_check_in_method = $3,
           last_contact_at = GREATEST(COALESCE(last_contact_at, $4), $4)
       WHERE id = $1`,
      [id, data.lastCheckInAt, data.lastCheckInMethod, data.lastContactAt],
    );
  }
}

// ───────────────────────────────── الجداول ─────────────────────────────────

interface ScheduleRow {
  id: string;
  person_id: string;
  kind: ScheduleKind;
  weekdays: number[];
  times: string[];
  timezone: string;
  active: boolean;
  is_temporary: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: Date;
  updated_at: Date;
}

const SCHEDULE_COLUMNS = `id, person_id, kind, weekdays, times, timezone, active, is_temporary,
  effective_from, effective_to, created_at, updated_at`;

@Injectable()
export class SqlScheduleRepository extends SqlRepository implements ScheduleRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: ScheduleRow): ScheduleRecord {
    return {
      id: row.id,
      personId: row.person_id,
      kind: row.kind,
      weekdays: asWeekdayArray(row.weekdays) as Weekday[],
      times: asLocalTimeArray(row.times),
      timezone: row.timezone,
      active: asBoolean(row.active),
      isTemporary: asBoolean(row.is_temporary),
      effectiveFrom: String(row.effective_from).slice(0, 10),
      effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
      createdAt: asDate(row.created_at),
      updatedAt: asDate(row.updated_at),
    };
  }

  async findByPerson(personId: string, options?: { activeOnly?: boolean }): Promise<ScheduleRecord | null> {
    const activeOnly = options?.activeOnly ?? true;
    const row = await this.one<ScheduleRow>(
      `SELECT ${SCHEDULE_COLUMNS} FROM schedules
       WHERE person_id = $1 AND is_temporary = false ${activeOnly ? 'AND active' : ''}
       ORDER BY created_at DESC LIMIT 1`,
      [personId],
    );
    return row ? this.map(row) : null;
  }

  async findTemporaryForPerson(personId: string, at: Date): Promise<ScheduleRecord | null> {
    const row = await this.one<ScheduleRow>(
      `SELECT ${SCHEDULE_COLUMNS} FROM schedules
       WHERE person_id = $1 AND is_temporary AND active
         AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
       ORDER BY created_at DESC LIMIT 1`,
      [personId, at],
    );
    return row ? this.map(row) : null;
  }

  async create(data: Omit<ScheduleRecord, 'createdAt' | 'updatedAt'>): Promise<ScheduleRecord> {
    const row = await this.one<ScheduleRow>(
      `INSERT INTO schedules (id, person_id, kind, weekdays, times, timezone, active, is_temporary, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${SCHEDULE_COLUMNS}`,
      [
        data.id,
        data.personId,
        data.kind,
        data.weekdays,
        toPgTimeArray(data.times),
        data.timezone,
        data.active,
        data.isTemporary,
        data.effectiveFrom,
        data.effectiveTo,
      ],
    );
    if (!row) throw new Error('Failed to create schedule');
    return this.map(row);
  }

  async update(id: string, patch: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (patch.kind !== undefined) push('kind', patch.kind);
    if (patch.weekdays !== undefined) push('weekdays', patch.weekdays);
    if (patch.times !== undefined) push('times', toPgTimeArray(patch.times));
    if (patch.timezone !== undefined) push('timezone', patch.timezone);
    if (patch.active !== undefined) push('active', patch.active);
    if (patch.isTemporary !== undefined) push('is_temporary', patch.isTemporary);
    if (patch.effectiveFrom !== undefined) push('effective_from', patch.effectiveFrom);
    if (patch.effectiveTo !== undefined) push('effective_to', patch.effectiveTo);

    if (sets.length === 0) {
      const row = await this.one<ScheduleRow>(`SELECT ${SCHEDULE_COLUMNS} FROM schedules WHERE id = $1`, [id]);
      if (!row) throw new Error('Schedule not found');
      return this.map(row);
    }

    params.push(id);
    const row = await this.one<ScheduleRow>(
      `UPDATE schedules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SCHEDULE_COLUMNS}`,
      params,
    );
    if (!row) throw new Error('Schedule not found');
    return this.map(row);
  }

  async deactivate(id: string): Promise<void> {
    await this.query('UPDATE schedules SET active = false WHERE id = $1', [id]);
  }
}

// ──────────────────────────── استثناءات الأيام ────────────────────────────

interface ExceptionRow {
  id: string;
  person_id: string;
  date: string;
  action: ExceptionAction;
  times: string[];
  note: string | null;
  created_at: Date;
}

@Injectable()
export class SqlScheduleExceptionRepository extends SqlRepository implements ScheduleExceptionRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: ExceptionRow): ScheduleExceptionRecord {
    return {
      id: row.id,
      personId: row.person_id,
      date: String(row.date).slice(0, 10),
      action: row.action,
      times: asLocalTimeArray(row.times),
      note: asStringOrNull(row.note),
      createdAt: asDate(row.created_at),
    };
  }

  private static readonly COLUMNS = 'id, person_id, date, action, times, note, created_at';

  async listForPerson(personId: string, fromDate?: string, toDate?: string): Promise<ScheduleExceptionRecord[]> {
    const params: unknown[] = [personId];
    let sql = `SELECT ${SqlScheduleExceptionRepository.COLUMNS} FROM schedule_exceptions WHERE person_id = $1`;
    if (fromDate) sql += ` AND date >= $${params.push(fromDate)}`;
    if (toDate) sql += ` AND date <= $${params.push(toDate)}`;
    sql += ' ORDER BY date ASC';
    const rows = await this.query<ExceptionRow>(sql, params);
    return rows.map((r) => this.map(r));
  }

  async findByPersonAndDate(
    personId: string,
    date: string,
    action?: ExceptionAction,
  ): Promise<ScheduleExceptionRecord | null> {
    const params: unknown[] = [personId, date];
    let sql = `SELECT ${SqlScheduleExceptionRepository.COLUMNS} FROM schedule_exceptions WHERE person_id = $1 AND date = $2`;
    if (action) sql += ` AND action = $${params.push(action)}`;
    sql += ' LIMIT 1';
    const row = await this.one<ExceptionRow>(sql, params);
    return row ? this.map(row) : null;
  }

  async create(data: Omit<ScheduleExceptionRecord, 'createdAt'>): Promise<ScheduleExceptionRecord> {
    const row = await this.one<ExceptionRow>(
      `INSERT INTO schedule_exceptions (id, person_id, date, action, times, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (person_id, date, action) DO UPDATE SET times = EXCLUDED.times, note = EXCLUDED.note
       RETURNING ${SqlScheduleExceptionRepository.COLUMNS}`,
      [data.id, data.personId, data.date, data.action, toPgTimeArray(data.times), data.note],
    );
    if (!row) throw new Error('Failed to create schedule exception');
    return this.map(row);
  }

  async remove(id: string): Promise<void> {
    await this.query('DELETE FROM schedule_exceptions WHERE id = $1', [id]);
  }
}

// ───────────────────────────── المواعيد الأسبوعية ─────────────────────────────

interface EntryRow {
  id: string;
  person_id: string;
  scheduled_for: Date;
  local_date: string;
  local_time: string;
  timezone: string;
  status: EntryStatus;
  source: EntrySource;
  exception_id: string | null;
  grace_until: Date | null;
  snoozed_until: Date | null;
  completed_at: Date | null;
  completed_by: string | null;
  cancelled_at: Date | null;
  last_evaluated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const ENTRY_COLUMNS = `id, person_id, scheduled_for, local_date, local_time, timezone, status, source,
  exception_id, grace_until, snoozed_until, completed_at, completed_by, cancelled_at,
  last_evaluated_at, created_at, updated_at`;

@Injectable()
export class SqlScheduleEntryRepository extends SqlRepository implements ScheduleEntryRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: EntryRow): ScheduleEntryRecord {
    return {
      id: row.id,
      personId: row.person_id,
      scheduledFor: asDate(row.scheduled_for),
      localDate: String(row.local_date).slice(0, 10),
      localTime: asLocalTime(row.local_time) as LocalTime,
      timezone: row.timezone,
      status: row.status,
      source: row.source,
      exceptionId: asStringOrNull(row.exception_id),
      graceUntil: asDateOrNull(row.grace_until),
      snoozedUntil: asDateOrNull(row.snoozed_until),
      completedAt: asDateOrNull(row.completed_at),
      completedBy: (asStringOrNull(row.completed_by) as UserId | null) ?? null,
      cancelledAt: asDateOrNull(row.cancelled_at),
      lastEvaluatedAt: asDateOrNull(row.last_evaluated_at),
      createdAt: asDate(row.created_at),
      updatedAt: asDate(row.updated_at),
    };
  }

  async findById(id: string): Promise<ScheduleEntryRecord | null> {
    const row = await this.one<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM schedule_entries WHERE id = $1`, [id]);
    return row ? this.map(row) : null;
  }

  async findByPersonAndLocalDate(personId: string, localDate: string): Promise<ScheduleEntryRecord[]> {
    const rows = await this.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM schedule_entries
       WHERE person_id = $1 AND local_date = $2 ORDER BY local_time ASC`,
      [personId, localDate],
    );
    return rows.map((r) => this.map(r));
  }

  async findByPersonAndInstant(personId: string, scheduledFor: Date): Promise<ScheduleEntryRecord | null> {
    const row = await this.one<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM schedule_entries WHERE person_id = $1 AND scheduled_for = $2 LIMIT 1`,
      [personId, scheduledFor],
    );
    return row ? this.map(row) : null;
  }

  async list(filter: EntryRangeFilter): Promise<ScheduleEntryRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (value: unknown) => {
      params.push(value);
      return params.length;
    };

    if (filter.personIds && filter.personIds.length > 0) where.push(`person_id = ANY($${push(filter.personIds)})`);
    if (filter.fromLocalDate) where.push(`local_date >= $${push(filter.fromLocalDate)}`);
    if (filter.toLocalDate) where.push(`local_date <= $${push(filter.toLocalDate)}`);
    if (filter.from) where.push(`scheduled_for >= $${push(filter.from)}`);
    if (filter.to) where.push(`scheduled_for < $${push(filter.to)}`);
    if (filter.statuses && filter.statuses.length > 0) where.push(`status = ANY($${push(filter.statuses)})`);

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filter.limit ?? 2000;
    const rows = await this.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM schedule_entries ${whereSql}
       ORDER BY scheduled_for ASC LIMIT $${push(limit)}`,
      params,
    );
    return rows.map((r) => this.map(r));
  }

  /** إدراج جماعي مع تجاهل المكرر (UNIQUE person_id, scheduled_for) — آمن عند إعادة التوليد */
  async insertMany(rows: Omit<ScheduleEntryRecord, 'createdAt' | 'updatedAt'>[]): Promise<number> {
    if (rows.length === 0) return 0;

    const values: string[] = [];
    const params: unknown[] = [];
    for (const row of rows) {
      const start = params.length;
      params.push(
        row.id,
        row.personId,
        row.scheduledFor,
        row.localDate,
        toPgTime(row.localTime),
        row.timezone,
        row.status,
        row.source,
        row.exceptionId,
        row.graceUntil,
        row.snoozedUntil,
        row.completedAt,
        row.completedBy,
        row.cancelledAt,
      );
      values.push(`(${placeholders(start + 1, 14)})`);
    }

    const result = await this.query<{ id: string }>(
      `INSERT INTO schedule_entries (
         id, person_id, scheduled_for, local_date, local_time, timezone, status, source,
         exception_id, grace_until, snoozed_until, completed_at, completed_by, cancelled_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (person_id, scheduled_for) DO NOTHING
       RETURNING id`,
      params,
    );
    return result.length;
  }

  async updateStatus(
    id: string,
    patch: Pick<
      Partial<ScheduleEntryRecord>,
      'status' | 'completedAt' | 'completedBy' | 'snoozedUntil' | 'cancelledAt' | 'lastEvaluatedAt'
    >,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (patch.status !== undefined) push('status', patch.status);
    if (patch.completedAt !== undefined) push('completed_at', patch.completedAt);
    if (patch.completedBy !== undefined) push('completed_by', patch.completedBy);
    if (patch.snoozedUntil !== undefined) push('snoozed_until', patch.snoozedUntil);
    if (patch.cancelledAt !== undefined) push('cancelled_at', patch.cancelledAt);
    push('last_evaluated_at', patch.lastEvaluatedAt ?? new Date());

    params.push(id);
    await this.query(
      `UPDATE schedule_entries SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );
  }

  async markEvaluated(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.query(`UPDATE schedule_entries SET last_evaluated_at = $2 WHERE id = ANY($1)`, [ids, at]);
  }

  async hasEntryForLocalDateTime(personId: string, localDate: string, localTime: LocalTime): Promise<boolean> {
    const n = await this.count(
      `SELECT count(*)::int FROM schedule_entries
       WHERE person_id = $1 AND local_date = $2 AND local_time = $3 AND status NOT IN ('cancelled','skipped')`,
      [personId, localDate, toPgTime(localTime)],
    );
    return n > 0;
  }

  async deleteUpcomingForPerson(personId: string, afterLocalDate: string): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `DELETE FROM schedule_entries
       WHERE person_id = $1 AND local_date >= $2 AND status IN ('upcoming') AND completed_at IS NULL
       RETURNING id`,
      [personId, afterLocalDate],
    );
    return rows.length;
  }
}

