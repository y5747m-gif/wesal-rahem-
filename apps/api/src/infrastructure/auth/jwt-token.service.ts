import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { Locale, UserId } from '@wesal/shared';
import { CONFIG, type AppConfig } from '../../config/configuration';
import type { AccessTokenClaims, TokenService } from '../../application/ports/services';
import { DomainError } from '../../domain/shared/errors';
import { ErrorCode } from '@wesal/shared';

/**
 * جلسات Token-based:
 *  - Access token (JWT) قصير العمر (15 دقيقة افتراضيًا) يحمل userId + sessionId + locale.
 *  - Refresh token عشوائي 48 بايت، يُخزَّن في القاعدة كبصمة SHA-256 فقط.
 *  - إبطال الجلسة = وضع revoked_at على الصف، ويُتحقَّق منه عند كل تجديد.
 */
@Injectable()
export class JwtTokenService implements TokenService {
  private readonly logger = new Logger(JwtTokenService.name);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  signAccessToken(claims: AccessTokenClaims): { token: string; expiresIn: number } {
    const expiresIn = this.config.jwt.accessTtlSeconds;
    const token = jwt.sign(
      {
        sub: claims.userId,
        sid: claims.sessionId,
        locale: claims.locale,
      },
      this.config.jwt.accessSecret,
      { algorithm: 'HS256', expiresIn },
    );
    return { token, expiresIn };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.config.jwt.accessSecret, {
        algorithms: ['HS256'],
      }) as { sub?: string; sid?: string; locale?: string };

      if (!payload.sub || !payload.sid) {
        throw new DomainError(ErrorCode.Unauthorized, 'Malformed access token', 401);
      }
      return {
        userId: payload.sub as UserId,
        sessionId: payload.sid,
        locale: (payload.locale === 'en' ? 'en' : 'ar') as Locale,
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const name = (error as Error)?.name;
      if (name === 'TokenExpiredError') {
        throw new DomainError(ErrorCode.Unauthorized, 'Session expired, please sign in again', 401);
      }
      throw new DomainError(ErrorCode.Unauthorized, 'Invalid session', 401);
    }
  }

  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  refreshExpiresAt(from: Date): Date {
    return new Date(from.getTime() + this.config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);
  }
}
