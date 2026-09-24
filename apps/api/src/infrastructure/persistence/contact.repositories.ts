import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { InviteStatus, Relationship, UserId } from '@wesal/shared';
import type {
  ContactInvitationRecord,
  TrustedContactRecord,
  WebCheckInLinkRecord,
} from '../../application/ports/records';
import type {
  ContactInvitationRepository,
  TrustedContactRepository,
  WebCheckInLinkRepository,
} from '../../application/ports/repositories';
import { SYMBOLS, type FieldEncryptionService } from '../../application/ports/services';
import { DATA_SOURCE } from './repository-tokens';
import { SqlRepository, asDate, asDateOrNull, asStringArray, asStringOrNull } from './sql-repository';

/**
 * الدعوات والجهات الموثوقة وروابط "أنا بخير".
 *
 * الخصوصية أولًا:
 *  - الرقم يُخزَّن مشفّرًا في `contact_invitations` فقط، ويُحذف (purge) عند الرفض/الإلغاء/الانتهاء.
 *  - لا يُنشأ سجل جهة موثوقة دائم إلا بعد قبول الدعوة.
 *  - رمز الدعوة يُخزَّن كبصمة؛ فلا يمكن لأحد لديه وصول للقاعدة أن يستخدمه.
 */

interface InvitationRow {
  id: string;
  person_id: string;
  invited_by_user_id: string;
  full_name: string;
  phone_encrypted: string | null;
  phone_hash: string;
  relationship: Relationship | null;
  token_hash: string;
  status: InviteStatus;
  scopes: string[];
  personal_note: string | null;
  invited_at: Date;
  expires_at: Date;
  responded_at: Date | null;
  created_at: Date;
}

const INVITATION_COLUMNS = `id, person_id, invited_by_user_id, full_name, phone_encrypted, phone_hash,
  relationship, token_hash, status, scopes, personal_note, invited_at, expires_at, responded_at, created_at`;

@Injectable()
export class SqlContactInvitationRepository extends SqlRepository implements ContactInvitationRepository {
  constructor(
    @Inject(DATA_SOURCE) dataSource: DataSource,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
  ) {
    super(dataSource);
  }

  private map(row: InvitationRow): ContactInvitationRecord {
    return {
      id: row.id,
      personId: row.person_id,
      invitedByUserId: row.invited_by_user_id as UserId,
      fullName: row.full_name,
      phoneEncrypted: row.phone_encrypted ?? '',
      phoneHash: row.phone_hash,
      relationship: row.relationship ?? null,
      tokenHash: row.token_hash,
      status: row.status,
      scopes: asStringArray(row.scopes),
      personalNote: asStringOrNull(row.personal_note),
      invitedAt: asDate(row.invited_at),
      expiresAt: asDate(row.expires_at),
      respondedAt: asDateOrNull(row.responded_at),
      createdAt: asDate(row.created_at),
    };
  }

  async create(data: Omit<ContactInvitationRecord, 'createdAt'>): Promise<ContactInvitationRecord> {
    const row = await this.one<InvitationRow>(
      `INSERT INTO contact_invitations (
         id, person_id, invited_by_user_id, full_name, phone_encrypted, phone_hash, relationship,
         token_hash, status, scopes, personal_note, invited_at, expires_at, responded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${INVITATION_COLUMNS}`,
      [
        data.id,
        data.personId,
        data.invitedByUserId,
        data.fullName.trim(),
        data.phoneEncrypted,
        data.phoneHash,
        data.relationship,
        data.tokenHash,
        data.status,
        data.scopes,
        data.personalNote,
        data.invitedAt,
        data.expiresAt,
        data.respondedAt,
      ],
    );
    if (!row) throw new Error('Failed to create invitation');
    return this.map(row);
  }

  async findById(id: string): Promise<ContactInvitationRecord | null> {
    const row = await this.one<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM contact_invitations WHERE id = $1`,
      [id],
    );
    return row ? this.map(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<ContactInvitationRecord | null> {
    const row = await this.one<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM contact_invitations WHERE token_hash = $1`,
      [tokenHash],
    );
    return row ? this.map(row) : null;
  }

  async listForPerson(personId: string): Promise<ContactInvitationRecord[]> {
    const rows = await this.query<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM contact_invitations
       WHERE person_id = $1 ORDER BY invited_at DESC`,
      [personId],
    );
    return rows.map((r) => this.map(r));
  }

  async listExpirable(now: Date, limit: number): Promise<ContactInvitationRecord[]> {
    const rows = await this.query<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM contact_invitations
       WHERE status = 'invited' AND expires_at <= $1 ORDER BY expires_at ASC LIMIT $2`,
      [now, limit],
    );
    return rows.map((r) => this.map(r));
  }

  async updateStatus(id: string, status: InviteStatus, respondedAt: Date): Promise<ContactInvitationRecord> {
    const responded = status === 'accepted' || status === 'declined';
    const row = await this.one<InvitationRow>(
      `UPDATE contact_invitations
       SET status = $2, responded_at = CASE WHEN $3 THEN $4 ELSE responded_at END
       WHERE id = $1 RETURNING ${INVITATION_COLUMNS}`,
      [id, status, responded, respondedAt],
    );
    if (!row) throw new Error('Invitation not found');
    return this.map(row);
  }

  /** حذف الرقم نهائيًا بعد انتهاء الحاجة إليه (أقل قدر من البيانات) */
  async purgePhone(id: string): Promise<void> {
    await this.query('UPDATE contact_invitations SET phone_encrypted = NULL WHERE id = $1', [id]);
  }

  async findActiveByPhoneHash(personId: string, phoneHash: string): Promise<ContactInvitationRecord | null> {
    const row = await this.one<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM contact_invitations
       WHERE person_id = $1 AND phone_hash = $2 AND status = 'invited' LIMIT 1`,
      [personId, phoneHash],
    );
    return row ? this.map(row) : null;
  }
}

interface TrustedRow {
  id: string;
  person_id: string;
  invitation_id: string | null;
  user_id: string | null;
  full_name: string;
  phone_encrypted: string;
  phone_hash: string;
  relationship: Relationship | null;
  scopes: string[];
  status: TrustedContactRecord['status'];
  accepted_at: Date;
  withdrawn_at: Date | null;
  created_at: Date;
}

const TRUSTED_COLUMNS = `id, person_id, invitation_id, user_id, full_name, phone_encrypted, phone_hash,
  relationship, scopes, status, accepted_at, withdrawn_at, created_at`;

@Injectable()
export class SqlTrustedContactRepository extends SqlRepository implements TrustedContactRepository {
  constructor(
    @Inject(DATA_SOURCE) dataSource: DataSource,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
  ) {
    super(dataSource);
  }

  private map(row: TrustedRow): TrustedContactRecord {
    return {
      id: row.id,
      personId: row.person_id,
      invitationId: asStringOrNull(row.invitation_id),
      userId: (asStringOrNull(row.user_id) as UserId | null) ?? null,
      fullName: row.full_name,
      phone: this.crypto.decrypt(row.phone_encrypted) ?? '',
      phoneHash: row.phone_hash,
      relationship: row.relationship ?? null,
      scopes: asStringArray(row.scopes),
      status: row.status,
      acceptedAt: asDate(row.accepted_at),
      withdrawnAt: asDateOrNull(row.withdrawn_at),
      createdAt: asDate(row.created_at),
    };
  }

  async create(data: Omit<TrustedContactRecord, 'createdAt'>): Promise<TrustedContactRecord> {
    const row = await this.one<TrustedRow>(
      `INSERT INTO trusted_contacts (
         id, person_id, invitation_id, user_id, full_name, phone_encrypted, phone_hash,
         relationship, scopes, status, accepted_at, withdrawn_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING
       RETURNING ${TRUSTED_COLUMNS}`,
      [
        data.id,
        data.personId,
        data.invitationId,
        data.userId,
        data.fullName.trim(),
        this.crypto.encrypt(data.phone),
        data.phoneHash,
        data.relationship,
        data.scopes,
        data.status,
        data.acceptedAt,
        data.withdrawnAt,
      ],
    );
    if (row) return this.map(row);
    const existing = await this.findByPersonAndPhoneHash(data.personId, data.phoneHash);
    if (existing) return existing;
    throw new Error('Failed to create trusted contact');
  }

  private async findByPersonAndPhoneHash(personId: string, phoneHash: string): Promise<TrustedContactRecord | null> {
    const row = await this.one<TrustedRow>(
      `SELECT ${TRUSTED_COLUMNS} FROM trusted_contacts
       WHERE person_id = $1 AND phone_hash = $2 AND status = 'accepted' LIMIT 1`,
      [personId, phoneHash],
    );
    return row ? this.map(row) : null;
  }

  async listForPerson(personId: string, options?: { acceptedOnly?: boolean }): Promise<TrustedContactRecord[]> {
    const acceptedOnly = options?.acceptedOnly ?? false;
    const rows = await this.query<TrustedRow>(
      `SELECT ${TRUSTED_COLUMNS} FROM trusted_contacts
       WHERE person_id = $1 ${acceptedOnly ? "AND status = 'accepted'" : ''}
       ORDER BY accepted_at ASC`,
      [personId],
    );
    return rows.map((r) => this.map(r));
  }

  async findById(id: string): Promise<TrustedContactRecord | null> {
    const row = await this.one<TrustedRow>(`SELECT ${TRUSTED_COLUMNS} FROM trusted_contacts WHERE id = $1`, [id]);
    return row ? this.map(row) : null;
  }

  async countAcceptedForPerson(personId: string): Promise<number> {
    return this.count(
      `SELECT count(*)::int FROM trusted_contacts WHERE person_id = $1 AND status = 'accepted'`,
      [personId],
    );
  }

  /** الانسحاب في أي وقت بضغطة واحدة — وحذف الرقم نهائيًا (أقل قدر من البيانات) */
  async withdraw(id: string, at: Date): Promise<void> {
    // الفهرس الفريد يشمل المقبولين فقط، فلا حاجة لتغيير البصمة
    await this.query(
      `UPDATE trusted_contacts
       SET status = 'withdrawn', withdrawn_at = $2, phone_encrypted = ''
       WHERE id = $1`,
      [id, at],
    );
  }

  async removeForInvitation(invitationId: string): Promise<void> {
    await this.query('DELETE FROM trusted_contacts WHERE invitation_id = $1', [invitationId]);
  }
}

interface WebLinkRow {
  id: string;
  person_id: string;
  entry_id: string | null;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_by: string | null;
  created_at: Date;
}

@Injectable()
export class SqlWebCheckInLinkRepository extends SqlRepository implements WebCheckInLinkRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: WebLinkRow): WebCheckInLinkRecord {
    return {
      id: row.id,
      personId: row.person_id,
      entryId: asStringOrNull(row.entry_id),
      tokenHash: row.token_hash,
      expiresAt: asDate(row.expires_at),
      usedAt: asDateOrNull(row.used_at),
      createdBy: (asStringOrNull(row.created_by) as UserId | null) ?? null,
      createdAt: asDate(row.created_at),
    };
  }

  private static readonly COLUMNS = 'id, person_id, entry_id, token_hash, expires_at, used_at, created_by, created_at';

  async create(data: Omit<WebCheckInLinkRecord, 'createdAt'>): Promise<WebCheckInLinkRecord> {
    const row = await this.one<WebLinkRow>(
      `INSERT INTO web_check_in_links (id, person_id, entry_id, token_hash, expires_at, used_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${SqlWebCheckInLinkRepository.COLUMNS}`,
      [data.id, data.personId, data.entryId, data.tokenHash, data.expiresAt, data.usedAt, data.createdBy],
    );
    if (!row) throw new Error('Failed to create web check-in link');
    return this.map(row);
  }

  async findByTokenHash(tokenHash: string): Promise<WebCheckInLinkRecord | null> {
    const row = await this.one<WebLinkRow>(
      `SELECT ${SqlWebCheckInLinkRepository.COLUMNS} FROM web_check_in_links WHERE token_hash = $1`,
      [tokenHash],
    );
    return row ? this.map(row) : null;
  }

  async markUsed(id: string, at: Date): Promise<void> {
    await this.query('UPDATE web_check_in_links SET used_at = $2 WHERE id = $1 AND used_at IS NULL', [id, at]);
  }

  async listActiveForPerson(personId: string, now: Date): Promise<WebCheckInLinkRecord[]> {
    const rows = await this.query<WebLinkRow>(
      `SELECT ${SqlWebCheckInLinkRepository.COLUMNS} FROM web_check_in_links
       WHERE person_id = $1 AND used_at IS NULL AND expires_at > $2 ORDER BY expires_at DESC`,
      [personId, now],
    );
    return rows.map((r) => this.map(r));
  }
}
