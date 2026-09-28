-- وصال — مخطط قاعدة البيانات
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  avatar        TEXT,                       -- data URL صغيرة أو فارغ
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  link_code     TEXT NOT NULL UNIQUE,       -- رمز ربط العائلة
  status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','awaiting')),
  last_checkin_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language           TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  theme              TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark','system')),
  notifications_on   INTEGER NOT NULL DEFAULT 1,
  kinship_nudges_on  INTEGER NOT NULL DEFAULT 1,  -- تذكيرات صلة الرحم
  share_status       INTEGER NOT NULL DEFAULT 1,  -- مشاركة الحالة مع العائلة المرتبطة
  onboarded          INTEGER NOT NULL DEFAULT 0
);

-- جدول الاطمئنان الدوري (جدول واحد لكل مستخدم)
CREATE TABLE IF NOT EXISTS checkin_schedules (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled          INTEGER NOT NULL DEFAULT 0,
  frequency        TEXT NOT NULL DEFAULT 'daily'
                   CHECK (frequency IN ('daily','every2','every3','weekly','custom')),
  custom_days      INTEGER NOT NULL DEFAULT 1,       -- عند frequency='custom'
  time_of_day      TEXT NOT NULL DEFAULT '20:00',    -- HH:MM بتوقيت المستخدم
  timezone_offset  INTEGER NOT NULL DEFAULT 0,       -- دقائق عن UTC (من المتصفح)
  grace_minutes    INTEGER NOT NULL DEFAULT 60,      -- قبل أول تذكير إضافي
  reminder_gap_minutes INTEGER NOT NULL DEFAULT 30,  -- بين مراحل التصعيد
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- كل موعد اطمئنان فعلي (occurrence)
CREATE TABLE IF NOT EXISTS checkins (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_at      TEXT NOT NULL,               -- ISO UTC
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','confirmed','missed_closed')),
  -- مراحل التصعيد: 0 إشعار أولي، 1 تذكير، 2 تذكير إضافي، 3 بانتظار التأكيد،
  -- 4 إبلاغ الجهة الأولى، 5+ الجهات التالية
  stage       INTEGER NOT NULL DEFAULT 0,
  next_action_at TEXT,                     -- متى تُنفَّذ المرحلة التالية
  snoozed_until  TEXT,
  confirmed_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checkins_open ON checkins(user_id, status);
CREATE INDEX IF NOT EXISTS idx_checkins_next ON checkins(status, next_action_at);

-- جهات الاتصال الموثوقة
CREATE TABLE IF NOT EXISTS trusted_contacts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  relation      TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 1,     -- ترتيب التواصل
  method        TEXT NOT NULL DEFAULT 'sms' CHECK (method IN ('sms','call','whatsapp')),
  alerts_allowed INTEGER NOT NULL DEFAULT 1,    -- هل يُسمح بإرسال التنبيه إليه
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tc_user ON trusted_contacts(user_id, position);

-- صلة الرحم: الأقارب والأشخاص المهمون
CREATE TABLE IF NOT EXISTS relatives (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  relation         TEXT NOT NULL,
  phone            TEXT,
  avatar           TEXT,
  notes            TEXT,
  contact_every_days INTEGER NOT NULL DEFAULT 7, -- الإيقاع المطلوب للتواصل
  last_contact_at  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rel_user ON relatives(user_id);

-- سجل التواصل (Timeline)
CREATE TABLE IF NOT EXISTS contact_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relative_id TEXT REFERENCES relatives(id) ON DELETE SET NULL,
  person_name TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT 'call' CHECK (method IN ('call','message','whatsapp','visit','other')),
  note        TEXT,
  happened_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON contact_logs(user_id, happened_at);

-- التذكيرات
CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  person_name TEXT,
  relative_id TEXT REFERENCES relatives(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'kinship'
              CHECK (kind IN ('kinship','call','visit','occasion','other')),
  due_at      TEXT NOT NULL,               -- ISO UTC
  repeat      TEXT NOT NULL DEFAULT 'none'
              CHECK (repeat IN ('none','daily','weekly','monthly')),
  done        INTEGER NOT NULL DEFAULT 0,
  notified    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rem_user ON reminders(user_id, due_at);

-- الإشعارات داخل التطبيق
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'info'
              CHECK (kind IN ('info','checkin','reminder','kinship','escalation','family')),
  title       TEXT NOT NULL,
  body        TEXT,
  action      TEXT,                        -- مسار داخل التطبيق
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at);

-- روابط العائلة بين مستخدمين حقيقيين (لوحة حالة العائلة)
CREATE TABLE IF NOT EXISTS family_links (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, linked_user_id)
);

-- تنبيهات التصعيد المُرسلة إلى الجهات الموثوقة (سجل + للإدارة)
CREATE TABLE IF NOT EXISTS escalation_alerts (
  id          TEXT PRIMARY KEY,
  checkin_id  TEXT NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id  TEXT REFERENCES trusted_contacts(id) ON DELETE SET NULL,
  contact_name TEXT NOT NULL,
  channel     TEXT NOT NULL,
  message     TEXT NOT NULL,
  delivered   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON escalation_alerts(user_id, created_at);
