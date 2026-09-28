import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/', (req, res) => {
  res.json({ settings: db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) });
});

settingsRouter.patch('/', (req, res) => {
  const cur = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  const { language, theme, notificationsOn, kinshipNudgesOn, shareStatus, onboarded } = req.body || {};
  db.prepare(
    `UPDATE settings SET language = ?, theme = ?, notifications_on = ?, kinship_nudges_on = ?, share_status = ?, onboarded = ?
     WHERE user_id = ?`
  ).run(
    ['ar', 'en'].includes(language) ? language : cur.language,
    ['light', 'dark', 'system'].includes(theme) ? theme : cur.theme,
    notificationsOn === undefined ? cur.notifications_on : notificationsOn ? 1 : 0,
    kinshipNudgesOn === undefined ? cur.kinship_nudges_on : kinshipNudgesOn ? 1 : 0,
    shareStatus === undefined ? cur.share_status : shareStatus ? 1 : 0,
    onboarded === undefined ? cur.onboarded : onboarded ? 1 : 0,
    req.user.id
  );
  res.json({ settings: db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) });
});

/** تصدير كل بيانات المستخدم (JSON) */
settingsRouter.get('/export', (req, res) => {
  const id = req.user.id;
  const pick = (sql) => db.prepare(sql).all(id);
  const data = {
    exportedAt: new Date().toISOString(),
    user: {
      name: req.user.name, email: req.user.email, phone: req.user.phone,
      status: req.user.status, lastCheckinAt: req.user.last_checkin_at, createdAt: req.user.created_at,
    },
    settings: db.prepare('SELECT * FROM settings WHERE user_id = ?').get(id),
    checkinSchedule: db.prepare('SELECT * FROM checkin_schedules WHERE user_id = ?').get(id),
    checkins: pick('SELECT * FROM checkins WHERE user_id = ?'),
    trustedContacts: pick('SELECT * FROM trusted_contacts WHERE user_id = ?'),
    relatives: pick('SELECT * FROM relatives WHERE user_id = ?'),
    contactLogs: pick('SELECT * FROM contact_logs WHERE user_id = ?'),
    reminders: pick('SELECT * FROM reminders WHERE user_id = ?'),
    escalationAlerts: pick('SELECT * FROM escalation_alerts WHERE user_id = ?'),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="wesal-export.json"');
  res.json(data);
});
