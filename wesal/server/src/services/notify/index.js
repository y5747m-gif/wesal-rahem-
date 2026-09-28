// نظام إشعارات معياري (Modular): يمكن استبدال المزوّد الخارجي دون تغيير بقية الكود.
import { db, uid } from '../../db/index.js';
import { config } from '../../config.js';
import { logProvider } from './providers/log.js';
import { webhookProvider } from './providers/webhook.js';

const providers = { log: logProvider, webhook: webhookProvider };

/** إشعار داخل التطبيق (يظهر في جرس الإشعارات) */
export function pushInApp(userId, { kind = 'info', title, body = '', action = null }) {
  const on = db.prepare('SELECT notifications_on FROM settings WHERE user_id = ?').get(userId);
  if (on && !on.notifications_on && kind !== 'escalation') return null;
  const id = uid();
  db.prepare(
    `INSERT INTO notifications (id, user_id, kind, title, body, action) VALUES (?,?,?,?,?,?)`
  ).run(id, userId, kind, title, body, action);
  return id;
}

/** إرسال رسالة خارجية لجهة اتصال موثوقة (SMS / WhatsApp / مكالمة آلية حسب المزوّد) */
export async function sendExternal({ to, channel, message }) {
  const provider = providers[config.smsProvider] || providers.log;
  try {
    await provider.send({ to, channel, message });
    return true;
  } catch (err) {
    console.error('فشل إرسال الرسالة الخارجية:', err.message);
    return false;
  }
}
