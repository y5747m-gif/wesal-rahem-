import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * التحقق من متغيرات البيئة — يفشل التشغيل مبكرًا برسالة واضحة بدل سلوك غامض لاحقًا.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  @IsOptional()
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT = 4000;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  API_PREFIX = 'v1';

  @IsString()
  @MinLength(10)
  DATABASE_URL!: string;

  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  @IsOptional()
  DATABASE_SSL = false;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  DATABASE_MAX_CONNECTIONS = 10;

  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  @IsOptional()
  DATABASE_AUTO_MIGRATE = true;

  @IsString()
  @MinLength(16)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(16)
  JWT_REFRESH_SECRET!: string;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @IsOptional()
  JWT_ACCESS_TTL_SECONDS = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  JWT_REFRESH_TTL_DAYS = 30;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  OTP_TTL_MINUTES = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  OTP_MAX_ATTEMPTS = 5;

  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(8)
  @IsOptional()
  OTP_LENGTH = 6;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @IsOptional()
  OTP_RESEND_COOLDOWN_SECONDS = 60;

  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  @IsOptional()
  OTP_DEV_MODE = false;

  @IsString()
  @MaxLength(8)
  @IsOptional()
  OTP_FIXED_DEV_CODE?: string;

  @IsString()
  @MinLength(64)
  @MaxLength(64)
  FIELD_ENCRYPTION_KEY!: string;

  @IsString()
  @IsOptional()
  PUBLIC_BASE_URL = 'http://localhost:4000';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  INVITE_TTL_DAYS = 14;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  @IsOptional()
  WEB_CHECKIN_LINK_TTL_MINUTES = 45;

  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  @IsOptional()
  SCHEDULER_ENABLED = true;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(3600)
  @IsOptional()
  SCHEDULER_TICK_SECONDS = 30;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  @IsOptional()
  SCHEDULE_GENERATION_WEEKS_AHEAD = 3;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10080)
  @IsOptional()
  DEFAULT_GRACE_PERIOD_MINUTES = 90;

  @IsIn(['push', 'log'])
  @IsOptional()
  NOTIFICATION_DRIVER: 'push' | 'log' = 'log';

  @IsString()
  @IsOptional()
  FCM_PROJECT_ID?: string;

  @IsString()
  @IsOptional()
  FCM_CLIENT_EMAIL?: string;

  @IsString()
  @IsOptional()
  FCM_PRIVATE_KEY?: string;

  @IsIn(['log', 'sms_provider'])
  @IsOptional()
  SMS_DRIVER: 'log' | 'sms_provider' = 'log';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  SMS_MAX_PER_DAY_PER_CONTACT = 2;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  THROTTLE_TTL_SECONDS = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  THROTTLE_LIMIT = 120;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  THROTTLE_AUTH_TTL_SECONDS = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  THROTTLE_AUTH_LIMIT = 10;

  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  @IsOptional()
  AUDIT_ENABLED = true;

  @IsIn(['error', 'warn', 'log', 'debug'])
  @IsOptional()
  LOG_LEVEL: 'error' | 'warn' | 'log' | 'debug' = 'log';

  @IsString()
  @IsOptional()
  CORS_ORIGINS = '*';
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}
