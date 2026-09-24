-- ══════════════════════════════════════════════════════════════════════
-- وصال — 0006: قواعد التصعيد وسجلاته والإشعارات وطابور المهام
--
-- ⚠️ مؤقتات التصعيد تُدار في الخادم (وليس على هاتف المستخدم) لأن الهاتف قد يكون
--    مغلقًا أو بلا شبكة. جدول scheduled_jobs هو طابور المهام المؤجلة.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE escalation_rules (
  person_id                            uuid PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
  enabled                              boolean NOT NULL DEFAULT true,
  -- في المرحلة الأولى (MVP) يبقى false: لا تصعيد تلقائي لطرف ثالث
  auto_escalation_enabled              boolean NOT NULL DEFAULT false,
  reminder_delay_minutes               integer NOT NULL DEFAULT 0   CHECK (reminder_delay_minutes BETWEEN 0 AND 1440),
  second_reminder_delay_minutes        integer NOT NULL DEFAULT 60  CHECK (second_reminder_delay_minutes BETWEEN 5 AND 4320),
  trusted_contact_delay_minutes        integer NOT NULL DEFAULT 180 CHECK (trusted_contact_delay_minutes BETWEEN 15 AND 10080),
  next_contact_delay_minutes           integer NOT NULL DEFAULT 240 CHECK (next_contact_delay_minutes BETWEEN 15 AND 10080),
  max_contacts                         integer NOT NULL DEFAULT 2   CHECK (max_contacts BETWEEN 0 AND 2),
  grace_period_minutes                 integer NOT NULL DEFAULT 90  CHECK (grace_period_minutes BETWEEN 0 AND 10080),
  quiet_hours_start                    time    NOT NULL DEFAULT '22:00',
  quiet_hours_end                      time    NOT NULL DEFAULT '08:00',
  quiet_hours_timezone                 text    NOT NULL DEFAULT 'Africa/Cairo',
  emergency_guidance                   boolean NOT NULL DEFAULT true,
  -- الموافقة الصريحة القابلة للإلغاء في أي وقت (شرط أساسي قبل أي تنبيه لطرف ثالث)
  auto_escalation_consent_granted_at   timestamptz,
  auto_escalation_consent_revoked_at   timestamptz,
  consent_version                      text,
  created_at                           timestamptz NOT NULL DEFAULT now(),
  updated_at                           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rules_second_after_first CHECK (second_reminder_delay_minutes >= reminder_delay_minutes),
  -- لا تصعيد تلقائي بلا موافقة سارية
  CONSTRAINT rules_auto_requires_consent CHECK (
    auto_escalation_enabled = false
    OR (auto_escalation_consent_granted_at IS NOT NULL AND auto_escalation_consent_revoked_at IS NULL)
  ),
  CONSTRAINT rules_consent_revoked_after_grant CHECK (
    auto_escalation_consent_revoked_at IS NULL
    OR (auto_escalation_consent_granted_at IS NOT NULL
        AND auto_escalation_consent_revoked_at >= auto_escalation_consent_granted_at)
  ),
  -- لا معنى لجهات اتصال أكثر من الحد الأقصى
  CONSTRAINT rules_max_contacts_consistency CHECK (
    auto_escalation_enabled = false OR max_contacts >= 0
  )
);
SELECT wesal_add_updated_at_trigger('escalation_rules');

CREATE TABLE escalations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  entry_id      uuid        NOT NULL REFERENCES schedule_entries(id) ON DELETE CASCADE,
  stage         smallint    NOT NULL CHECK (stage BETWEEN 1 AND 4),
  action        text        NOT NULL CHECK (action IN (
                  'remind_user','alert_trusted_contact','show_emergency_guidance','none')),
  reason        text        NOT NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  status        text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','resolved','cancelled','deferred')),
  defer_until   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- مرحلة واحدة لا تُنفَّذ مرتين على نفس الموعد (منع التكرار — Idempotency)
  CONSTRAINT escalations_stage_once_per_entry UNIQUE (entry_id, stage)
);
CREATE INDEX escalations_person_time_idx ON escalations (person_id, triggered_at DESC);
CREATE INDEX escalations_active_idx ON escalations (status, triggered_at) WHERE status = 'active';
CREATE INDEX escalations_third_party_day_idx ON escalations (person_id, triggered_at)
  WHERE action = 'alert_trusted_contact';

CREATE TABLE notifications (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid        REFERENCES users(id) ON DELETE CASCADE,
  device_id                   uuid        REFERENCES devices(id) ON DELETE SET NULL,
  person_id                   uuid        REFERENCES persons(id) ON DELETE CASCADE,
  entry_id                    uuid        REFERENCES schedule_entries(id) ON DELETE SET NULL,
  invitation_id               uuid        REFERENCES contact_invitations(id) ON DELETE SET NULL,
  channel                     text        NOT NULL CHECK (channel IN ('push','sms','in_app','email','whatsapp')),
  audience                    text        NOT NULL CHECK (audience IN ('owner','family_member','trusted_contact','tracked_person')),
  template_key                text        NOT NULL,
  locale                      text        NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  title                       text        NOT NULL,
  body                        text        NOT NULL,
  actions                     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  data                        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  stage                       smallint    CHECK (stage IS NULL OR stage BETWEEN 1 AND 4),
  status                      text        NOT NULL DEFAULT 'queued' CHECK (status IN (
                                'queued','sent','delivered','failed','cancelled',
                                'suppressed_quiet_hours','suppressed_no_consent')),
  scheduled_for               timestamptz NOT NULL DEFAULT now(),
  sent_at                     timestamptz,
  delivered_at                timestamptz,
  failed_at                   timestamptz,
  attempts                    integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 10),
  last_error                  text,
  idempotency_key             text        NOT NULL UNIQUE,
  read_at                     timestamptz,
  -- عنوان المستلم (رقم/بريد) مشفّر ولا يُفكّ إلا لحظة الإرسال
  recipient_address_encrypted text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  -- لا تنبيه لطرف ثالث بلا شخص مرتبط وسياق واضح
  CONSTRAINT notifications_third_party_needs_person CHECK (
    audience <> 'trusted_contact' OR person_id IS NOT NULL
  ),
  CONSTRAINT notifications_sent_consistency CHECK (sent_at IS NULL OR status <> 'queued'),
  CONSTRAINT notifications_read_implies_sent CHECK (read_at IS NULL OR sent_at IS NOT NULL OR channel = 'in_app')
);
CREATE INDEX notifications_user_inbox_idx ON notifications (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX notifications_pending_idx ON notifications (scheduled_for) WHERE status = 'queued';
CREATE INDEX notifications_person_day_idx ON notifications (person_id, audience, created_at);

-- ─────────────────────── طابور المهام المؤجلة ───────────────────────
CREATE TABLE scheduled_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text        NOT NULL CHECK (kind IN (
                     'reminder','retry','escalation','entry_generation','invite_expiry','report')),
  run_at           timestamptz NOT NULL,
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status           text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','done','failed','cancelled')),
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at        timestamptz,
  locked_by        text,
  last_error       text,
  idempotency_key  text        NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE INDEX scheduled_jobs_due_idx ON scheduled_jobs (run_at) WHERE status = 'pending';
CREATE INDEX scheduled_jobs_stale_locks_idx ON scheduled_jobs (locked_at) WHERE status = 'running';
CREATE INDEX scheduled_jobs_kind_payload_idx ON scheduled_jobs USING gin (payload jsonb_path_ops);
