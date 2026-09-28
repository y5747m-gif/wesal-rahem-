// بيانات تجريبية: حساب إدارة + حساب تجريبي بأشخاص وسجلات (وضع التطوير فقط)
import bcrypt from 'bcryptjs';
import { db, uid, linkCode, nowIso } from './db/index.js';
import { config } from './config.js';

const daysAgo = (d, h = 0) => new Date(Date.now() - d * 86400000 - h * 3600000).toISOString();

export function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  // حساب الإدارة
  const adminPass = config.adminPassword || 'Admin@Wesal2026';
  const adminId = uid();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, link_code) VALUES (?,?,?,?,?,?)`
  ).run(adminId, 'إدارة وصال', config.adminEmail, bcrypt.hashSync(adminPass, 12), 'admin', linkCode());
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(adminId);
  db.prepare('INSERT INTO checkin_schedules (user_id) VALUES (?)').run(adminId);

  if (!config.seedDemo) return;

  // مستخدم تجريبي
  const demoId = uid();
  db.prepare(
    `INSERT INTO users (id, name, email, phone, password_hash, link_code, status, last_checkin_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(demoId, 'سارة أحمد', 'demo@wesal.app', '+201001234567',
    bcrypt.hashSync('Demo@1234', 12), 'WESAL1', 'ok', daysAgo(0, 3));
  db.prepare('INSERT INTO settings (user_id, onboarded) VALUES (?, 1)').run(demoId);
  db.prepare(
    `INSERT INTO checkin_schedules (user_id, enabled, frequency, time_of_day, grace_minutes, reminder_gap_minutes)
     VALUES (?,?,?,?,?,?)`
  ).run(demoId, 1, 'daily', '20:00', 60, 30);

  // مستخدم مرتبط (أخوها)
  const brotherId = uid();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, link_code, status, last_checkin_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(brotherId, 'محمد أحمد', 'mohamed@wesal.app',
    bcrypt.hashSync('Demo@1234', 12), 'WESAL2', 'ok', daysAgo(0, 5));
  db.prepare('INSERT INTO settings (user_id, onboarded) VALUES (?, 1)').run(brotherId);
  db.prepare('INSERT INTO checkin_schedules (user_id, enabled) VALUES (?, 1)').run(brotherId);

  const auntId = uid();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, link_code, status, last_checkin_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(auntId, 'محمود سمير', 'mahmoud@wesal.app',
    bcrypt.hashSync('Demo@1234', 12), 'WESAL3', 'awaiting', daysAgo(2, 1));
  db.prepare('INSERT INTO settings (user_id, onboarded) VALUES (?, 1)').run(auntId);
  db.prepare('INSERT INTO checkin_schedules (user_id) VALUES (?)').run(auntId);

  for (const [a, b, rel] of [
    [demoId, brotherId, 'أخي'], [brotherId, demoId, 'أختي'],
    [demoId, auntId, 'صديقي'], [auntId, demoId, 'صديقتي'],
  ]) {
    db.prepare('INSERT INTO family_links (id, user_id, linked_user_id, relation) VALUES (?,?,?,?)')
      .run(uid(), a, b, rel);
  }

  // جهات الاتصال الموثوقة
  const contacts = [
    ['محمد', '+201001111111', 'أخي', 1, 'whatsapp'],
    ['أحمد', '+201002222222', 'والدي', 2, 'call'],
    ['محمود', '+201003333333', 'صديقي', 3, 'sms'],
  ];
  for (const [name, phone, rel, pos, method] of contacts) {
    db.prepare(
      `INSERT INTO trusted_contacts (id, user_id, name, phone, relation, position, method) VALUES (?,?,?,?,?,?,?)`
    ).run(uid(), demoId, name, phone, rel, pos, method);
  }

  // صلة الرحم
  const rels = [
    ['والدتي الحبيبة', 'أمي', '+201004444444', 'تحب سماع صوتي كل يومين', 2, 6],
    ['جدتي', 'جدتي', '+201005555555', 'اتصل بها بعد صلاة العصر', 7, 9],
    ['خالي عبد الله', 'خالي', '+201006666666', null, 14, 3],
    ['عمتي فاطمة', 'عمتي', '+201007777777', 'تسأل عني دائمًا', 10, 12],
    ['أخي محمد', 'أخي', '+201001111111', null, 3, 0],
  ];
  const relIds = [];
  for (const [name, rel, phone, notes, every, lastDays] of rels) {
    const id = uid();
    relIds.push({ id, name });
    db.prepare(
      `INSERT INTO relatives (id, user_id, name, relation, phone, notes, contact_every_days, last_contact_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, demoId, name, rel, phone, notes, every, daysAgo(lastDays, 2));
  }

  // سجل التواصل
  const logs = [
    [relIds[4].id, relIds[4].name, 'call', daysAgo(0, 1), null],
    [relIds[0].id, relIds[0].name, 'call', daysAgo(2, 4), 'اطمأننت عليها، الحمد لله بخير'],
    [relIds[2].id, relIds[2].name, 'whatsapp', daysAgo(3, 6), null],
    [relIds[3].id, relIds[3].name, 'message', daysAgo(12, 2), null],
    [null, 'صديقي كريم', 'visit', daysAgo(5, 3), 'زيارة قصيرة بعد العمل'],
  ];
  for (const [rid, name, method, when, note] of logs) {
    db.prepare(
      `INSERT INTO contact_logs (id, user_id, relative_id, person_name, method, note, happened_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(uid(), demoId, rid, name, method, note, when);
  }

  // تذكيرات
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setHours(17, 0, 0, 0);
  const friday = new Date(Date.now() + 3 * 86400000);
  friday.setHours(12, 30, 0, 0);
  db.prepare(
    `INSERT INTO reminders (id, user_id, title, person_name, relative_id, kind, due_at, repeat)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(uid(), demoId, 'اتصل بجدتي', 'جدتي', relIds[1].id, 'call', tomorrow.toISOString(), 'weekly');
  db.prepare(
    `INSERT INTO reminders (id, user_id, title, person_name, relative_id, kind, due_at, repeat)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(uid(), demoId, 'زيارة عمتي فاطمة', 'عمتي فاطمة', relIds[3].id, 'visit', friday.toISOString(), 'none');

  // إشعار ترحيبي
  db.prepare(
    `INSERT INTO notifications (id, user_id, kind, title, body, action) VALUES (?,?,?,?,?,?)`
  ).run(uid(), demoId, 'info', 'أهلًا بك في وصال',
    'رسالة صغيرة منك قد تسعد شخصًا تحبه. ابدأ بإضافة من تحب إلى صلة الرحم.', '/kinship');

  console.log('🌱 تم إنشاء البيانات التجريبية:');
  console.log('   👤 demo@wesal.app / Demo@1234');
  console.log(`   🛡  ${config.adminEmail} / ${adminPass}`);
}
