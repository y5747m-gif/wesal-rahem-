import { Router } from 'express';
import { db, uid } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

const list = (userId) =>
  db.prepare(`SELECT * FROM trusted_contacts WHERE user_id = ? ORDER BY position ASC, created_at ASC`).all(userId);

contactsRouter.get('/', (req, res) => res.json({ contacts: list(req.user.id) }));

contactsRouter.post('/', (req, res) => {
  const { name, phone, relation, method, alertsAllowed } = req.body || {};
  if (!name?.trim() || !phone?.trim() || !relation?.trim()) {
    return res.status(400).json({ error: 'validation', message: 'الاسم والهاتف وصلة القرابة مطلوبة.' });
  }
  const max = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM trusted_contacts WHERE user_id = ?')
    .get(req.user.id).p;
  db.prepare(
    `INSERT INTO trusted_contacts (id, user_id, name, phone, relation, position, method, alerts_allowed)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    uid(), req.user.id, name.trim(), phone.trim(), relation.trim(),
    max + 1,
    ['sms', 'call', 'whatsapp'].includes(method) ? method : 'sms',
    alertsAllowed === false ? 0 : 1
  );
  res.status(201).json({ contacts: list(req.user.id) });
});

contactsRouter.patch('/:id', (req, res) => {
  const c = db
    .prepare('SELECT * FROM trusted_contacts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'جهة الاتصال غير موجودة.' });
  const { name, phone, relation, method, alertsAllowed } = req.body || {};
  db.prepare(
    `UPDATE trusted_contacts SET name = ?, phone = ?, relation = ?, method = ?, alerts_allowed = ? WHERE id = ?`
  ).run(
    name?.trim() || c.name,
    phone?.trim() || c.phone,
    relation?.trim() || c.relation,
    ['sms', 'call', 'whatsapp'].includes(method) ? method : c.method,
    alertsAllowed === undefined ? c.alerts_allowed : alertsAllowed ? 1 : 0,
    c.id
  );
  res.json({ contacts: list(req.user.id) });
});

/** إعادة الترتيب: body = { order: [id1, id2, ...] } */
contactsRouter.put('/order', (req, res) => {
  const order = req.body?.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'validation', message: 'ترتيب غير صالح.' });
  const stmt = db.prepare('UPDATE trusted_contacts SET position = ? WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => {
    order.forEach((id, i) => stmt.run(i + 1, id, req.user.id));
  });
  tx();
  res.json({ contacts: list(req.user.id) });
});

contactsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM trusted_contacts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ contacts: list(req.user.id) });
});
