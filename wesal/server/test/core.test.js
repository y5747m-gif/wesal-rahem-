// اختبارات أساسية: المصادقة، العزل بين المستخدمين، رسالة التصعيد، الجدولة
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wesal-test-')), 'test.db');
process.env.SEED_DEMO = 'false';
process.env.JWT_SECRET = 'test-secret-for-unit-tests-only-0000';
process.env.SCHEDULER_INTERVAL_MS = '999999';

const { db, uid, linkCode } = await import('../src/db/index.js');
const { escalationMessage, computeNextDue } = await import('../src/services/scheduler.js');
const bcrypt = (await import('bcryptjs')).default;

test('رسالة التصعيد هادئة وخالية من لغة الخطر', () => {
  const msg = escalationMessage('سارة');
  assert.match(msg, /سارة/);
  assert.match(msg, /نرجو الاطمئنان عليه/);
  for (const scary of ['خطر', 'مكروه', 'حادث', 'مريض', 'طوارئ']) {
    assert.ok(!msg.includes(scary), `الرسالة يجب ألا تتضمن كلمة "${scary}"`);
  }
});

test('حساب الموعد التالي يحترم وقت المستخدم', () => {
  const schedule = { time_of_day: '20:00', timezone_offset: 0 };
  const from = new Date('2026-01-10T10:00:00Z');
  const next = computeNextDue(schedule, from);
  assert.equal(next, '2026-01-10T20:00:00.000Z');
  const after8 = computeNextDue(schedule, new Date('2026-01-10T21:00:00Z'));
  assert.equal(after8, '2026-01-11T20:00:00.000Z');
});

test('كلمات المرور لا تخزن كنص صريح', () => {
  const hash = bcrypt.hashSync('MyPassword123', 12);
  const id = uid();
  db.prepare(`INSERT INTO users (id, name, email, password_hash, link_code) VALUES (?,?,?,?,?)`)
    .run(id, 'اختبار', 'test1@x.com', hash, linkCode());
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
  assert.notEqual(row.password_hash, 'MyPassword123');
  assert.ok(row.password_hash.startsWith('$2'));
});

test('عزل البيانات: مستخدم لا يرى أقارب مستخدم آخر', () => {
  const u1 = uid(), u2 = uid();
  for (const [id, email] of [[u1, 'a@x.com'], [u2, 'b@x.com']]) {
    db.prepare(`INSERT INTO users (id, name, email, password_hash, link_code) VALUES (?,?,?,?,?)`)
      .run(id, 'م', email, 'h', linkCode());
  }
  db.prepare(`INSERT INTO relatives (id, user_id, name, relation) VALUES (?,?,?,?)`)
    .run(uid(), u1, 'والدة المستخدم الأول', 'أمي');
  const forU2 = db.prepare('SELECT * FROM relatives WHERE user_id = ?').all(u2);
  assert.equal(forU2.length, 0);
});

test('حذف المستخدم يحذف كل بياناته (CASCADE)', () => {
  const u = uid();
  db.prepare(`INSERT INTO users (id, name, email, password_hash, link_code) VALUES (?,?,?,?,?)`)
    .run(u, 'م', 'c@x.com', 'h', linkCode());
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(u);
  db.prepare(`INSERT INTO relatives (id, user_id, name, relation) VALUES (?,?,?,?)`).run(uid(), u, 'قريب', 'أخي');
  db.prepare(`INSERT INTO notifications (id, user_id, title) VALUES (?,?,?)`).run(uid(), u, 'إشعار');
  db.prepare('DELETE FROM users WHERE id = ?').run(u);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM relatives WHERE user_id = ?').get(u).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get(u).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM settings WHERE user_id = ?').get(u).c, 0);
});

after(() => {
  try { fs.rmSync(path.dirname(process.env.DB_FILE), { recursive: true, force: true }); } catch {}
});
