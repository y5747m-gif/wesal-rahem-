import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

/**
 * إحصائيات مجمّعة فقط — لا محتوى خاصًا بالمستخدمين
 * (لا رسائل، لا أسماء أقارب، لا أرقام هواتف).
 */
adminRouter.get('/stats', (req, res) => {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const stats = {
    users: one(`SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL`).c,
    activeToday: one(
      `SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL AND last_checkin_at > datetime('now','-1 day')`
    ).c,
    activeWeek: one(
      `SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL AND last_checkin_at > datetime('now','-7 day')`
    ).c,
    checkinsConfirmed: one(`SELECT COUNT(*) AS c FROM checkins WHERE status = 'confirmed'`).c,
    checkinsPending: one(`SELECT COUNT(*) AS c FROM checkins WHERE status = 'pending'`).c,
    schedulesEnabled: one(`SELECT COUNT(*) AS c FROM checkin_schedules WHERE enabled = 1`).c,
    reminders: one(`SELECT COUNT(*) AS c FROM reminders`).c,
    remindersOpen: one(`SELECT COUNT(*) AS c FROM reminders WHERE done = 0`).c,
    notificationsSent: one(`SELECT COUNT(*) AS c FROM notifications`).c,
    escalationAlerts: one(`SELECT COUNT(*) AS c FROM escalation_alerts`).c,
    trustedContacts: one(`SELECT COUNT(*) AS c FROM trusted_contacts`).c,
    relatives: one(`SELECT COUNT(*) AS c FROM relatives`).c,
    contactLogs: one(`SELECT COUNT(*) AS c FROM contact_logs`).c,
    familyLinks: one(`SELECT COUNT(*)/2 AS c FROM family_links`).c,
  };
  const daily = db
    .prepare(
      `SELECT date(confirmed_at) AS day, COUNT(*) AS c FROM checkins
       WHERE status = 'confirmed' AND confirmed_at > datetime('now','-14 day')
       GROUP BY date(confirmed_at) ORDER BY day ASC`
    )
    .all();
  res.json({ stats, dailyConfirmations: daily });
});

/** قائمة مستخدمين مختصرة (بدون بيانات حساسة) لأغراض الدعم */
adminRouter.get('/users', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, email, role, status, last_checkin_at, created_at
       FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`
    )
    .all();
  res.json({ users: rows });
});
