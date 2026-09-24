-- ══════════════════════════════════════════════════════════════════════
-- وصال — 0004: الأشخاص والجداول والمواعيد الأسبوعية
--
-- كيان مركزي واحد `persons` مرتبط اختياريًا بحساب مستخدم (لتفادي التكرار
-- بين "قريب" و"عضو عائلة").
--
-- لكل شخص منطقة زمنية خاصة به، والمواعيد تُخزَّن بلحظة UTC + تاريخ/وقت محلي
-- حتى تُعالَج المناطق الزمنية والسفر بشكل صحيح.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE persons (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id              uuid        REFERENCES families(id) ON DELETE SET NULL,
  display_name           text        NOT NULL,
  relationship           text        NOT NULL CHECK (relationship IN (
                           'father','mother','grandfather','grandmother','brother','sister',
                           'uncle_paternal','aunt_paternal','uncle_maternal','aunt_maternal',
                           'cousin_paternal','cousin_maternal','son','daughter','spouse',
                           'friend','neighbor','other')),
  -- الهاتف اختياري ومشفر (لا نطلبه لإضافة شخص: الهدف أقل من دقيقة)
  phone_hash             text,
  phone_encrypted        text,
  photo_url              text,
  notes                  text,
  timezone               text        NOT NULL,
  senior_mode            boolean     NOT NULL DEFAULT false,
  is_app_user            boolean     NOT NULL DEFAULT false,
  linked_user_id         uuid        REFERENCES users(id) ON DELETE SET NULL,
  grace_period_minutes   integer     NOT NULL DEFAULT 90
                         CHECK (grace_period_minutes BETWEEN 0 AND 10080),
  quiet_hours_start      time,
  quiet_hours_end        time,
  paused_until           timestamptz,
  pause_reason           text        CHECK (pause_reason IS NULL OR pause_reason IN (
                           'travel','manual','family_pause','notification_pause','escalation_pause')),
  pause_note             text,
  -- ⚫ إدخال يدوي من شخص مخوّل فقط — تتوقف بعده كل التذكيرات
  deceased_reported_at   timestamptz,
  deceased_reported_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  consent_status         text        NOT NULL DEFAULT 'not_required'
                         CHECK (consent_status IN ('pending','granted','revoked','not_required')),
  last_check_in_at       timestamptz,
  last_check_in_method   text        CHECK (last_check_in_method IS NULL OR last_check_in_method IN (
                           'call','message','visit','in_person','web_link','sms_reply',
                           'senior_button','trusted_contact','manual')),
  last_contact_at        timestamptz,
  cached_status          text        NOT NULL DEFAULT 'upcoming' CHECK (cached_status IN (
                           'checked','upcoming','due','unverified','needs_followup',
                           'deceased_reported','paused')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  CONSTRAINT persons_display_name_length CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT persons_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT persons_quiet_hours_pair CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)),
  -- لا يُربط شخص بحساب مستخدم إلا إذا كان يستخدم التطبيق
  CONSTRAINT persons_linked_user_requires_app_user CHECK (linked_user_id IS NULL OR is_app_user = true),
  -- الإبلاغ عن الوفاة يحتاج مُبلِّغًا معروفًا (سجل تدقيق واضح)
  CONSTRAINT persons_deceased_requires_reporter
    CHECK (deceased_reported_at IS NULL OR deceased_reported_by IS NOT NULL)
);
SELECT wesal_add_updated_at_trigger('persons');
CREATE INDEX persons_owner_active_idx ON persons (owner_user_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX persons_owner_linked_user_uniq ON persons (owner_user_id, linked_user_id)
  WHERE linked_user_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX persons_owner_phone_uniq ON persons (owner_user_id, phone_hash)
  WHERE phone_hash IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX persons_family_idx ON persons (family_id) WHERE family_id IS NOT NULL;

-- ─────────────────────────── الجداول ───────────────────────────
CREATE TABLE schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind             text        NOT NULL CHECK (kind IN ('daily','several_days','weekly','custom')),
  -- 1 = الاثنين … 7 = الأحد (ترقيم ISO 8601)
  weekdays         smallint[]  NOT NULL,
  times            time[]      NOT NULL,
  timezone         text        NOT NULL,
  active           boolean     NOT NULL DEFAULT true,
  -- جدول مؤقت أثناء السفر ✈️ يُستخدم بدل الأساسي خلال نافذته
  is_temporary     boolean     NOT NULL DEFAULT false,
  effective_from   date        NOT NULL,
  effective_to     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- أيام صحيحة (1..7) وعدد محدود — بدون استعلامات فرعية (غير مسموح في CHECK)
  CONSTRAINT schedules_weekdays_range CHECK (
    array_length(weekdays, 1) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
  ),
  CONSTRAINT schedules_times_range CHECK (array_length(times, 1) BETWEEN 1 AND 4),
  CONSTRAINT schedules_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
SELECT wesal_add_updated_at_trigger('schedules');
-- جدول أساسي نشط واحد فقط لكل شخص
CREATE UNIQUE INDEX schedules_one_active_per_person ON schedules (person_id)
  WHERE active AND NOT is_temporary;
-- وجدول مؤقت نشط واحد فقط في الوقت نفسه
CREATE UNIQUE INDEX schedules_one_temporary_per_person ON schedules (person_id)
  WHERE active AND is_temporary;

-- ─────────────────────── استثناءات يوم واحد ───────────────────────
-- "هذا الأسبوع فقط اجعل موعد جدتي 6 م بدل 8 م" ثم يعود الجدول الأساسي تلقائيًا
CREATE TABLE schedule_exceptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  date         date        NOT NULL,
  action       text        NOT NULL CHECK (action IN ('move','skip','add')),
  times        time[]      NOT NULL DEFAULT '{}',
  note         text,
  created_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exceptions_move_add_need_times CHECK (action = 'skip' OR array_length(times, 1) >= 1),
  CONSTRAINT exceptions_times_max CHECK (array_length(times, 1) <= 4)
);
CREATE UNIQUE INDEX schedule_exceptions_uniq ON schedule_exceptions (person_id, date, action);
CREATE INDEX schedule_exceptions_person_date_idx ON schedule_exceptions (person_id, date);

-- ─────────────────────── المواعيد الأسبوعية ───────────────────────
CREATE TABLE schedule_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id          uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  scheduled_for      timestamptz NOT NULL,
  local_date         date        NOT NULL,
  local_time         time        NOT NULL,
  timezone           text        NOT NULL,
  status             text        NOT NULL DEFAULT 'upcoming' CHECK (status IN (
                       'upcoming','due','checked','unverified','snoozed','cancelled','skipped')),
  source             text        NOT NULL DEFAULT 'schedule'
                     CHECK (source IN ('schedule','exception','manual')),
  exception_id       uuid        REFERENCES schedule_exceptions(id) ON DELETE SET NULL,
  grace_until        timestamptz,
  snoozed_until      timestamptz,
  completed_at       timestamptz,
  completed_by       uuid        REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at       timestamptz,
  last_evaluated_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- موعد واحد فقط للشخص في نفس اللحظة
  CONSTRAINT entries_unique_instant UNIQUE (person_id, scheduled_for),
  CONSTRAINT entries_completed_consistency CHECK (completed_at IS NULL OR status = 'checked'),
  CONSTRAINT entries_cancelled_consistency CHECK (cancelled_at IS NULL OR status IN ('cancelled','skipped')),
  CONSTRAINT entries_exception_source CHECK (source <> 'exception' OR exception_id IS NOT NULL)
);
SELECT wesal_add_updated_at_trigger('schedule_entries');
CREATE INDEX entries_person_local_date_idx ON schedule_entries (person_id, local_date);
CREATE INDEX entries_person_instant_idx ON schedule_entries (person_id, scheduled_for);
-- فهرس المواعيد المفتوحة — يُستخدم في دورة العامل (تقييم الحالات والتذكيرات)
CREATE INDEX entries_open_idx ON schedule_entries (scheduled_for)
  WHERE status IN ('upcoming','due','snoozed','unverified');
CREATE INDEX entries_status_scan_idx ON schedule_entries (status, scheduled_for);
