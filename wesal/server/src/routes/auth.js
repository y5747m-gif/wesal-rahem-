import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, uid, linkCode } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  avatar: u.avatar,
  role: u.role,
  linkCode: u.link_code,
  status: u.status,
  lastCheckinAt: u.last_checkin_at,
});

authRouter.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'validation', message: 'الاسم والبريد وكلمة المرور مطلوبة.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'validation', message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (exists) return res.status(409).json({ error: 'conflict', message: 'هذا البريد مسجل من قبل.' });

  const id = uid();
  const hash = await bcrypt.hash(password, 12);
  db.prepare(
    `INSERT INTO users (id, name, email, phone, password_hash, link_code) VALUES (?,?,?,?,?,?)`
  ).run(id, name.trim(), email.toLowerCase().trim(), phone?.trim() || null, hash, linkCode());
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(id);
  db.prepare('INSERT INTO checkin_schedules (user_id) VALUES (?)').run(id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db
    .prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL')
    .get((email || '').toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'البريد أو كلمة المرور غير صحيحة.' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id);
  const schedule = db.prepare('SELECT * FROM checkin_schedules WHERE user_id = ?').get(req.user.id);
  res.json({ user: publicUser(req.user), settings, schedule });
});

authRouter.patch('/me', requireAuth, (req, res) => {
  const { name, phone, avatar } = req.body || {};
  db.prepare('UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), avatar = COALESCE(?, avatar) WHERE id = ?')
    .run(name?.trim() || null, phone === undefined ? null : phone, avatar === undefined ? null : avatar, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await bcrypt.compare(current || '', req.user.password_hash))) {
    return res.status(400).json({ error: 'validation', message: 'كلمة المرور الحالية غير صحيحة.' });
  }
  if (!next || next.length < 8) {
    return res.status(400).json({ error: 'validation', message: 'كلمة المرور الجديدة قصيرة جدًا.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(await bcrypt.hash(next, 12), req.user.id);
  res.json({ ok: true });
});

authRouter.delete('/me', requireAuth, (req, res) => {
  // حذف فعلي لبيانات المستخدم (حق النسيان)
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});
