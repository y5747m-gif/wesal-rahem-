import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AttemptOutcome, CheckInMethod, CheckInStatus, ConfirmedByKind, UserId } from '@wesal/shared';
import type { CheckInRecord, CommunicationAttemptRecord, SyncOperationRecord } from '../../application/ports/records';
import type {
  AttemptRepository,
  CheckInRepository,
  SyncOperationRepository,
} from '../../application/ports/repositories';
import { DATA_SOURCE } from './repository-tokens';
import { SqlRepository, asDate, asDateOrNull, asStringOrNull } from './sql-repository';

/**
 * مستودعات الاطمئنان ومحاولات التواصل والمزامنة دون اتصال.
 *
 * قاعدة ذهبية: `idempotency_key` فريد في القاعدة — حتى لو أعاد التطبيق الإرسال
 * عشر مرات أثناء عودة الشبكة، يُسجَّل الاطمئنان مرة واحدة فقط.
 */

interface CheckInRow {
  id: string;
  person_id: string;
  entry_id: string | null;
  occurred_at: Date;
  method: CheckInMethod;
  status: CheckInStatus;
  confirmed_by_kind: ConfirmedByKind;
  confirmed_by_user_id: string | null;
  notes: string | null;
  idempotency_key: string;
  client_occurred_at: Date | null;
  synced_at: Date | null;
  created_at: Date;
}

const CHECK_IN_COLUMNS = `id, person_id, entry_id, occurred_at, method, status, confirmed_by_kind,
  confirmed_by_user_id, notes, idempotency_key, client_occurred_at, synced_at, created_at`;

@Injectable()
export class SqlCheckInRepository extends SqlRepository implements CheckInRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: CheckInRow): CheckInRecord {
    return {
      id: row.id,
      personId: row.person_id,
      entryId: asStringOrNull(row.entry_id),
      occurredAt: asDate(row.occurred_at),
      method: row.method,
      status: row.status,
      confirmedByKind: row.confirmed_by_kind,
      confirmedById: (asStringOrNull(row.confirmed_by_user_id) as UserId | null) ?? null,
      notes: asStringOrNull(row.notes),
      idempotencyKey: row.idempotency_key,
      clientOccurredAt: asDateOrNull(row.client_occurred_at),
      syncedAt: asDateOrNull(row.synced_at),
      createdAt: asDate(row.created_at),
    };
  }

  async findByIdempotencyKey(userId: UserId | null, key: string): Promise<CheckInRecord | null> {
    // المفتاح فريد عالميًا؛ userId يُستخدم فقط لتأكيد الملكية قبل كشف أي بيانات
    const row = await this.one<CheckInRow>(
      `SELECT ${CHECK_IN_COLUMNS} FROM check_ins c
       WHERE c.idempotency_key = $1
         AND ($2::uuid IS NULL OR c.confirmed_by_user_id = $2)
       LIMIT 1`,
      [key, userId],
    );
    return row ? this.map(row) : null;
  }

  async findById(id: string): Promise<CheckInRecord | null> {
    const row = await this.one<CheckInRow>(`SELECT ${CHECK_IN_COLUMNS} FROM check_ins WHERE id = $1`, [id]);
    return row ? this.map(row) : null;
  }

  async create(data: Omit<CheckInRecord, 'createdAt'>): Promise<CheckInRecord> {
    const row = await this.one<CheckInRow>(
      `INSERT INTO check_ins (
         id, person_id, entry_id, occurred_at, method, status, confirmed_by_kind,
         confirmed_by_user_id, notes, idempotency_key, client_occurred_at, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${CHECK_IN_COLUMNS}`,
      [
        data.id,
        data.personId,
        data.entryId,
        data.occurredAt,
        data.method,
        data.status,
        data.confirmedByKind,
        data.confirmedById,
        data.notes,
        data.idempotencyKey,
        data.clientOccurredAt,
        data.syncedAt,
      ],
    );

    if (row) return this.map(row);

    // تعارض: عملية سابقة بنفس المفتاح — نُعيدها بدل إنشاء سجل مكرر
    const existing = await this.findByIdempotencyKey(data.confirmedById, data.idempotencyKey);
    if (existing) return existing;
    throw new Error('Failed to create check-in');
  }

  async listForPerson(
    personId: string,
    options?: { limit?: number; from?: Date; to?: Date },
  ): Promise<CheckInRecord[]> {
    const params: unknown[] = [personId];
    const push = (v: unknown) => {
      params.push(v);
      return params.length;
    };
    let sql = `SELECT ${CHECK_IN_COLUMNS} FROM check_ins WHERE person_id = $1`;
    if (options?.from) sql += ` AND occurred_at >= $${push(options.from)}`;
    if (options?.to) sql += ` AND occurred_at < $${push(options.to)}`;
    sql += ` ORDER BY occurred_at DESC LIMIT $${push(options?.limit ?? 100)}`;
    const rows = await this.query<CheckInRow>(sql, params);
    return rows.map((r) => this.map(r));
  }

  async listForEntries(entryIds: string[]): Promise<CheckInRecord[]> {
    if (entryIds.length === 0) return [];
    const rows = await this.query<CheckInRow>(
      `SELECT ${CHECK_IN_COLUMNS} FROM check_ins WHERE entry_id = ANY($1) ORDER BY occurred_at ASC`,
      [entryIds],
    );
    return rows.map((r) => this.map(r));
  }

  async latestForPerson(personId: string): Promise<CheckInRecord | null> {
    const row = await this.one<CheckInRow>(
      `SELECT ${CHECK_IN_COLUMNS} FROM check_ins
       WHERE person_id = $1 AND status = 'reassured'
       ORDER BY occurred_at DESC LIMIT 1`,
      [personId],
    );
    return row ? this.map(row) : null;
  }

  async countForPersonBetween(personId: string, from: Date, to: Date): Promise<number> {
    return this.count(
      `SELECT count(*)::int FROM check_ins
       WHERE person_id = $1 AND status = 'reassured' AND occurred_at >= $2 AND occurred_at < $3`,
      [personId, from, to],
    );
  }

  async countSnoozesForEntry(entryId: string): Promise<number> {
    return this.count('SELECT COALESCE(snooze_count, 0)::int FROM schedule_entries WHERE id = $1', [entryId]);
  }
}

interface AttemptRow {
  id: string;
  person_id: string;
  entry_id: string | null;
  attempted_at: Date;
  kind: 'call' | 'message';
  outcome: AttemptOutcome;
  retry_after: Date | null;
  idempotency_key: string;
  created_by: string | null;
  created_at: Date;
}

const ATTEMPT_COLUMNS = `id, person_id, entry_id, attempted_at, kind, outcome, retry_after,
  idempotency_key, created_by, created_at`;

@Injectable()
export class SqlAttemptRepository extends SqlRepository implements AttemptRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: AttemptRow): CommunicationAttemptRecord {
    return {
      id: row.id,
      personId: row.person_id,
      entryId: asStringOrNull(row.entry_id),
      attemptedAt: asDate(row.attempted_at),
      kind: row.kind,
      outcome: row.outcome,
      retryAfter: asDateOrNull(row.retry_after),
      idempotencyKey: row.idempotency_key,
      createdBy: (asStringOrNull(row.created_by) as UserId | null) ?? null,
      createdAt: asDate(row.created_at),
    };
  }

  async create(data: Omit<CommunicationAttemptRecord, 'createdAt'>): Promise<CommunicationAttemptRecord> {
    const row = await this.one<AttemptRow>(
      `INSERT INTO communication_attempts (
         id, person_id, entry_id, attempted_at, kind, outcome, retry_after, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${ATTEMPT_COLUMNS}`,
      [
        data.id,
        data.personId,
        data.entryId,
        data.attemptedAt,
        data.kind,
        data.outcome,
        data.retryAfter,
        data.idempotencyKey,
        data.createdBy,
      ],
    );
    if (row) return this.map(row);
    const existing = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existing) return existing;
    throw new Error('Failed to record attempt');
  }

  async findByIdempotencyKey(key: string): Promise<CommunicationAttemptRecord | null> {
    const row = await this.one<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM communication_attempts WHERE idempotency_key = $1 LIMIT 1`,
      [key],
    );
    return row ? this.map(row) : null;
  }

  async listForPerson(
    personId: string,
    options?: { limit?: number; from?: Date; to?: Date },
  ): Promise<CommunicationAttemptRecord[]> {
    const params: unknown[] = [personId];
    const push = (v: unknown) => {
      params.push(v);
      return params.length;
    };
    let sql = `SELECT ${ATTEMPT_COLUMNS} FROM communication_attempts WHERE person_id = $1`;
    if (options?.from) sql += ` AND attempted_at >= $${push(options.from)}`;
    if (options?.to) sql += ` AND attempted_at < $${push(options.to)}`;
    sql += ` ORDER BY attempted_at DESC LIMIT $${push(options?.limit ?? 100)}`;
    const rows = await this.query<AttemptRow>(sql, params);
    return rows.map((r) => this.map(r));
  }

  async latestForPerson(personId: string): Promise<CommunicationAttemptRecord | null> {
    const row = await this.one<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM communication_attempts
       WHERE person_id = $1 ORDER BY attempted_at DESC LIMIT 1`,
      [personId],
    );
    return row ? this.map(row) : null;
  }

  async listPendingRetries(before: Date, limit: number): Promise<CommunicationAttemptRecord[]> {
    const rows = await this.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM communication_attempts
       WHERE retry_after IS NOT NULL AND retry_after <= $1 AND outcome <> 'answered'
       ORDER BY retry_after ASC LIMIT $2`,
      [before, limit],
    );
    return rows.map((r) => this.map(r));
  }
}

interface SyncRow {
  id: string;
  user_id: string;
  idempotency_key: string;
  op_type: string;
  payload: unknown;
  client_occurred_at: Date;
  status: SyncOperationRecord['status'];
  entity_id: string | null;
  error_code: string | null;
  message: string | null;
  result: unknown;
  applied_at: Date | null;
  created_at: Date;
}

@Injectable()
export class SqlSyncOperationRepository extends SqlRepository implements SyncOperationRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: SyncRow): SyncOperationRecord {
    return {
      id: row.id,
      userId: row.user_id as UserId,
      idempotencyKey: row.idempotency_key,
      opType: row.op_type,
      payloadJson: JSON.stringify(row.payload ?? {}),
      clientOccurredAt: asDate(row.client_occurred_at),
      status: row.status,
      entityId: asStringOrNull(row.entity_id),
      errorCode: asStringOrNull(row.error_code),
      messageAr: asStringOrNull(row.message),
      resultJson: row.result === null || row.result === undefined ? null : JSON.stringify(row.result),
      appliedAt: asDateOrNull(row.applied_at),
      createdAt: asDate(row.created_at),
    };
  }

  async findByIdempotencyKey(userId: UserId, key: string): Promise<SyncOperationRecord | null> {
    const row = await this.one<SyncRow>(
      `SELECT * FROM sync_operations WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [userId, key],
    );
    return row ? this.map(row) : null;
  }

  async create(data: Omit<SyncOperationRecord, 'createdAt'>): Promise<SyncOperationRecord> {
    const row = await this.one<SyncRow>(
      `INSERT INTO sync_operations (
         id, user_id, idempotency_key, op_type, payload, client_occurred_at, status,
         entity_id, error_code, message, result, applied_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        data.id,
        data.userId,
        data.idempotencyKey,
        data.opType,
        data.payloadJson,
        data.clientOccurredAt,
        data.status,
        data.entityId,
        data.errorCode,
        data.messageAr,
        data.resultJson,
        data.appliedAt,
      ],
    );
    if (row) return this.map(row);
    const existing = await this.findByIdempotencyKey(data.userId, data.idempotencyKey);
    if (existing) return existing;
    throw new Error('Failed to record sync operation');
  }

  async markApplied(id: string, entityId: string | null, resultJson: string | null, at: Date): Promise<void> {
    await this.query(
      `UPDATE sync_operations SET status = 'applied', entity_id = $2, result = $3::jsonb, applied_at = $4, error_code = NULL
       WHERE id = $1`,
      [id, entityId, resultJson, at],
    );
  }

  async markRejected(id: string, errorCode: string, messageAr: string, at: Date): Promise<void> {
    await this.query(
      `UPDATE sync_operations SET status = 'rejected', error_code = $2, message = $3, applied_at = $4
       WHERE id = $1`,
      [id, errorCode, messageAr, at],
    );
  }
}

