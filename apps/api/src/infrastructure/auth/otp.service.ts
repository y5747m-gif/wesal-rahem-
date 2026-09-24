import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale } from '@wesal/shared';
import { CONFIG, type AppConfig } from '../../config/configuration';
import {
  SYMBOLS,
  type FieldEncryptionService,
  type IdGenerator,
  type OtpService,
  type OtpVerifyResult,
} from '../../application/ports/services';
import type { OtpRepository } from '../../application/ports/repositories';
import { REPOSITORIES } from '../persistence/repository-tokens';
import { Clock } from '../../domain/shared/clock';
import { RateLimitedError } from '../../domain/shared/errors';
import { assertValidPhone, maskForLog } from '../../domain/shared/phone';

/**
 * خدمة رموز التحقق (OTP) — تسجيل الدخول برقم الهاتف.
 *
 * الأمان:
 *  - الرمز لا يُخزَّن أبدًا: فقط بصمة HMAC بمفتاح مشتق.
 *  - مقارنة آمنة ضد هجمات التوقيت.
 *  - حد للمحاولات (5 افتراضيًا) وفترة انتظار بين الطلبات (60 ثانية) وحد ساعي.
 *  - الرمز السابق يُبطل عند طلب رمز جديد (رمز واحد فعّال لكل رقم).
 *  - في وضع التطوير فقط يُعاد الرمز في الاستجابة ويُكتب في السجل.
 */
@Injectable()
export class DatabaseOtpService implements OtpService {
  private readonly logger = new Logger(DatabaseOtpService.name);
  private static readonly MAX_REQUESTS_PER_HOUR = 5;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(REPOSITORIES.otp) private readonly otps: OtpRepository,
    @Inject(SYMBOLS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
  ) {}

  private phoneHash(phone: string): string {
    return this.crypto.hmac(phone);
  }

  /** بصمة الرمز: HMAC بمفتاح مشتق من FIELD_ENCRYPTION_KEY (لا يُخزَّن الرمز أبدًا) */
  private codeHash(phoneHash: string, code: string): string {
    return this.crypto.hmac(`otp:${phoneHash}:${code.trim()}`);
  }

  async issue(input: {
    phone: string;
    purpose: 'login';
    ip?: string | null;
    userAgent?: string | null;
    locale: Locale;
  }): Promise<{ expiresAt: Date; resendAfterSeconds: number; devCode?: string }> {
    const phone = assertValidPhone(input.phone);
    const hash = this.phoneHash(phone);
    const now = this.clock.now();

    const cooldownSince = new Date(now.getTime() - this.config.otp.resendCooldownSeconds * 1000);
    const inCooldown = await this.otps.countRecentRequests(hash, cooldownSince);
    if (inCooldown > 0) {
      throw new RateLimitedError(`Please wait ${this.config.otp.resendCooldownSeconds}s before requesting a new code`);
    }

    const hourSince = new Date(now.getTime() - 60 * 60 * 1000);
    const inLastHour = await this.otps.countRecentRequests(hash, hourSince);
    if (inLastHour >= DatabaseOtpService.MAX_REQUESTS_PER_HOUR) {
      throw new RateLimitedError('Too many codes requested for this number. Please try again later.');
    }

    const code =
      this.config.otp.devMode && this.config.otp.fixedDevCode
        ? this.config.otp.fixedDevCode
        : this.ids.numericCode(this.config.otp.length);

    const id = this.ids.uuid();
    await this.otps.revokePrevious(hash, id);

    const expiresAt = new Date(now.getTime() + this.config.otp.ttlMinutes * 60_000);
    await this.otps.create({
      id,
      phoneHash: hash,
      codeHash: this.codeHash(hash, code),
      purpose: input.purpose,
      expiresAt,
      consumedAt: null,
      attempts: 0,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });

    this.logger.log(`OTP issued for ${maskForLog(phone)} (expires in ${this.config.otp.ttlMinutes}m)`);

    if (this.config.otp.devMode) {
      // ⚠️ وضع التطوير فقط — ممنوع في الإنتاج (يُتحقَّق منه في configuration.ts)
      this.logger.warn(`🔐 [DEV] verification code for ${maskForLog(phone)}: ${code}`);
      return { expiresAt, resendAfterSeconds: this.config.otp.resendCooldownSeconds, devCode: code };
    }

    if (this.config.notifications.smsDriver === 'log') {
      this.logger.warn(
        'OTP was created but no SMS provider is configured (SMS_DRIVER=log). ' +
          'Configure a provider before serving real users.',
      );
    }

    return { expiresAt, resendAfterSeconds: this.config.otp.resendCooldownSeconds };
  }

  async verify(input: { phone: string; code: string }): Promise<OtpVerifyResult> {
    const phone = assertValidPhone(input.phone);
    const hash = this.phoneHash(phone);
    const now = this.clock.now();

    const record = await this.otps.findLatestActive(hash, now);
    if (!record) return { ok: false, reason: 'expired' };

    if (record.attempts >= this.config.otp.maxAttempts) {
      await this.otps.markConsumed(record.id, now);
      return { ok: false, reason: 'too_many_attempts' };
    }

    const expected = this.codeHash(hash, input.code.trim());
    const provided = record.codeHash;
    if (expected.length !== provided.length || !safeEqualHex(expected, provided)) {
      await this.otps.incrementAttempts(record.id);
      this.logger.warn(`Invalid OTP attempt for ${maskForLog(phone)} (attempt ${record.attempts + 1})`);
      return { ok: false, reason: 'invalid' };
    }

    if (record.expiresAt.getTime() < now.getTime()) {
      return { ok: false, reason: 'expired' };
    }

    await this.otps.markConsumed(record.id, now);
    return { ok: true };
  }
}

/** مقارنة آمنة ضد هجمات التوقيت */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
