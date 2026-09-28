// محرّك الجدولة: يعمل في الخلفية حتى لو أغلق المستخدم التطبيق.
// كل دورة: 1) توليد مواعيد الاطمئنان المستحقة  2) تنفيذ مراحل التصعيد
//          3) إطلاق التذكيرات المستحقة          4) تنبيهات صلة الرحم اللطيفة
import { db, uid, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { pushInApp, sendExternal } from './notify/index.js';

const FREQ_DAYS = { daily: 1, every2: 2, every3: 3, weekly: 7 };

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

/** يحسب الموعد التالي المستحق (UTC) بناءً على وقت المستخدم المحلي */
export function computeNextDue(schedule, fromDate = new Date()) {
  const [h, m] = schedule.time_of_day.split(':').map(Number);
  // timezone_offset = getTimezoneOffset() من المتصفح (دقائق، UTC - local)
  const offset = schedule.timezone_offset || 0;
  const localNow = new Date(fromDate.getTime() - offset * 60000);
  const candidate = new Date(localNow);
  candidate.setUTCHours(h, m, 0, 0);
  if (candidate <= localNow) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return new Date(candidate.getTime() + offset * 60000).toISOString();
}

function intervalDays(schedule) {
  return schedule.frequency === 'custom'
    ? Math.max(1, schedule.custom_days)
    : FREQ_DAYS[schedule.frequency] || 1;
}

/** إنشاء موعد اطمئنان جديد عندما يحين وقته ولا يوجد موعد مفتوح */
function generateDueCheckins() {
  const schedules = db
    .prepare(
      `SELECT s.*, u.name AS user_name FROM checkin_schedules s
       JOIN users u ON u.id = s.user_id
       WHERE s.enabled = 1 AND u.deleted_at IS NULL`
    )
    .all();

  const now = new Date();
  for (const s of schedules) {
    const open = db
      .prepare(`SELECT id FROM checkins WHERE user_id = ? AND status = 'pending'`)
      .get(s.user_id);
    if (open) continue;

    const last = db
      .prepare(
        `SELECT due_at FROM checkins WHERE user_id = ? ORDER BY due_at DESC LIMIT 1`
      )
      .get(s.user_id);

    const nextDue = computeNextDue(s, now);
    const days = intervalDays(s);

    let dueAt = null;
    if (!last) {
      // أول موعد: إذا حان وقت اليوم فأنشئه الآن، وإلا انتظر
      const todayDue = new Date(new Date(nextDue).getTime() - 24 * 3600000);
      if (todayDue <= now && now - todayDue < 24 * 3600000) dueAt = todayDue.toISOString();
      else if (new Date(nextDue) <= now) dueAt = nextDue;
    } else {
      const gate = new Date(new Date(last.due_at).getTime() + (days - 0.5) * 24 * 3600000);
      const candidate = new Date(new Date(last.due_at).getTime() + days * 24 * 3600000);
      // ثبّت وقت اليوم المحلي المطلوب
      if (now >= candidate && now >= gate) dueAt = candidate.toISOString();
    }

    if (dueAt) {
      const id = uid();
      db.prepare(
        `INSERT INTO checkins (id, user_id, due_at, stage, next_action_at)
         VALUES (?,?,?,0,?)`
      ).run(id, s.user_id, dueAt, addMinutes(nowIso(), s.grace_minutes));
      pushInApp(s.user_id, {
        kind: 'checkin',
        title: 'حان وقت الاطمئنان عليك',
        body: 'اضغط "أنا بخير" ليطمئن قلب من يحبك.',
        action: '/',
      });
    }
  }
}

/** رسالة التصعيد الهادئة — بدون أي لغة تخويف */
export function escalationMessage(userName) {
  return `مرحبًا، لم يتمكن ${userName} من تأكيد أنه بخير في الموعد المعتاد. نرجو الاطمئنان عليه.`;
}

/** تنفيذ مراحل التصعيد للمواعيد المفتوحة */
async function runEscalations() {
  const due = db
    .prepare(
      `SELECT c.*, u.name AS user_name FROM checkins c
       JOIN users u ON u.id = c.user_id
       WHERE c.status = 'pending' AND c.next_action_at IS NOT NULL
         AND c.next_action_at <= ? AND u.deleted_at IS NULL`
    )
    .all(nowIso());

  for (const c of due) {
    const s = db.prepare('SELECT * FROM checkin_schedules WHERE user_id = ?').get(c.user_id);
    if (!s) continue;
    const gap = Math.max(5, s.reminder_gap_minutes);
    const stage = c.stage + 1;

    if (stage === 1 || stage === 2) {
      // المرحلة 1 و2: تذكيرات لطيفة للمستخدم نفسه
      pushInApp(c.user_id, {
        kind: 'checkin',
        title: stage === 1 ? 'تذكير لطيف' : 'ما زلنا بانتظارك',
        body: 'لم تؤكد بعد أنك بخير. ضغطة واحدة تكفي.',
        action: '/',
      });
      db.prepare(`UPDATE checkins SET stage = ?, next_action_at = ? WHERE id = ?`)
        .run(stage, addMinutes(nowIso(), gap), c.id);
    } else if (stage === 3) {
      // المرحلة 3: تغيير الحالة إلى "بانتظار التأكيد" (بدون إبلاغ أي طرف خارجي)
      db.prepare(`UPDATE users SET status = 'awaiting' WHERE id = ?`).run(c.user_id);
      db.prepare(`UPDATE checkins SET stage = 3, next_action_at = ? WHERE id = ?`)
        .run(addMinutes(nowIso(), gap), c.id);
      pushInApp(c.user_id, {
        kind: 'checkin',
        title: 'حالتك الآن: بانتظار التأكيد',
        body: 'إن كان كل شيء على ما يرام، أكد بضغطة واحدة.',
        action: '/',
      });
    } else {
      // المرحلة 4 فما بعد: إبلاغ الجهات الموثوقة واحدة تلو الأخرى — فقط من سمح المستخدم بذلك
      const contacts = db
        .prepare(
          `SELECT * FROM trusted_contacts
           WHERE user_id = ? AND alerts_allowed = 1
           ORDER BY position ASC, created_at ASC`
        )
        .all(c.user_id);
      const contactIndex = stage - 4; // 0 = الجهة الأولى
      const contact = contacts[contactIndex];

      if (!contact) {
        // لا جهات متبقية: نُبقي الموعد مفتوحًا بلا مزيد من الإجراءات
        db.prepare(`UPDATE checkins SET stage = ?, next_action_at = NULL WHERE id = ?`)
          .run(stage, c.id);
        continue;
      }

      const message = escalationMessage(c.user_name);
      const delivered = await sendExternal({
        to: contact.phone,
        channel: contact.method,
        message,
      });
      db.prepare(
        `INSERT INTO escalation_alerts
           (id, checkin_id, user_id, contact_id, contact_name, channel, message, delivered)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(uid(), c.id, c.user_id, contact.id, contact.name, contact.method, message, delivered ? 1 : 0);

      pushInApp(c.user_id, {
        kind: 'escalation',
        title: `تم إبلاغ ${contact.name}`,
        body: 'أخبرناه فقط أنك لم تؤكد حالتك، دون أي افتراضات. أكد "أنا بخير" لإيقاف التصعيد.',
        action: '/',
      });

      const hasNext = contactIndex + 1 < contacts.length;
      db.prepare(`UPDATE checkins SET stage = ?, next_action_at = ? WHERE id = ?`)
        .run(stage, hasNext ? addMinutes(nowIso(), gap) : null, c.id);
    }
  }
}

/** التذكيرات المجدولة (اتصل بجدتي...) */
function fireReminders() {
  const due = db
    .prepare(
      `SELECT * FROM reminders WHERE done = 0 AND notified = 0 AND due_at <= ?`
    )
    .all(nowIso());
  for (const r of due) {
    pushInApp(r.user_id, {
      kind: 'reminder',
      title: r.title,
      body: r.person_name ? `حان وقت التواصل مع ${r.person_name}.` : 'حان وقت صلة الرحم.',
      action: '/reminders',
    });
    if (r.repeat === 'none') {
      db.prepare('UPDATE reminders SET notified = 1 WHERE id = ?').run(r.id);
    } else {
      const days = r.repeat === 'daily' ? 1 : r.repeat === 'weekly' ? 7 : 30;
      const next = new Date(new Date(r.due_at).getTime() + days * 24 * 3600000).toISOString();
      db.prepare('UPDATE reminders SET due_at = ? WHERE id = ?').run(next, r.id);
    }
  }
}

/** تنبيه لطيف عند طول الانقطاع عن قريب (مرة كل 24 ساعة كحد أقصى لكل قريب) */
function kinshipNudges() {
  const rows = db
    .prepare(
      `SELECT r.*, s.kinship_nudges_on FROM relatives r
       JOIN settings s ON s.user_id = r.user_id
       WHERE s.kinship_nudges_on = 1`
    )
    .all();
  const now = Date.now();
  for (const r of rows) {
    const lastMs = r.last_contact_at ? new Date(r.last_contact_at).getTime() : new Date(r.created_at + 'Z').getTime();
    const daysSince = (now - lastMs) / 86400000;
    if (daysSince < r.contact_every_days) continue;
    const recent = db
      .prepare(
        `SELECT id FROM notifications
         WHERE user_id = ? AND kind = 'kinship' AND body LIKE ?
           AND created_at > datetime('now', '-1 day')`
      )
      .get(r.user_id, `%${r.name}%`);
    if (recent) continue;
    pushInApp(r.user_id, {
      kind: 'kinship',
      title: 'حان وقت صلة الرحم',
      body: `لم تتواصل مع ${r.name} منذ ${Math.floor(daysSince)} ${Math.floor(daysSince) >= 3 && Math.floor(daysSince) <= 10 ? 'أيام' : 'يومًا'}، ربما حان وقت الاطمئنان عليه.`,
      action: `/kinship/${r.id}`,
    });
  }
}

let timer = null;
export function startScheduler() {
  const tick = async () => {
    try {
      generateDueCheckins();
      await runEscalations();
      fireReminders();
      kinshipNudges();
    } catch (err) {
      console.error('خطأ في محرك الجدولة:', err);
    }
  };
  tick();
  timer = setInterval(tick, config.schedulerIntervalMs);
  console.log(`⏰ محرك الجدولة يعمل (كل ${config.schedulerIntervalMs / 1000} ثانية)`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
}
