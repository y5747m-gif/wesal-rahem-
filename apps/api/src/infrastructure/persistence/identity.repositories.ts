import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { Locale, UserId } from '@wesal/shared';
import type {
  ConsentRecord,
  DeviceRecord,
  OtpRecord,
  PrivacySettingsRecord,
  SessionRecord,
  UserRecord,
} from '../../application/ports/records';
import type {
  ConsentRepository,
  DeviceRepository,
  OtpRepository,
  PrivacySettingsRepository,
  SessionRepository,
  UserRepository,
} from '../../application/ports/repositories';
import { SYMBOLS, type FieldEncryptionService } from '../../application/ports/services';
import { DATA_SOURCE } from './repository-tokens';
import {
  SqlRepository,
  asBoolean,
  asDate,
  asDateOrNull,
  asStringOrNull,
  fontScaleFromDb,
  fontScaleToDb,
} from './sql-repository';

/**
 * مستودعات الهوية: المستخدمون، الرموز، الجلسات، الأجهزة، إعدادات الخصوصية، الموافقات.
 *
 * الخصوصية: رقم الهاتف يُخزَّن مشفّرًا + بصمة للبحث. فكّ التشفير يحدث هنا فقط،
 * وطبقة العرض مسؤولة عن عدم إخراج الرقم كاملًا إلا لصاحبه.
 */

interface UserRow {
  id: string;
  phone_hash: string;
  phone_encrypted: string;
  phone_verified_at: Date | null;
  display_name: string | null;
  email: string | null;
  locale: string;
  timezone: string;
  theme: string;
  font_scale: string;
  reduced_motion: boolean;
  senior_mode: boolean;
  haptics_enabled: boolean;
  onboarding_completed: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

@Injectable()
export class SqlUserRepository extends SqlRepository implements UserRepository {
  constructor(
    @Inject(DATA_SOURCE) dataSource: DataSource,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
  ) {
    super(dataSource);
  }

  private map(row: UserRow): UserRecord {
    return {
      id: row.id as UserId,
      phone: this.crypto.decrypt(row.phone_encrypted) ?? '',
      phoneHash: row.phone_hash,
      phoneVerifiedAt: asDateOrNull(row.phone_verified_at),
      displayName: asStringOrNull(row.display_name),
      email: asStringOrNull(row.email),
      locale: (row.locale === 'en' ? 'en' : 'ar') as Locale,
      timezone: row.timezone,
      theme: row.theme as UserRecord['theme'],
      fontScale: fontScaleFromDb(row.font_scale),
      reducedMotion: asBoolean(row.reduced_motion),
      seniorMode: asBoolean(row.senior_mode),
      hapticsEnabled: asBoolean(row.haptics_enabled),
      onboardingCompleted: asBoolean(row.onboarding_completed),
      createdAt: asDate(row.created_at),
      updatedAt: asDate(row.updated_at),
      deletedAt: asDateOrNull(row.deleted_at),
    };
  }

  private static readonly COLUMNS = `
    id, phone_hash, phone_encrypted, phone_verified_at, display_name, email, locale, timezone,
    theme, font_scale, reduced_motion, senior_mode, haptics_enabled, onboarding_completed,
    created_at, updated_at, deleted_at`;

  async findById(id: UserId): Promise<UserRecord | null> {
    const row = await this.one<UserRow>(
      `SELECT ${SqlUserRepository.COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return row ? this.map(row) : null;
  }

  async findByPhoneHash(phoneHash: string): Promise<UserRecord | null> {
    const row = await this.one<UserRow>(
      `SELECT ${SqlUserRepository.COLUMNS} FROM users WHERE phone_hash = $1 AND deleted_at IS NULL`,
      [phoneHash],
    );
    return row ? this.map(row) : null;
  }

  async create(data: Omit<UserRecord, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<UserRecord> {
    const row = await this.one<UserRow>(
      `INSERT INTO users (
         id, phone_hash, phone_encrypted, phone_verified_at, display_name, email, locale, timezone,
         theme, font_scale, reduced_motion, senior_mode, haptics_enabled, onboarding_completed
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${SqlUserRepository.COLUMNS}`,
      [
        data.id,
        data.phoneHash,
        this.crypto.encrypt(data.phone),
        data.phoneVerifiedAt,
        data.displayName,
        data.email ? data.email.toLowerCase() : null,
        data.locale,
        data.timezone,
        data.theme,
        fontScaleToDb(data.fontScale),
        data.reducedMotion,
        data.seniorMode,
        data.hapticsEnabled,
        data.onboardingCompleted,
      ],
    );
    if (!row) throw new Error('Failed to create user');
    return this.map(row);
  }

  async update(id: UserId, patch: Partial<UserRecord>): Promise<UserRecord> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (patch.displayName !== undefined) push('display_name', patch.displayName);
    if (patch.email !== undefined) push('email', patch.email ? patch.email.toLowerCase() : null);
    if (patch.locale !== undefined) push('locale', patch.locale);
    if (patch.timezone !== undefined) push('timezone', patch.timezone);
    if (patch.theme !== undefined) push('theme', patch.theme);
    if (patch.fontScale !== undefined) push('font_scale', fontScaleToDb(patch.fontScale));
    if (patch.reducedMotion !== undefined) push('reduced_motion', patch.reducedMotion);
    if (patch.seniorMode !== undefined) push('senior_mode', patch.seniorMode);
    if (patch.hapticsEnabled !== undefined) push('haptics_enabled', patch.hapticsEnabled);
    if (patch.onboardingCompleted !== undefined) push('onboarding_completed', patch.onboardingCompleted);
    if (patch.phoneVerifiedAt !== undefined) push('phone_verified_at', patch.phoneVerifiedAt);
    if (patch.phone !== undefined) {
      push('phone_encrypted', this.crypto.encrypt(patch.phone));
      if (patch.phoneHash) push('phone_hash', patch.phoneHash);
    }

    if (sets.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error('User not found');
      return existing;
    }

    params.push(id);
    const row = await this.one<UserRow>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING ${SqlUserRepository.COLUMNS}`,
      params,
    );
    if (!row) throw new Error('User not found');
    return this.map(row);
  }

  async softDelete(id: UserId): Promise<void> {
    await this.query('UPDATE users SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
  }
}

interface OtpRow {
  id: string;
  phone_hash: string;
  code_hash: string;
  purpose: 'login';
  expires_at: Date;
  consumed_at: Date | null;
  attempts: number;
  created_at: Date;
  ip: string | null;
  user_agent: string | null;
}

@Injectable()
export class SqlOtpRepository extends SqlRepository implements OtpRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: OtpRow): OtpRecord {
    return {
      id: row.id,
      phoneHash: row.phone_hash,
      codeHash: row.code_hash,
      purpose: row.purpose,
      expiresAt: asDate(row.expires_at),
      consumedAt: asDateOrNull(row.consumed_at),
      attempts: Number(row.attempts),
      createdAt: asDate(row.created_at),
      ip: asStringOrNull(row.ip),
      userAgent: asStringOrNull(row.user_agent),
    };
  }

  async create(data: Omit<OtpRecord, 'createdAt'>): Promise<OtpRecord> {
    const row = await this.one<OtpRow>(
      `INSERT INTO auth_otps (id, phone_hash, code_hash, purpose, expires_at, consumed_at, attempts, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, phone_hash, code_hash, purpose, expires_at, consumed_at, attempts, created_at, ip, user_agent`,
      [
        data.id,
        data.phoneHash,
        data.codeHash,
        data.purpose,
        data.expiresAt,
        data.consumedAt,
        data.attempts,
        data.ip,
        data.userAgent,
      ],
    );
    if (!row) throw new Error('Failed to create otp');
    return this.map(row);
  }

  async findLatestActive(phoneHash: string, now: Date): Promise<OtpRecord | null> {
    const row = await this.one<OtpRow>(
      `SELECT id, phone_hash, code_hash, purpose, expires_at, consumed_at, attempts, created_at, ip, user_agent
       FROM auth_otps
       WHERE phone_hash = $1 AND consumed_at IS NULL AND expires_at > $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [phoneHash, now],
    );
    return row ? this.map(row) : null;
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.query('UPDATE auth_otps SET attempts = attempts + 1 WHERE id = $1', [id]);
  }

  async markConsumed(id: string, at: Date): Promise<void> {
    await this.query('UPDATE auth_otps SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL', [id, at]);
  }

  async countRecentRequests(phoneHash: string, since: Date): Promise<number> {
    return this.count('SELECT count(*)::int FROM auth_otps WHERE phone_hash = $1 AND created_at >= $2', [
      phoneHash,
      since,
    ]);
  }

  /** إبطال الرموز السابقة حتى يبقى رمز واحد فعّال لكل رقم */
  async revokePrevious(phoneHash: string, beforeId: string): Promise<void> {
    await this.query(
      `UPDATE auth_otps SET consumed_at = now()
       WHERE phone_hash = $1 AND id <> $2 AND consumed_at IS NULL`,
      [phoneHash, beforeId],
    );
  }
}

interface SessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  device_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

@Injectable()
export class SqlSessionRepository extends SqlRepository implements SessionRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      userId: row.user_id as UserId,
      refreshTokenHash: row.refresh_token_hash,
      deviceId: asStringOrNull(row.device_id),
      expiresAt: asDate(row.expires_at),
      revokedAt: asDateOrNull(row.revoked_at),
      createdAt: asDate(row.created_at),
    };
  }

  private static readonly COLUMNS = 'id, user_id, refresh_token_hash, device_id, expires_at, revoked_at, created_at';

  async create(data: Omit<SessionRecord, 'createdAt'>): Promise<SessionRecord> {
    const row = await this.one<SessionRow>(
      `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, device_id, expires_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${SqlSessionRepository.COLUMNS}`,
      [data.id, data.userId, data.refreshTokenHash, data.deviceId, data.expiresAt, data.revokedAt],
    );
    if (!row) throw new Error('Failed to create session');
    return this.map(row);
  }

  async findByRefreshTokenHash(hash: string): Promise<SessionRecord | null> {
    const row = await this.one<SessionRow>(
      `SELECT ${SqlSessionRepository.COLUMNS} FROM auth_sessions WHERE refresh_token_hash = $1`,
      [hash],
    );
    return row ? this.map(row) : null;
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const row = await this.one<SessionRow>(`SELECT ${SqlSessionRepository.COLUMNS} FROM auth_sessions WHERE id = $1`, [id]);
    return row ? this.map(row) : null;
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.query('UPDATE auth_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, at]);
  }

  async revokeAllForUser(userId: UserId, at: Date): Promise<void> {
    await this.query('UPDATE auth_sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [
      userId,
      at,
    ]);
  }
}

interface DeviceRow {
  id: string;
  user_id: string;
  platform: DeviceRecord['platform'];
  push_token_hash: string | null;
  push_token_encrypted: string | null;
  locale: string;
  timezone: string;
  app_version: string | null;
  last_seen_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

@Injectable()
export class SqlDeviceRepository extends SqlRepository implements DeviceRepository {
  constructor(
    @Inject(DATA_SOURCE) dataSource: DataSource,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
  ) {
    super(dataSource);
  }

  private map(row: DeviceRow): DeviceRecord {
    return {
      id: row.id,
      userId: row.user_id as UserId,
      platform: row.platform,
      pushToken: row.push_token_encrypted ? this.crypto.decrypt(row.push_token_encrypted) : null,
      pushTokenHash: asStringOrNull(row.push_token_hash),
      locale: (row.locale === 'en' ? 'en' : 'ar') as Locale,
      timezone: row.timezone,
      appVersion: asStringOrNull(row.app_version),
      lastSeenAt: asDate(row.last_seen_at),
      revokedAt: asDateOrNull(row.revoked_at),
      createdAt: asDate(row.created_at),
    };
  }

  private static readonly COLUMNS = `id, user_id, platform, push_token_hash, push_token_encrypted,
    locale, timezone, app_version, last_seen_at, revoked_at, created_at`;

  async upsertByToken(data: {
    userId: UserId;
    platform: DeviceRecord['platform'];
    pushToken: string | null;
    pushTokenHash: string | null;
    locale: Locale;
    timezone: string;
    appVersion: string | null;
    lastSeenAt: Date;
  }): Promise<DeviceRecord> {
    const encrypted = data.pushToken ? this.crypto.encrypt(data.pushToken) : null;

    // جهاز بلا رمز دفع (مثل ويب): نحدّث آخر ظهور ولا ننشئ صفوفًا مكررة
    if (!data.pushTokenHash) {
      const existing = await this.one<DeviceRow>(
        `SELECT ${SqlDeviceRepository.COLUMNS} FROM devices
         WHERE user_id = $1 AND platform = $2 AND push_token_hash IS NULL AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [data.userId, data.platform],
      );
      if (existing) {
        const updated = await this.one<DeviceRow>(
          `UPDATE devices SET last_seen_at = $2, locale = $3, timezone = $4, app_version = $5
           WHERE id = $1 RETURNING ${SqlDeviceRepository.COLUMNS}`,
          [existing.id, data.lastSeenAt, data.locale, data.timezone, data.appVersion],
        );
        return this.map(updated ?? existing);
      }
    }

    const row = await this.one<DeviceRow>(
      `INSERT INTO devices (user_id, platform, push_token_hash, push_token_encrypted, locale, timezone, app_version, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (push_token_hash)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         locale = EXCLUDED.locale,
         timezone = EXCLUDED.timezone,
         app_version = EXCLUDED.app_version,
         last_seen_at = EXCLUDED.last_seen_at,
         revoked_at = NULL
       RETURNING ${SqlDeviceRepository.COLUMNS}`,
      [
        data.userId,
        data.platform,
        data.pushTokenHash,
        encrypted,
        data.locale,
        data.timezone,
        data.appVersion,
        data.lastSeenAt,
      ],
    );

    if (row) return this.map(row);

    const created = await this.one<DeviceRow>(
      `INSERT INTO devices (user_id, platform, push_token_hash, push_token_encrypted, locale, timezone, app_version, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SqlDeviceRepository.COLUMNS}`,
      [
        data.userId,
        data.platform,
        data.pushTokenHash,
        encrypted,
        data.locale,
        data.timezone,
        data.appVersion,
        data.lastSeenAt,
      ],
    );
    if (!created) throw new Error('Failed to register device');
    return this.map(created);
  }

  async findById(id: string): Promise<DeviceRecord | null> {
    const row = await this.one<DeviceRow>(
      `SELECT ${SqlDeviceRepository.COLUMNS} FROM devices WHERE id = $1`,
      [id],
    );
    return row ? this.map(row) : null;
  }

  async findActiveByUser(userId: UserId): Promise<DeviceRecord[]> {
    const rows = await this.query<DeviceRow>(
      `SELECT ${SqlDeviceRepository.COLUMNS} FROM devices WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    return rows.map((r) => this.map(r));
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.query('UPDATE devices SET last_seen_at = $2 WHERE id = $1', [id, at]);
  }
}

interface PrivacyRow {
  user_id: string;
  share_check_in_with_family: boolean;
  allow_trusted_contact_alerts: boolean;
  ai_enabled: boolean;
  location_sharing_enabled: boolean;
  data_retention_days: number;
  updated_at: Date;
}

@Injectable()
export class SqlPrivacySettingsRepository extends SqlRepository implements PrivacySettingsRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: PrivacyRow): PrivacySettingsRecord {
    return {
      userId: row.user_id as UserId,
      shareCheckInWithFamily: asBoolean(row.share_check_in_with_family),
      allowTrustedContactAlerts: asBoolean(row.allow_trusted_contact_alerts),
      aiEnabled: asBoolean(row.ai_enabled),
      locationSharingEnabled: asBoolean(row.location_sharing_enabled),
      dataRetentionDays: Number(row.data_retention_days),
      updatedAt: asDate(row.updated_at),
    };
  }

  async findByUser(userId: UserId): Promise<PrivacySettingsRecord | null> {
    const row = await this.one<PrivacyRow>('SELECT * FROM privacy_settings WHERE user_id = $1', [userId]);
    return row ? this.map(row) : null;
  }

  async upsert(data: Omit<PrivacySettingsRecord, 'updatedAt'>): Promise<PrivacySettingsRecord> {
    const row = await this.one<PrivacyRow>(
      `INSERT INTO privacy_settings (
         user_id, share_check_in_with_family, allow_trusted_contact_alerts, ai_enabled,
         location_sharing_enabled, data_retention_days)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET
         share_check_in_with_family = EXCLUDED.share_check_in_with_family,
         allow_trusted_contact_alerts = EXCLUDED.allow_trusted_contact_alerts,
         ai_enabled = EXCLUDED.ai_enabled,
         location_sharing_enabled = EXCLUDED.location_sharing_enabled,
         data_retention_days = EXCLUDED.data_retention_days
       RETURNING *`,
      [
        data.userId,
        data.shareCheckInWithFamily,
        data.allowTrustedContactAlerts,
        data.aiEnabled,
        data.locationSharingEnabled,
        data.dataRetentionDays,
      ],
    );
    if (!row) throw new Error('Failed to upsert privacy settings');
    return this.map(row);
  }
}

interface ConsentRow {
  id: string;
  subject_type: ConsentRecord['subjectType'];
  subject_id: string;
  scope: ConsentRecord['scope'];
  granted: boolean;
  version: string;
  granted_at: Date | null;
  revoked_at: Date | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}

@Injectable()
export class SqlConsentRepository extends SqlRepository implements ConsentRepository {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource);
  }

  private map(row: ConsentRow): ConsentRecord {
    return {
      id: row.id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      scope: row.scope,
      granted: asBoolean(row.granted),
      version: row.version,
      grantedAt: asDateOrNull(row.granted_at),
      revokedAt: asDateOrNull(row.revoked_at),
      ip: asStringOrNull(row.ip),
      userAgent: asStringOrNull(row.user_agent),
      createdAt: asDate(row.created_at),
    };
  }

  private static readonly COLUMNS =
    'id, subject_type, subject_id, scope, granted, version, granted_at, revoked_at, ip, user_agent, created_at';

  async create(data: Omit<ConsentRecord, 'createdAt'>): Promise<ConsentRecord> {
    const row = await this.one<ConsentRow>(
      `INSERT INTO consents (id, subject_type, subject_id, scope, granted, version, granted_at, revoked_at, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${SqlConsentRepository.COLUMNS}`,
      [
        data.id,
        data.subjectType,
        data.subjectId,
        data.scope,
        data.granted,
        data.version,
        data.grantedAt,
        data.revokedAt,
        data.ip,
        data.userAgent,
      ],
    );
    if (!row) throw new Error('Failed to record consent');
    return this.map(row);
  }

  async findActive(
    subjectType: ConsentRecord['subjectType'],
    subjectId: string,
    scope: ConsentRecord['scope'],
  ): Promise<ConsentRecord | null> {
    const row = await this.one<ConsentRow>(
      `SELECT ${SqlConsentRepository.COLUMNS} FROM consents
       WHERE subject_type = $1 AND subject_id = $2 AND scope = $3 AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [subjectType, subjectId, scope],
    );
    return row ? this.map(row) : null;
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.query('UPDATE consents SET revoked_at = $2, granted = false WHERE id = $1 AND revoked_at IS NULL', [
      id,
      at,
    ]);
  }

  async listForSubject(subjectType: ConsentRecord['subjectType'], subjectId: string): Promise<ConsentRecord[]> {
    const rows = await this.query<ConsentRow>(
      `SELECT ${SqlConsentRepository.COLUMNS} FROM consents
       WHERE subject_type = $1 AND subject_id = $2 ORDER BY created_at DESC`,
      [subjectType, subjectId],
    );
    return rows.map((r) => this.map(r));
  }
}
