import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ErrorCode } from '@wesal/shared';
import { SYMBOLS, type AccessTokenClaims, type TokenService } from '../../application/ports/services';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import type { SessionRepository } from '../../application/ports/repositories';
import { DomainError } from '../../domain/shared/errors';

export const IS_PUBLIC_KEY = 'wesal:public';
/** مسار عام لا يحتاج جلسة (صفحات الدعوة، "أنا بخير"، الصحة، الدخول) */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthenticatedRequest extends Request {
  auth: AccessTokenClaims;
}

/** `@CurrentUser()` يعيد مطالبات الرمز (userId, sessionId, locale) */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AccessTokenClaims => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.auth;
});

/**
 * حارس الجلسة — رمز وصول قصير العمر يحمل `sessionId` حتى يمكن إبطاله فورًا
 * (تسجيل الخروج، حذف الحساب، كشف إعادة استخدام رمز التحديث).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SYMBOLS.TokenService) private readonly tokens: TokenService,
    @Inject(REPOSITORIES.sessions) private readonly sessions: SessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new DomainError(ErrorCode.Unauthorized, 'Sign in to continue', 401);
    }

    const claims = this.tokens.verifyAccessToken(token);
    const session = await this.sessions.findById(claims.sessionId);
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new DomainError(ErrorCode.Unauthorized, 'Session expired, please sign in again', 401);
    }
    request.auth = claims;
    return true;
  }
}
