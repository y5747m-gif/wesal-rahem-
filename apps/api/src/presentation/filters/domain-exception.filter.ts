import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, detectLocaleFromAcceptLanguage, getMessages, type ApiFailure, type FieldError } from '@wesal/shared';
import { DomainError } from '../../domain/shared/errors';

/**
 * فلتر أخطاء موحّد: رمز ثابت (يفهمه التطبيق) + رسالة إنسانية بلغة المستخدم.
 * لا نُسرّب تفاصيل داخلية، ولا نستخدم لغة تخويف.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { auth?: { locale?: 'ar' | 'en' } }>();
    const locale = request.auth?.locale ?? detectLocaleFromAcceptLanguage(request.headers['accept-language']);
    const m = getMessages(locale);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.InternalError;
    let message = m.errors.serverError;
    let details: FieldError[] | undefined;

    if (exception instanceof DomainError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      if (exception.details?.field) {
        details = [{ field: String(exception.details.field), code, message: exception.message }];
      }
      if (code === ErrorCode.Unauthorized) message = m.errors.unauthorized;
      else if (code === ErrorCode.NotFound) message = m.errors.notFound;
      else if (code === ErrorCode.Forbidden) message = m.errors.forbidden;
      else if (code === ErrorCode.RateLimited) message = m.errors.rateLimited;
      else if (code === ErrorCode.InvalidOtp) message = m.auth.invalidCode;
      else if (code === ErrorCode.ExpiredOtp) message = m.auth.expiredCode;
      else if (code === ErrorCode.TooManyOtpAttempts) message = m.auth.tooManyAttempts;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | { message?: string | string[]; error?: string };
      const raw = typeof body === 'string' ? body : body.message;
      if (status === HttpStatus.NOT_FOUND) {
        code = ErrorCode.NotFound;
        message = m.errors.notFound;
      } else if (status === HttpStatus.BAD_REQUEST) {
        code = ErrorCode.ValidationError;
        message = m.errors.validation;
        const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
        details = list.map((text) => ({ field: text.split(' ')[0] ?? '', code: 'invalid', message: text }));
      } else if (status === HttpStatus.UNAUTHORIZED) {
        code = ErrorCode.Unauthorized;
        message = m.errors.unauthorized;
      } else if (status === HttpStatus.FORBIDDEN) {
        code = ErrorCode.Forbidden;
        message = m.errors.forbidden;
      } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
        code = ErrorCode.RateLimited;
        message = m.errors.rateLimited;
      } else if (status === HttpStatus.CONFLICT) {
        code = ErrorCode.Conflict;
        message = m.errors.conflict;
      } else {
        message = typeof raw === 'string' ? raw : m.errors.generic;
      }
    } else {
      this.logger.error(`Unhandled error on ${request.method} ${request.url}: ${(exception as Error)?.stack ?? String(exception)}`);
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} → ${status} ${code}`);
    }

    const payload: ApiFailure = { ok: false, error: { code, message, ...(details ? { details } : {}) } };
    response.status(status).json(payload);
  }
}
