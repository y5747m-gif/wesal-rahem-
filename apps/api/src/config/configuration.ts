import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EnvironmentVariables } from './env.validation';

/**
 * إعدادات التطبيق — نوع واحد صارم يُستخدم في كل الطبقات.
 *
 * ⚠️ في الإنتاج:
 *  - OTP_DEV_MODE يجب أن يكون false (لا يُعاد الرمز في الاستجابة ولا يُسجَّل).
 *  - الأسرار يجب أن تكون قوية ومختلفة عن قيم المثال.
 */
export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  publicBaseUrl: string;
  corsOrigins: string[];
  logLevel: 'error' | 'warn' | 'log' | 'debug';

  databaseUrl: string;
  databaseSsl: boolean;
  databaseMaxConnections: number;
  /** تطبيق الهجرات تلقائيًا عند الإقلاع (تطوير/اختبار) — في الإنتاج تُطبَّق في خطوة النشر */
  databaseAutoMigrate: boolean;

  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlDays: number;
  };

  otp: {
    ttlMinutes: number;
    maxAttempts: number;
    length: number;
    resendCooldownSeconds: number;
    devMode: boolean;
    fixedDevCode?: string;
  };

  crypto: { fieldEncryptionKey: string };

  invites: { ttlDays: number; webCheckInLinkTtlMinutes: number };

  scheduler: {
    enabled: boolean;
    tickSeconds: number;
    weeksAhead: number;
    defaultGracePeriodMinutes: number;
  };

  notifications: {
    driver: 'push' | 'log';
    smsDriver: 'log' | 'sms_provider';
    smsMaxPerDayPerContact: number;
    fcm: { projectId?: string; clientEmail?: string; privateKey?: string };
  };

  throttle: { ttlSeconds: number; limit: number; authTtlSeconds: number; authLimit: number };
  auditEnabled: boolean;
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const instance = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });
  const errors = validateSync(instance, { skipMissingProperties: false, whitelist: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`❌ إعدادات البيئة غير صالحة:\n${details}`);
  }
  return instance;
}

export function buildConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const vars = validateEnv({ ...env });

  const config: AppConfig = {
    env: vars.NODE_ENV,
    isProduction: vars.NODE_ENV === 'production',
    port: vars.PORT,
    apiPrefix: vars.API_PREFIX,
    publicBaseUrl: vars.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    corsOrigins: vars.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    logLevel: vars.LOG_LEVEL,
    databaseUrl: vars.DATABASE_URL,
    databaseSsl: vars.DATABASE_SSL,
    databaseMaxConnections: vars.DATABASE_MAX_CONNECTIONS,
    databaseAutoMigrate: vars.NODE_ENV === 'production' ? false : vars.DATABASE_AUTO_MIGRATE,
    jwt: {
      accessSecret: vars.JWT_ACCESS_SECRET,
      refreshSecret: vars.JWT_REFRESH_SECRET,
      accessTtlSeconds: vars.JWT_ACCESS_TTL_SECONDS,
      refreshTtlDays: vars.JWT_REFRESH_TTL_DAYS,
    },
    otp: {
      ttlMinutes: vars.OTP_TTL_MINUTES,
      maxAttempts: vars.OTP_MAX_ATTEMPTS,
      length: vars.OTP_LENGTH,
      resendCooldownSeconds: vars.OTP_RESEND_COOLDOWN_SECONDS,
      devMode: vars.OTP_DEV_MODE,
      ...(vars.OTP_FIXED_DEV_CODE ? { fixedDevCode: vars.OTP_FIXED_DEV_CODE } : {}),
    },
    crypto: { fieldEncryptionKey: vars.FIELD_ENCRYPTION_KEY },
    invites: { ttlDays: vars.INVITE_TTL_DAYS, webCheckInLinkTtlMinutes: vars.WEB_CHECKIN_LINK_TTL_MINUTES },
    scheduler: {
      enabled: vars.SCHEDULER_ENABLED,
      tickSeconds: vars.SCHEDULER_TICK_SECONDS,
      weeksAhead: vars.SCHEDULE_GENERATION_WEEKS_AHEAD,
      defaultGracePeriodMinutes: vars.DEFAULT_GRACE_PERIOD_MINUTES,
    },
    notifications: {
      driver: vars.NOTIFICATION_DRIVER,
      smsDriver: vars.SMS_DRIVER,
      smsMaxPerDayPerContact: vars.SMS_MAX_PER_DAY_PER_CONTACT,
      fcm: {
        ...(vars.FCM_PROJECT_ID ? { projectId: vars.FCM_PROJECT_ID } : {}),
        ...(vars.FCM_CLIENT_EMAIL ? { clientEmail: vars.FCM_CLIENT_EMAIL } : {}),
        ...(vars.FCM_PRIVATE_KEY ? { privateKey: vars.FCM_PRIVATE_KEY } : {}),
      },
    },
    throttle: {
      ttlSeconds: vars.THROTTLE_TTL_SECONDS,
      limit: vars.THROTTLE_LIMIT,
      authTtlSeconds: vars.THROTTLE_AUTH_TTL_SECONDS,
      authLimit: vars.THROTTLE_AUTH_LIMIT,
    },
    auditEnabled: vars.AUDIT_ENABLED,
  };

  assertProductionSafety(config);
  return config;
}

/** حواجز أمان قبل الإقلاع في الإنتاج */
function assertProductionSafety(config: AppConfig): void {
  if (!config.isProduction) return;
  const problems: string[] = [];
  if (config.otp.devMode) problems.push('OTP_DEV_MODE must be false in production');
  if (config.jwt.accessSecret.includes('change-me')) problems.push('JWT_ACCESS_SECRET must be changed');
  if (config.jwt.refreshSecret.includes('change-me')) problems.push('JWT_REFRESH_SECRET must be changed');
  if (/^0+$/.test(config.crypto.fieldEncryptionKey)) problems.push('FIELD_ENCRYPTION_KEY must be a real 32-byte hex key');
  if (config.corsOrigins.includes('*')) problems.push('CORS_ORIGINS must not be "*" in production');
  if (config.databaseUrl.includes('wesal_dev_only')) problems.push('DATABASE_URL must not use the local dev password');
  if (problems.length > 0) {
    throw new Error(`❌ Production configuration is unsafe:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

export const CONFIG = Symbol('APP_CONFIG');
