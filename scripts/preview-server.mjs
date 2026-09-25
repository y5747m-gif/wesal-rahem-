#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 4173);

const requiredRuntimeEnv = [
  'NODE_ENV',
  'PUBLIC_BASE_URL',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'FIELD_ENCRYPTION_KEY',
  'CORS_ORIGINS',
];

const optionalRuntimeEnv = [
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
];

function isPresent(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function envStatus() {
  return Object.fromEntries([...requiredRuntimeEnv, ...optionalRuntimeEnv].map((name) => [name, isPresent(name)]));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

async function serveStatic(requestPath, response) {
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = path.join(publicDir, safePath === '/' ? 'index.html' : safePath);

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = path.join(filePath, 'index.html');
    await stat(filePath);
  } catch {
    filePath = path.join(publicDir, 'index.html');
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Type': contentType(filePath),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/health' || url.pathname === '/health') {
    const missingRequired = requiredRuntimeEnv.filter((name) => !isPresent(name));
    return sendJson(response, 200, {
      ok: true,
      service: 'wesal',
      message: 'Wesal preview is reachable. Environment values are never exposed by this endpoint.',
      ready: missingRequired.length === 0,
      missingRequired,
      configured: envStatus(),
      timestamp: new Date().toISOString(),
    });
  }

  if (url.pathname === '/api' || url.pathname === '/api/') {
    return sendJson(response, 200, {
      ok: true,
      service: 'wesal',
      routes: { home: '/', health: '/api/health' },
    });
  }

  return serveStatic(url.pathname, response);
});

server.listen(port, host, async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  console.log(`${packageJson.name} preview server listening on http://${host}:${port}`);
});
