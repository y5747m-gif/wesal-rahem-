import { ErrorCode } from '@wesal/shared';

/**
 * أخطاء النطاق — تُترجم في طبقة العرض إلى رمز ثابت + رسالة إنسانية بلغة المستخدم.
 * لا رسائل تخويف في أي خطأ (مبدأ 5 في الوثيقة).
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, httpStatus = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.ValidationError, message, 400, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity = 'Resource') {
    super(ErrorCode.NotFound, `${entity} not found`, 404);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to perform this action') {
    super(ErrorCode.Forbidden, message, 403);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.Conflict, message, 409, details);
  }
}

/** تُرمى عندما يكون الإجراء حساسًا ويتطلب موافقة صريحة (مبدأ 3: الموافقة أولًا) */
export class ConsentRequiredError extends DomainError {
  constructor(message = 'Explicit consent is required before this action') {
    super(ErrorCode.ConsentRequired, message, 403);
  }
}

export class InvalidOtpError extends DomainError {
  constructor() {
    super(ErrorCode.InvalidOtp, 'Invalid verification code', 401);
  }
}

export class ExpiredOtpError extends DomainError {
  constructor() {
    super(ErrorCode.ExpiredOtp, 'Verification code expired', 401);
  }
}

export class TooManyOtpAttemptsError extends DomainError {
  constructor() {
    super(ErrorCode.TooManyOtpAttempts, 'Too many verification attempts', 429);
  }
}

export class RateLimitedError extends DomainError {
  constructor(message = 'Too many requests') {
    super(ErrorCode.RateLimited, message, 429);
  }
}
