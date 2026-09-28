import { Router } from 'express';
import { db, uid, nowIso } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const relativesRouter = Router();
relativesRouter.use(requireAuth);

function withMeta(r) {
  const lastMs = r.last_contact_at ? new Date(r.last_contact_at).getTime() : null;
  const daysSince = lastMs === null ? null : Math.floor((Date.now() - lastMs) / 86400000);
  const nextDue = lastMs === null
    ? nowIso()
    : new Date(lastMs + r.contact_every_days * 86400000).toISOString();
  return { ...r, daysSince, nextDue, overdue: daysSince === null || daysSince >= r.contact_every_days };
}

relativesRouter.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM relatives WHERE user_id = ? ORDER BY created_at ASC').all(req.user.id);
  res.json({ relatives: rows.map(withMeta) });
});

relativesRouter.post('/', (req, res) => {
  const { name, relation, phone, avatar, notes, contactEveryDays } = req.body || {};
  if (!name?.trim() || !relation?.trim()) {
    return res.status(400).json({ error: 'validation', message: 'الاسم وصلة القرابة مطلوبان.' });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO relatives (id, user_id, name, relation, phone, avatar, notes, contact_every_days)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, req.user.id, name.trim(), relation.trim(), phone?.trim() || null,
    avatar || null, notes?.trim() || null, Math.max(1, Math.min(365, Number(contactEveryDays) || 7)));
  res.status(201).json({ relative: withMeta(db.prepare('SELECT * FROM relatives WHERE id = ?').get(id)) });
});

relativesRouter.get('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM relatives WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'not_found', message: 'الشخص غير موجود.' });
  const logs = db
    .prepare('SELECT * FROM contact_logs WHERE relative_id = ? AND user_id = ? ORDER BY happened_at DESC LIMIT 30')
    .all(r.id, req.user.id);
  res.json({ relative: withMeta(r), logs });
});

relativesRouter.patch('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM relatives WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'not_found', message: 'الشخص غير موجود.' });
  const { name, relation, phone, avatar, notes, contactEveryDays } = req.body || {};
  db.prepare(
    `UPDATE relatives SET name = ?, relation = ?, phone = ?, avatar = ?, notes = ?, contact_every_days = ? WHERE id = ?`
  ).run(
    name?.trim() || r.name,
    relation?.trim() || r.relation,
    phone === undefined ? r.phone : phone?.trim() || null,
    avatar === undefined ? r.avatar : avatar,
    notes === undefined ? r.notes : notes?.trim() || null,
    contactEveryDays === undefined ? r.contact_every_days : Math.max(1, Math.min(365, Number(contactEveryDays) || 7)),
    r.id
  );
  res.json({ relative: withMeta(db.prepare('SELECT * FROM relatives WHERE id = ?').get(r.id)) });
});

relativesRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM relatives WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/** تسجيل تواصل مع القريب — يحدّث "آخر تواصل" ويضيف إلى السجل */
relativesRouter.post('/:id/log', (req, res) => {
  const r = db.prepare('SELECT * FROM relatives WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'not_found', message: 'الشخص غير موجود.' });
  const { method, note } = req.body || {};
  const m = ['call', 'message', 'whatsapp', 'visit', 'other'].includes(method) ? method : 'call';
  const now = nowIso();
  db.prepare(
    `INSERT INTO contact_logs (id, user_id, relative_id, person_name, method, note, happened_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(uid(), req.user.id, r.id, r.name, m, note?.trim() || null, now);
  db.prepare('UPDATE relatives SET last_contact_at = ? WHERE id = ?').run(now, r.id);
  res.status(201).json({ relative: withMeta(db.prepare('SELECT * FROM relatives WHERE id = ?').get(r.id)) });
});
