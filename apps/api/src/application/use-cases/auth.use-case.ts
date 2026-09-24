import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale, UserId, VerifyOtpResponse, UserProfile } from '@wesal/shared';
import { LIMITS } from '@wesal/shared';
import type { DeviceRecord, SessionRecord, UserRecord } from '../ports/records';
import type { DeviceRepository, SessionRepository, UserRepository } from '../ports/repositories';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import { OTP_SERVICE } from '../../infrastructure/core.module';
import {
  SYMBOLS,
  type AuditLogger,
  type FieldEncryptionService,
  type IdGenerator,
  type OtpService,
  type TokenService,
} from '../ports/services';
import { Clock } from '../../domain/shared/clock';
import { DEFAULT_TIMEZONE, assertValidTimezone } from '../../domain/shared/time';
import { assertValidPhone, maskForLog } from '../../domain/shared/phone';
import {
  DomainError,
  ExpiredOtpError,
  InvalidOtpError,
  NotFoundError,
  RateLimitedError,
  TooManyOtpAttemptsError,
  ValidationError,
} from '../../domain/shared/errors';
import { ErrorCode } from '@wesal/shared';
import { DtoMapper } from '../services/dto.mapper';

/**
 * حالات الاستخدام الخاصة بالمصادقة والحساب:
 *  - تسجيل الدخول برقم الهاتف + OTP
 *  - جلسات Token-based مع تدوير رمز التجديد (Rotation)
 *  - تسجيل الأجهزة لاستقبال الإشعارات
 *  - ملف المستخدم وتفضيلات الوصول (الخط، الحركة، اللغة، الوضع الداكن)
 */
export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthUseCase {
  private readonly logger = new Logger('AuthUseCase');

  constructor(
    @Inject(REPOSITORIES.users) private readonly users: UserRepository,
    @Inject(REPOSITORIES.sessions) private readonly sessions: SessionRepository,
    @Inject(REPOSITORIES.devices) private readonly devices: DeviceRepository,
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    @Inject(SYMBOLS.TokenService) private readonly tokens: TokenService,
    @Inject(SYMBOLS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
    @Inject(SYMBOLS.AuditLogger) private readonly audit: AuditLogger,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
    private readonly mapper: DtoMapper,
  ) {}

  async requestOtp(input: {
    phone: string;
    locale?: Locale;
    context?: RequestContext;
  }): Promise<{ expiresInMinutes: number; resendAfterSeconds: number; devCode?: string }> {
    const phone = assertValidPhone(input.phone);
    const result = await this.otp.issue({
      phone,
      purpose: 'login',
      ip: input.context?.ip ?? null,
      userAgent: input.context?.userAgent ?? null,
      locale: input.locale ?? 'ar',
    });

    await this.audit.log({
      actorKind: 'user',
      action: 'auth.otp_requested',
      entityType: 'phone',
      entityId: this.crypto.hmac(phone),
      ip: input.context?.ip ?? null,
      userAgent: input.context?.userAgent ?? null,
    });

    return {
      expiresInMinutes: LIMITS.otpTtlMinutes,
      resendAfterSeconds: result.resendAfterSeconds,
      ...(result.devCode ? { devCode: result.devCode } : {}),
    };
  }

  async verifyOtp(input: {
    phone: string;
    code: string;
    locale?: Locale;
    timezone?: string;
    displayName?: string;
    device?: { platform: DeviceRecord['platform']; pushToken?: string; appVersion?: string; timezone?: string };
    context?: RequestContext;
  }): Promise<VerifyOtpResponse> {
    const phone = assertValidPhone(input.phone);
    if (!input.code || !/^\d{4,8}$/.test(input.code.trim())) {
      throw new ValidationError('Enter the code we sent you', { field: 'code' });
    }

    const verification = await this.otp.verify({ phone, code: input.code.trim() });
    if (!verification.ok) {
      await this.audit.log({
        actorKind: 'user',
        action: `auth.otp_failed.${verification.reason}`,
        entityType: 'phone',
        entityId: this.crypto.hmac(phone),
        ip: input.context?.ip ?? null,
      });
      if (verification.reason === 'expired') throw new ExpiredOtpError();
      if (verification.reason === 'too_many_attempts') throw new TooManyOtpAttemptsError();
      if (verification.reason === 'rate_limited') throw new RateLimitedError();
      throw new InvalidOtpError();
    }

    const now = this.clock.now();
    const phoneHash = this.crypto.hmac(phone);
    const timezone = input.timezone ? assertValidTimezone(input.timezone) : DEFAULT_TIMEZONE;
    const locale: Locale = input.locale === 'en' ? 'en' : 'ar';

    let user = await this.users.findByPhoneHash(phoneHash);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await this.users.create({
        id: this.ids.uuid(),
        phone,
        phoneHash,
        phoneVerifiedAt: now,
        displayName: sanitizeDisplayName(input.displayName),
        email: null,
        locale,
        timezone,
        theme: 'system',
        fontScale: 'default',
        reducedMotion: false,
        seniorMode: false,
        hapticsEnabled: true,
        onboardingCompleted: false,
      });
      await this.audit.log({
        actorUserId: user.id,
        action: 'user.registered',
        entityType: 'user',
        entityId: user.id,
        ip: input.context?.ip ?? null,
        userAgent: input.context?.userAgent ?? null,
      });
      this.logger.log(`New user registered (${maskForLog(phone)})`);
    } else {
      user = await this.users.update(user.id, { phoneVerifiedAt: now });
      await this.audit.log({
        actorUserId: user.id,
        action: 'user.logged_in',
        entityType: 'user',
        entityId: user.id,
        ip: input.context?.ip ?? null,
        userAgent: input.context?.userAgent ?? null,
      });
    }

    const device = input.device ? await this.registerDeviceInternal(user, input.device, now) : null;
    const sessionTokens = await this.createSession(user, device?.id ?? null, locale);

    return {
      ...sessionTokens,
      user: this.mapper.toUserProfile(user),
      isNewUser,
    };
  }

  async refresh(input: { refreshToken: string }): Promise<{ tokens: { accessToken: string; refreshToken: string; accessExpiresIn: number }; user: UserProfile }> {
    if (!input.refreshToken) throw new DomainError(ErrorCode.Unauthorized, 'Refresh token is required', 401);

    const hash = this.tokens.hashRefreshToken(input.refreshToken);
    const session = await this.sessions.findByRefreshTokenHash(hash);
    const now = this.clock.now();

    if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
      // إعادة استخدام رمز مُبطل = احتمال سرقة → نُبطِل كل جلسات المستخدم
      if (session && session.revokedAt) {
        await this.sessions.revokeAllForUser(session.userId, now);
        this.logger.warn(`Refresh token reuse detected for session ${session.id}; all sessions revoked`);
      }
      throw new DomainError(ErrorCode.Unauthorized, 'Session expired, please sign in again', 401);
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.deletedAt) throw new NotFoundError('Account');

    // تدوير رمز التجديد: نُبطِل القديم ونُصدر جديدًا
    await this.sessions.revoke(session.id, now);
    const tokens = await this.createSession(user, session.deviceId, user.locale);

    return {
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresIn: tokens.accessExpiresIn,
      },
      user: this.mapper.toUserProfile(user),
    };
  }

  async logout(input: { refreshToken: string }): Promise<{ revoked: boolean }> {
    const hash = this.tokens.hashRefreshToken(input.refreshToken);
    const session = await this.sessions.findByRefreshTokenHash(hash);
    if (!session) return { revoked: false };
    await this.sessions.revoke(session.id, this.clock.now());
    await this.audit.log({
      actorUserId: session.userId,
      action: 'auth.logged_out',
      entityType: 'session',
      entityId: session.id,
    });
    return { revoked: true };
  }

  async getProfile(userId: UserId): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) throw new NotFoundError('Account');
    return this.mapper.toUserProfile(user);
  }

  async updateProfile(
    userId: UserId,
    patch: {
      displayName?: string | null;
      email?: string | null;
      locale?: Locale;
      timezone?: string;
      theme?: 'light' | 'dark' | 'system';
      fontScale?: 'small' | 'default' | 'large' | 'extraLarge' | 'senior';
      reducedMotion?: boolean;
      seniorMode?: boolean;
      hapticsEnabled?: boolean;
      onboardingCompleted?: boolean;
    },
  ): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) throw new NotFoundError('Account');

    const update: Partial<UserRecord> = {};
    if (patch.displayName !== undefined) update.displayName = sanitizeDisplayName(patch.displayName);
    if (patch.email !== undefined) {
      const email = patch.email ? patch.email.trim().toLowerCase() : null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
        throw new ValidationError('Enter a valid email address', { field: 'email' });
      }
      update.email = email;
    }
    if (patch.locale !== undefined) update.locale = patch.locale === 'en' ? 'en' : 'ar';
    if (patch.timezone !== undefined) update.timezone = assertValidTimezone(patch.timezone);
    if (patch.theme !== undefined) update.theme = patch.theme;
    if (patch.fontScale !== undefined) update.fontScale = patch.fontScale;
    if (patch.reducedMotion !== undefined) update.reducedMotion = patch.reducedMotion;
    if (patch.seniorMode !== undefined) update.seniorMode = patch.seniorMode;
    if (patch.hapticsEnabled !== undefined) update.hapticsEnabled = patch.hapticsEnabled;
    if (patch.onboardingCompleted !== undefined) update.onboardingCompleted = patch.onboardingCompleted;

    const updated = await this.users.update(user.id, update);
    await this.audit.log({
      actorUserId: user.id,
      action: 'user.profile_updated',
      entityType: 'user',
      entityId: user.id,
      metadata: { fields: Object.keys(update) },
    });
    return this.mapper.toUserProfile(updated);
  }

  async registerDevice(
    userId: UserId,
    device: { platform: DeviceRecord['platform']; pushToken?: string; appVersion?: string; locale?: Locale; timezone?: string },
  ): Promise<{ deviceId: string; registered: boolean }> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) throw new NotFoundError('Account');
    const record = await this.registerDeviceInternal(user, device, this.clock.now());
    return { deviceId: record.id, registered: true };
  }

  /** حذف الحساب والبيانات — حق واضح للمستخدم (الامتثال) */
  async deleteAccount(userId: UserId): Promise<{ deleted: boolean }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Account');
    await this.sessions.revokeAllForUser(userId, this.clock.now());
    await this.users.softDelete(userId);
    await this.audit.log({
      actorUserId: userId,
      action: 'user.deleted',
      entityType: 'user',
      entityId: userId,
    });
    this.logger.log(`Account deletion requested for user ${userId} (soft delete; purge job removes data)`);
    return { deleted: true };
  }

  private async registerDeviceInternal(
    user: UserRecord,
    device: { platform: DeviceRecord['platform']; pushToken?: string; appVersion?: string; locale?: Locale; timezone?: string },
    now: Date,
  ): Promise<DeviceRecord> {
    return this.devices.upsertByToken({
      userId: user.id,
      platform: device.platform,
      pushToken: device.pushToken ?? null,
      pushTokenHash: device.pushToken ? this.crypto.hmac(device.pushToken) : null,
      locale: device.locale ?? user.locale,
      timezone: device.timezone ? assertValidTimezone(device.timezone) : user.timezone,
      appVersion: device.appVersion ?? null,
      lastSeenAt: now,
    });
  }

  private async createSession(
    user: UserRecord,
    deviceId: string | null,
    locale: Locale,
  ): Promise<{ accessToken: string; refreshToken: string; accessExpiresIn: number; session: SessionRecord }> {
    const now = this.clock.now();
    const refreshToken = this.tokens.generateRefreshToken();
    const sessionId = this.ids.uuid();

    const session = await this.sessions.create({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
      deviceId,
      expiresAt: this.tokens.refreshExpiresAt(now),
      revokedAt: null,
    });

    const access = this.tokens.signAccessToken({ userId: user.id, sessionId, locale });
    return {
      accessToken: access.token,
      refreshToken,
      accessExpiresIn: access.expiresIn,
      session,
    };
  }
}

function sanitizeDisplayName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 80) throw new ValidationError('Name is too long (max 80 characters)', { field: 'displayName' });
  return trimmed;
}
