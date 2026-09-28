import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { config } from '../config.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpires,
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized', message: 'الرجاء تسجيل الدخول.' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db
      .prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL')
      .get(payload.sub);
    if (!user) return res.status(401).json({ error: 'unauthorized', message: 'الحساب غير موجود.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized', message: 'انتهت الجلسة، سجّل الدخول من جديد.' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'هذه الصفحة مخصصة للإدارة فقط.' });
  }
  next();
}
