#!/usr/bin/env node
/**
 * وصال — إدارة قاعدة بيانات PostgreSQL محلية حقيقية (بدون Docker)
 * ------------------------------------------------------------------
 * يستخدم الحزمة `embedded-postgres` التي تحتوي ملفات PostgreSQL 17 الأصلية.
 * الأوامر:
 *   node db.mjs up      → تهيئة (أول مرة فقط) + تشغيل + إنشاء قواعد البيانات، ويبقى يعمل
 *   node db.mjs down    → إيقاف الخادم (مع الحفاظ على البيانات)
 *   node db.mjs status  → فحص حالة الخادم
 *   node db.mjs reset   → حذف البيانات وإعادة التهيئة من الصفر
 *
 * بعد التشغيل تُكتب بيانات الاتصال في <repo>/.tmp/db.json
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EmbeddedPostgres = require('embedded-postgres').default ?? require('embedded-postgres');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const PORT = Number(process.env.PGPORT ?? 5433);
const USER = process.env.PGUSER_LOCAL ?? 'wesal';
const PASSWORD = process.env.PGPASSWORD_LOCAL ?? 'wesal_dev_only';
const DATA_DIR = path.join(REPO_ROOT, '.pgdata');
const TMP_DIR = path.join(REPO_ROOT, '.tmp');
const INFO_FILE = path.join(TMP_DIR, 'db.json');
const DATABASES = ['wesal', 'wesal_test'];
const LOG_FILE = path.join(TMP_DIR, 'postgres.log');

function log(msg) {
  process.stdout.write(`[db] ${msg}\n`);
}

function pgOptions() {
  return {
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    authMethod: 'password',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: [],
    onLog: (message) => {
      try {
        fs.appendFileSync(LOG_FILE, `${message}\n`);
      } catch {
        /* تجاهل */
      }
    },
    onError: (message) => {
      const text = typeof message === 'string' ? message : (message?.message ?? String(message));
      try {
        fs.appendFileSync(LOG_FILE, `ERROR: ${text}\n`);
      } catch {
        /* تجاهل */
      }
      process.stderr.write(`[db:error] ${text}\n`);
    },
  };
}

/** ملفات PostgreSQL تحتاج روابط رمزية لأدوات مثل psql (ننشئها بأنفسنا إن غابت). */
function hydrateToolSymlinks() {
  const binDir = path.join(HERE, 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'bin');
  if (!fs.existsSync(binDir)) return null;
  for (const tool of ['psql', 'pg_isready', 'pg_dump', 'pg_dumpall', 'pg_restore', 'postmaster']) {
    const target = path.join(binDir, tool);
    if (!fs.existsSync(target)) {
      try {
        fs.symlinkSync('postgres', target);
      } catch {
        /* ليس حرجًا */
      }
    }
  }
  return binDir;
}

async function tryConnect(database = 'postgres') {
  const pg = require('pg');
  const client = new pg.Client({
    host: '127.0.0.1',
    port: PORT,
    user: USER,
    password: PASSWORD,
    database,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  return client;
}

async function isRunning() {
  try {
    const client = await tryConnect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

function writeInfo() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const base = {
    host: '127.0.0.1',
    port: PORT,
    user: USER,
    password: PASSWORD,
    databases: DATABASES,
    startedAt: new Date().toISOString(),
    version: 'PostgreSQL 17 (embedded)',
  };
  base.connectionString = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/wesal`;
  base.testConnectionString = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/wesal_test`;
  fs.writeFileSync(INFO_FILE, `${JSON.stringify(base, null, 2)}\n`);
  log(`بيانات الاتصال: ${INFO_FILE}`);
  log(`DATABASE_URL=${base.connectionString}`);
  return base;
}

async function ensureDatabases() {
  const client = await tryConnect('postgres');
  try {
    for (const db of DATABASES) {
      const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (found.rowCount === 0) {
        await client.query(`CREATE DATABASE ${db} ENCODING 'UTF8' TEMPLATE template0`);
        log(`تم إنشاء قاعدة البيانات: ${db}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function cmdUp() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  hydrateToolSymlinks();

  if (await isRunning()) {
    log(`الخادم يعمل بالفعل على المنفذ ${PORT}`);
    await ensureDatabases();
    writeInfo();
    return;
  }

  const pg = new EmbeddedPostgres(pgOptions());
  const firstTime = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  if (firstTime) {
    log('تهيئة مجلد البيانات لأول مرة (initdb)…');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    await pg.initialise();
  }

  log(`تشغيل PostgreSQL على المنفذ ${PORT}…`);
  await pg.start();

  // ننتظر حتى يقبل الخادم الاتصالات فعلًا
  for (let i = 0; i < 40; i += 1) {
    if (await isRunning()) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!(await isRunning())) throw new Error('لم يستجب خادم PostgreSQL بعد التشغيل');

  await ensureDatabases();
  const info = writeInfo();
  log('✅ PostgreSQL جاهز. اضغط Ctrl+C للإيقاف.');

  const shutdown = async (signal) => {
    log(`إشارة ${signal} — إيقاف الخادم…`);
    try {
      await pg.stop();
    } catch (error) {
      log(`تعذّر الإيقاف النظيف: ${error.message}`);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // نُبقى العملية حية (embedded-postgres يوقف الخادم عند خروجها)
  setInterval(() => {
    void isRunning().then((ok) => {
      if (!ok) log('تحذير: فقدنا الاتصال بالخادم');
    });
  }, 30_000);
  return info;
}

async function cmdDown() {
  const binDir = hydrateToolSymlinks();
  if (binDir) {
    const res = spawnSync(path.join(binDir, 'pg_ctl'), ['-D', DATA_DIR, '-m', 'fast', 'stop'], {
      stdio: 'inherit',
    });
    if (res.status === 0) {
      log('تم إيقاف الخادم (البيانات محفوظة).');
      return;
    }
  }
  // محاولة بديلة عبر المكتبة
  try {
    const pg = new EmbeddedPostgres(pgOptions());
    await pg.stop();
    log('تم إيقاف الخادم.');
  } catch (error) {
    log(`تعذّر الإيقاف: ${error.message}`);
    process.exitCode = 1;
  }
}

async function cmdStatus() {
  const ok = await isRunning();
  if (!ok) {
    log(`❌ الخادم لا يعمل على المنفذ ${PORT}`);
    process.exitCode = 1;
    return;
  }
  const client = await tryConnect('wesal');
  const { rows } = await client.query('SELECT version(), current_database(), now()');
  await client.end();
  log(`✅ يعمل: ${rows[0].version}`);
  if (fs.existsSync(INFO_FILE)) log(fs.readFileSync(INFO_FILE, 'utf8').trim());
}

async function cmdReset() {
  await cmdDown().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  log('تم حذف مجلد البيانات. شغّل `npm run db:up` مرة أخرى.');
}

const command = process.argv[2] ?? 'up';
const runners = { up: cmdUp, down: cmdDown, status: cmdStatus, reset: cmdReset };

if (!runners[command]) {
  log(`أمر غير معروف: ${command} (المتاح: up | down | status | reset)`);
  process.exit(1);
}

runners[command]().catch((error) => {
  process.stderr.write(`[db] فشل: ${error?.stack ?? error}\n`);
  process.exit(1);
});
