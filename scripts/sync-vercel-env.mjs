#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const target = process.argv[2] ?? process.env.VERCEL_ENVIRONMENT ?? 'production';
const allowedTargets = new Set(['production', 'preview', 'development']);

if (!allowedTargets.has(target)) {
  console.error(`Invalid Vercel environment "${target}". Use production, preview, or development.`);
  process.exit(1);
}

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error('Missing VERCEL_TOKEN. Add it as a GitHub secret before running this script.');
  process.exit(1);
}

const boolDefault = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value);
};

const normalizeSecret = (key, value) => {
  if (typeof value !== 'string') return value;
  if (key === 'FCM_PRIVATE_KEY') return value.replace(/\\n/g, '\n');
  return value;
};

const variables = [
  { key: 'NODE_ENV', value: process.env.APP_NODE_ENV || (target === 'production' ? 'production' : 'development'), required: true },
  { key: 'API_PREFIX', value: process.env.API_PREFIX || 'v1', required: true },
  { key: 'PUBLIC_BASE_URL', value: process.env.PUBLIC_BASE_URL, required: true },
  { key: 'CORS_ORIGINS', value: process.env.CORS_ORIGINS, required: true },

  { key: 'DATABASE_URL', value: process.env.DATABASE_URL, required: true },
  { key: 'DATABASE_SSL', value: boolDefault(process.env.DATABASE_SSL, target === 'production' ? 'true' : 'false'), required: true },
  { key: 'DATABASE_MAX_CONNECTIONS', value: process.env.DATABASE_MAX_CONNECTIONS || '10', required: true },

  { key: 'JWT_ACCESS_SECRET', value: process.env.JWT_ACCESS_SECRET, required: true },
  { key: 'JWT_REFRESH_SECRET', value: process.env.JWT_REFRESH_SECRET, required: true },
  { key: 'JWT_ACCESS_TTL_SECONDS', value: process.env.JWT_ACCESS_TTL_SECONDS || '900', required: true },
  { key: 'JWT_REFRESH_TTL_DAYS', value: process.env.JWT_REFRESH_TTL_DAYS || '30', required: true },

  { key: 'OTP_TTL_MINUTES', value: process.env.OTP_TTL_MINUTES || '10', required: true },
  { key: 'OTP_MAX_ATTEMPTS', value: process.env.OTP_MAX_ATTEMPTS || '5', required: true },
  { key: 'OTP_LENGTH', value: process.env.OTP_LENGTH || '6', required: true },
  { key: 'OTP_RESEND_COOLDOWN_SECONDS', value: process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', required: true },
  { key: 'OTP_DEV_MODE', value: boolDefault(process.env.OTP_DEV_MODE, target === 'production' ? 'false' : 'true'), required: true },
  { key: 'OTP_FIXED_DEV_CODE', value: process.env.OTP_FIXED_DEV_CODE, required: false },

  { key: 'FIELD_ENCRYPTION_KEY', value: process.env.FIELD_ENCRYPTION_KEY, required: true },

  { key: 'INVITE_TTL_DAYS', value: process.env.INVITE_TTL_DAYS || '14', required: true },
  { key: 'WEB_CHECKIN_LINK_TTL_MINUTES', value: process.env.WEB_CHECKIN_LINK_TTL_MINUTES || '45', required: true },

  { key: 'SCHEDULER_ENABLED', value: boolDefault(process.env.SCHEDULER_ENABLED, 'true'), required: true },
  { key: 'SCHEDULER_TICK_SECONDS', value: process.env.SCHEDULER_TICK_SECONDS || '30', required: true },
  { key: 'SCHEDULE_GENERATION_WEEKS_AHEAD', value: process.env.SCHEDULE_GENERATION_WEEKS_AHEAD || '3', required: true },
  { key: 'DEFAULT_GRACE_PERIOD_MINUTES', value: process.env.DEFAULT_GRACE_PERIOD_MINUTES || '90', required: true },

  { key: 'NOTIFICATION_DRIVER', value: process.env.NOTIFICATION_DRIVER || 'log', required: true },
  { key: 'FCM_PROJECT_ID', value: process.env.FCM_PROJECT_ID, required: false },
  { key: 'FCM_CLIENT_EMAIL', value: process.env.FCM_CLIENT_EMAIL, required: false },
  { key: 'FCM_PRIVATE_KEY', value: process.env.FCM_PRIVATE_KEY, required: false },
  { key: 'SMS_DRIVER', value: process.env.SMS_DRIVER || 'log', required: true },
  { key: 'SMS_MAX_PER_DAY_PER_CONTACT', value: process.env.SMS_MAX_PER_DAY_PER_CONTACT || '2', required: true },

  { key: 'THROTTLE_TTL_SECONDS', value: process.env.THROTTLE_TTL_SECONDS || '60', required: true },
  { key: 'THROTTLE_LIMIT', value: process.env.THROTTLE_LIMIT || '120', required: true },
  { key: 'THROTTLE_AUTH_TTL_SECONDS', value: process.env.THROTTLE_AUTH_TTL_SECONDS || '60', required: true },
  { key: 'THROTTLE_AUTH_LIMIT', value: process.env.THROTTLE_AUTH_LIMIT || '10', required: true },

  { key: 'AUDIT_ENABLED', value: boolDefault(process.env.AUDIT_ENABLED, 'true'), required: true },
  { key: 'LOG_LEVEL', value: process.env.LOG_LEVEL || 'log', required: true },
];

const missing = variables
  .filter((item) => item.required && (item.value === undefined || item.value === null || String(item.value).trim() === ''))
  .map((item) => item.key);

if (missing.length > 0) {
  console.error('Missing required app variables. Add them to GitHub secrets/variables, then run the workflow again:');
  for (const key of missing) console.error(`- ${key}`);
  process.exit(1);
}

function runVercel(args, options = {}) {
  const result = spawnSync('npx', ['--yes', 'vercel@latest', ...args, '--token', token], {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options,
  });

  return result;
}

for (const variable of variables) {
  const rawValue = variable.value;
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    console.log(`skip ${variable.key}: empty optional value`);
    continue;
  }

  const value = normalizeSecret(variable.key, String(rawValue));

  const remove = runVercel(['env', 'rm', variable.key, target, '--yes']);
  if (remove.status !== 0 && !`${remove.stderr}\n${remove.stdout}`.toLowerCase().includes('not found')) {
    console.warn(`warning: could not remove existing ${variable.key}; will try to add it anyway.`);
  }

  const add = runVercel(['env', 'add', variable.key, target], { input: value });
  if (add.status !== 0) {
    console.error(`failed to sync ${variable.key} to Vercel ${target}`);
    if (add.stdout) console.error(add.stdout.trim());
    if (add.stderr) console.error(add.stderr.trim());
    process.exit(add.status ?? 1);
  }

  console.log(`synced ${variable.key} -> Vercel ${target}`);
}

console.log(`Environment sync completed for Vercel ${target}. Secret values were not printed.`);
