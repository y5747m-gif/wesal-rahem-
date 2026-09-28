import 'dotenv/config';
import crypto from 'node:crypto';

const bool = (v, d) => (v === undefined ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  dbFile: process.env.DB_FILE || new URL('../data/wesal.db', import.meta.url).pathname,
  jwtSecret: process.env.JWT_SECRET || null,
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
  // مزوّد الرسائل الخارجية للتصعيد: log (افتراضي) | webhook
  smsProvider: process.env.SMS_PROVIDER || 'log',
  smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 20000),
  seedDemo: bool(process.env.SEED_DEMO, true),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@wesal.app',
  adminPassword: process.env.ADMIN_PASSWORD || null,
  serveWebDist: bool(process.env.SERVE_WEB_DIST, false),
};

if (!config.jwtSecret) {
  if (config.env === 'production') {
    console.error('❌ JWT_SECRET مطلوب في الإنتاج. أوقف التشغيل.');
    process.exit(1);
  }
  config.jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  JWT_SECRET غير مضبوط — تم توليد سر مؤقت (وضع التطوير فقط).');
}

if (config.env === 'production' && !config.adminPassword) {
  console.warn('⚠️  ADMIN_PASSWORD غير مضبوط — لن يُنشأ حساب إدارة تلقائيًا.');
}
