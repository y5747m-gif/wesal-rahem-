import { Router } from 'express';
import { db, uid, nowIso } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const checkinsRouter = Router();
checkinsRouter.use(requireAuth);

/** الحالة الحالية: آخر تأكيد + الموعد المفتوح إن وجد */
checkinsRouter.get('/status', (req, res) => {
  const open = db
    .prepare(`SELECT * FROM checkins WHERE user_id = ? AND status = 'pending' ORDER BY due_at DESC LIMIT 1`)
    .get(req.user.id);
  const schedule = db.prepare('SELECT * FROM checkin_schedules WHERE user_id = ?').get(req.user.id);
  res.json({
    status: req.user.status,
    lastCheckinAt: req.user.last_checkin_at,
    open: open || null,
    schedule,
  });
});

/** "أنا بخير" — يغلق أي موعد مفتوح ويوقف التصعيد فورًا */
checkinsRouter.post('/confirm', (req, res) => {
  const now = nowIso();
  const open = db
    .prepare(`SELECT * FROM checkins WHERE user_id = ? AND status = 'pending'`)
    .all(req.user.id);
  for (const c of open) {
    db.prepare(`UPDATE checkins SET status = 'confirmed', confirmed_at = ?, next_action_at = NULL WHERE id = ?`)
      .run(now, c.id);
  }
  if (open.length === 0) {
    // تأكيد تلقائي خارج الجدول — نسجله أيضًا
    db.prepare(`INSERT INTO checkins (id, user_id, due_at, status, confirmed_at, stage) VALUES (?,?,?,?,?,0)`)
      .run(uid(), req.user.id, now, 'confirmed', now);
  }
  db.prepare(`UPDATE users SET status = 'ok', last_checkin_at = ? WHERE id = ?`).run(now, req.user.id);
  res.json({ ok: true, lastCheckinAt: now });
});

/** "تذكيري لاحقًا" — يؤجل المرحلة التالية */
checkinsRouter.post('/snooze', (req, res) => {
  const minutes = Math.min(Math.max(Number(req.body?.minutes) || 30, 5), 240);
  const next = new Date(Date.now() + minutes * 60000).toISOString();
  const info = db
    .prepare(`UPDATE checkins SET next_action_at = ?, snoozed_until = ? WHERE user_id = ? AND status = 'pending'`)
    .run(next, next, req.user.id);
  res.json({ ok: true, snoozedUntil: next, affected: info.changes });
});

/** تحديث جدول الاطمئنان */
checkinsRouter.put('/schedule', (req, res) => {
  const { enabled, frequency, customDays, timeOfDay, timezoneOffset, graceMinutes, reminderGapMinutes } = req.body || {};
  const freqs = ['daily', 'every2', 'every3', 'weekly', 'custom'];
  if (frequency && !freqs.includes(frequency)) {
    return res.status(400).json({ error: 'validation', message: 'تكرار غير صالح.' });
  }
  if (timeOfDay && !/^\d{2}:\d{2}$/.test(timeOfDay)) {
    return res.status(400).json({ error: 'validation', message: 'صيغة الوقت غير صالحة.' });
  }
  const cur = db.prepare('SELECT * FROM checkin_schedules WHERE user_id = ?').get(req.user.id);
  db.prepare(
    `UPDATE checkin_schedules SET
       enabled = ?, frequency = ?, custom_days = ?, time_of_day = ?,
       timezone_offset = ?, grace_minutes = ?, reminder_gap_minutes = ?, updated_at = datetime('now')
     WHERE user_id = ?`
  ).run(
    enabled === undefined ? cur.enabled : enabled ? 1 : 0,
    frequency || cur.frequency,
    customDays === undefined ? cur.custom_days : Math.max(1, Math.min(90, Number(customDays) || 1)),
    timeOfDay || cur.time_of_day,
    timezoneOffset === undefined ? cur.timezone_offset : Number(timezoneOffset) || 0,
    graceMinutes === undefined ? cur.grace_minutes : Math.max(5, Math.min(720, Number(graceMinutes) || 60)),
    reminderGapMinutes === undefined ? cur.reminder_gap_minutes : Math.max(5, Math.min(720, Number(reminderGapMinutes) || 30)),
    req.user.id
  );
  // عند تعطيل النظام: إغلاق أي مواعيد مفتوحة وإرجاع الحالة إلى بخير
  if (enabled === false) {
    db.prepare(`UPDATE checkins SET status = 'missed_closed', next_action_at = NULL WHERE user_id = ? AND status = 'pending'`)
      .run(req.user.id);
    db.prepare(`UPDATE users SET status = 'ok' WHERE id = ?`).run(req.user.id);
  }
  res.json({ schedule: db.prepare('SELECT * FROM checkin_schedules WHERE user_id = ?').get(req.user.id) });
});

/** سجل عمليات التأكيد */
checkinsRouter.get('/history', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM checkins WHERE user_id = ? ORDER BY due_at DESC LIMIT 50`)
    .all(req.user.id);
  res.json({ checkins: rows });
});

/** تنبيهات التصعيد التي أُرسلت باسم المستخدم (شفافية كاملة) */
checkinsRouter.get('/alerts', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM escalation_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(req.user.id);
  res.json({ alerts: rows });
});
