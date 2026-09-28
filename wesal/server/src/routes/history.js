import { Router } from 'express';
import { db, uid, nowIso } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const historyRouter = Router();
historyRouter.use(requireAuth);

historyRouter.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM contact_logs WHERE user_id = ? ORDER BY happened_at DESC LIMIT 100')
    .all(req.user.id);
  res.json({ logs: rows });
});

/** تسجيل تواصل يدوي (قد لا يكون الشخص ضمن قائمة الأقارب) */
historyRouter.post('/', (req, res) => {
  const { personName, relativeId, method, note, happenedAt } = req.body || {};
  if (!personName?.trim() && !relativeId) {
    return res.status(400).json({ error: 'validation', message: 'اسم الشخص مطلوب.' });
  }
  let name = personName?.trim();
  if (relativeId) {
    const r = db.prepare('SELECT * FROM relatives WHERE id = ? AND user_id = ?').get(relativeId, req.user.id);
    if (!r) return res.status(404).json({ error: 'not_found', message: 'الشخص غير موجود.' });
    name = r.name;
  }
  const m = ['call', 'message', 'whatsapp', 'visit', 'other'].includes(method) ? method : 'call';
  const when = happenedAt ? new Date(happenedAt).toISOString() : nowIso();
  db.prepare(
    `INSERT INTO contact_logs (id, user_id, relative_id, person_name, method, note, happened_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(uid(), req.user.id, relativeId || null, name, m, note?.trim() || null, when);
  if (relativeId) {
    db.prepare(`UPDATE relatives SET last_contact_at = MAX(COALESCE(last_contact_at, ''), ?) WHERE id = ?`)
      .run(when, relativeId);
  }
  res.status(201).json({ ok: true });
});

historyRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM contact_logs WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});
