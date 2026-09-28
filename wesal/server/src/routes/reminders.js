import { Router } from 'express';
import { db, uid } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

const list = (userId) =>
  db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY done ASC, due_at ASC LIMIT 100').all(userId);

remindersRouter.get('/', (req, res) => res.json({ reminders: list(req.user.id) }));

remindersRouter.post('/', (req, res) => {
  const { title, personName, relativeId, kind, dueAt, repeat } = req.body || {};
  if (!title?.trim() || !dueAt) {
    return res.status(400).json({ error: 'validation', message: 'العنوان والموعد مطلوبان.' });
  }
  db.prepare(
    `INSERT INTO reminders (id, user_id, title, person_name, relative_id, kind, due_at, repeat)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    uid(), req.user.id, title.trim(), personName?.trim() || null, relativeId || null,
    ['kinship', 'call', 'visit', 'occasion', 'other'].includes(kind) ? kind : 'kinship',
    new Date(dueAt).toISOString(),
    ['none', 'daily', 'weekly', 'monthly'].includes(repeat) ? repeat : 'none'
  );
  res.status(201).json({ reminders: list(req.user.id) });
});

remindersRouter.patch('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'not_found', message: 'التذكير غير موجود.' });
  const { title, personName, kind, dueAt, repeat, done } = req.body || {};
  db.prepare(
    `UPDATE reminders SET title = ?, person_name = ?, kind = ?, due_at = ?, repeat = ?, done = ?, notified = ? WHERE id = ?`
  ).run(
    title?.trim() || r.title,
    personName === undefined ? r.person_name : personName?.trim() || null,
    ['kinship', 'call', 'visit', 'occasion', 'other'].includes(kind) ? kind : r.kind,
    dueAt ? new Date(dueAt).toISOString() : r.due_at,
    ['none', 'daily', 'weekly', 'monthly'].includes(repeat) ? repeat : r.repeat,
    done === undefined ? r.done : done ? 1 : 0,
    dueAt ? 0 : r.notified,
    r.id
  );
  res.json({ reminders: list(req.user.id) });
});

remindersRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ reminders: list(req.user.id) });
});
