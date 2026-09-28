import { Router } from 'express';
import { db, uid } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { pushInApp } from '../services/notify/index.js';

export const familyRouter = Router();
familyRouter.use(requireAuth);

/**
 * لوحة حالة العائلة: تعرض فقط المستخدمين المرتبطين برضاهم،
 * والذين فعّلوا "مشاركة الحالة". لا حالة حمراء أبدًا:
 * ok = أكد أنه بخير · awaiting = بانتظار التأكيد · unshared = لا يشارك حالته
 */
familyRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT fl.id AS link_id, fl.relation, u.id AS uid, u.name, u.avatar, u.status,
              u.last_checkin_at, s.share_status
       FROM family_links fl
       JOIN users u ON u.id = fl.linked_user_id AND u.deleted_at IS NULL
       LEFT JOIN settings s ON s.user_id = u.id
       WHERE fl.user_id = ?
       ORDER BY fl.created_at ASC`
    )
    .all(req.user.id);
  const members = rows.map((r) => ({
    linkId: r.link_id,
    name: r.name,
    avatar: r.avatar,
    relation: r.relation,
    status: r.share_status ? r.status : 'unshared',
    lastCheckinAt: r.share_status ? r.last_checkin_at : null,
  }));
  res.json({ members, myLinkCode: req.user.link_code });
});

/** الربط برمز — يربط الطرفين معًا (علاقة متبادلة بموافقة صاحب الرمز الضمنية بمشاركته الرمز) */
familyRouter.post('/link', (req, res) => {
  const { code, relation } = req.body || {};
  const other = db
    .prepare('SELECT * FROM users WHERE link_code = ? AND deleted_at IS NULL')
    .get((code || '').toUpperCase().trim());
  if (!other) return res.status(404).json({ error: 'not_found', message: 'رمز الربط غير صحيح.' });
  if (other.id === req.user.id) {
    return res.status(400).json({ error: 'validation', message: 'لا يمكنك ربط حسابك بنفسه.' });
  }
  const exists = db
    .prepare('SELECT id FROM family_links WHERE user_id = ? AND linked_user_id = ?')
    .get(req.user.id, other.id);
  if (exists) return res.status(409).json({ error: 'conflict', message: 'هذا الشخص مرتبط بك بالفعل.' });

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO family_links (id, user_id, linked_user_id, relation) VALUES (?,?,?,?)')
      .run(uid(), req.user.id, other.id, relation?.trim() || null);
    db.prepare('INSERT OR IGNORE INTO family_links (id, user_id, linked_user_id, relation) VALUES (?,?,?,?)')
      .run(uid(), other.id, req.user.id, null);
  });
  tx();
  pushInApp(other.id, {
    kind: 'family',
    title: 'انضمام جديد إلى عائلتك',
    body: `${req.user.name} ارتبط بك في وصال. أصبح بإمكانكما الاطمئنان على بعضكما.`,
    action: '/family',
  });
  res.status(201).json({ ok: true });
});

/** فك الارتباط (من الطرفين) */
familyRouter.delete('/:linkId', (req, res) => {
  const link = db
    .prepare('SELECT * FROM family_links WHERE id = ? AND user_id = ?')
    .get(req.params.linkId, req.user.id);
  if (!link) return res.status(404).json({ error: 'not_found', message: 'الرابط غير موجود.' });
  db.prepare('DELETE FROM family_links WHERE id = ?').run(link.id);
  db.prepare('DELETE FROM family_links WHERE user_id = ? AND linked_user_id = ?')
    .run(link.linked_user_id, req.user.id);
  res.json({ ok: true });
});
