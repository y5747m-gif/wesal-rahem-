const REQUIRED_RUNTIME_ENV = [
  'NODE_ENV',
  'PUBLIC_BASE_URL',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'FIELD_ENCRYPTION_KEY',
  'CORS_ORIGINS',
] as const;

const OPTIONAL_RUNTIME_ENV = [
  'API_PREFIX',
  'DATABASE_SSL',
  'DATABASE_MAX_CONNECTIONS',
  'JWT_ACCESS_TTL_SECONDS',
  'JWT_REFRESH_TTL_DAYS',
  'OTP_TTL_MINUTES',
  'OTP_MAX_ATTEMPTS',
  'OTP_LENGTH',
  'OTP_RESEND_COOLDOWN_SECONDS',
  'OTP_DEV_MODE',
  'OTP_FIXED_DEV_CODE',
  'INVITE_TTL_DAYS',
  'WEB_CHECKIN_LINK_TTL_MINUTES',
  'SCHEDULER_ENABLED',
  'SCHEDULER_TICK_SECONDS',
  'SCHEDULE_GENERATION_WEEKS_AHEAD',
  'DEFAULT_GRACE_PERIOD_MINUTES',
  'NOTIFICATION_DRIVER',
  'FCM_PROJECT_ID',
  'FCM_CLIENT_EMAIL',
  'FCM_PRIVATE_KEY',
  'SMS_DRIVER',
  'SMS_MAX_PER_DAY_PER_CONTACT',
  'THROTTLE_TTL_SECONDS',
  'THROTTLE_LIMIT',
  'THROTTLE_AUTH_TTL_SECONDS',
  'THROTTLE_AUTH_LIMIT',
  'AUDIT_ENABLED',
  'LOG_LEVEL',
] as const;

function isPresent(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function maskEnvironment(): Record<string, boolean> {
  return Object.fromEntries(
    [...REQUIRED_RUNTIME_ENV, ...OPTIONAL_RUNTIME_ENV].map((name) => [name, isPresent(name)]),
  );
}

export default function handler(_request: unknown, response: any): void {
  const missingRequired = REQUIRED_RUNTIME_ENV.filter((name) => !isPresent(name));

  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.status(200).json({
    ok: true,
    service: 'wesal',
    message: 'Wesal deployment is reachable. Environment values are never exposed by this endpoint.',
    ready: missingRequired.length === 0,
    missingRequired,
    configured: maskEnvironment(),
    timestamp: new Date().toISOString(),
  });
}
