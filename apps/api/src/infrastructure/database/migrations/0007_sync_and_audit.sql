-- ══════════════════════════════════════════════════════════════════════
-- وصال — 0007: المزامنة دون اتصال وسجل التدقيق
-- ══════════════════════════════════════════════════════════════════════

-- عمليات المزامنة: كل عملية تحمل مفتاح عدم تكرار، وتُحفظ النتيجة للمساءلة
CREATE TABLE sync_operations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key     text        NOT NULL,
  op_type             text        NOT NULL CHECK (op_type IN (
                        'record_check_in','record_attempt','snooze','create_person','update_person','add_exception')),
  payload             jsonb       NOT NULL,
  client_occurred_at  timestamptz NOT NULL,
  status              text        NOT NULL DEFAULT 'applied'
                      CHECK (status IN ('applied','duplicated','rejected','conflicted')),
  entity_id           uuid,
  error_code          text,
  message             text,
  result              jsonb,
  applied_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- المفتاح فريد لكل مستخدم: إعادة الإرسال لا تُنشئ سجلًا مكررًا
  CONSTRAINT sync_operations_user_key_uniq UNIQUE (user_id, idempotency_key),
  CONSTRAINT sync_operations_applied_consistency CHECK (
    status <> 'applied' OR applied_at IS NOT NULL
  ),
  CONSTRAINT sync_operations_rejected_has_reason CHECK (
    status <> 'rejected' OR error_code IS NOT NULL
  )
);
CREATE INDEX sync_operations_user_time_idx ON sync_operations (user_id, client_occurred_at DESC);

-- سجل تدقيق لكل عملية حساسة (الموافقات، الدعوات، الإبلاغ، التغييرات على الجدول)
CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  actor_kind     text        NOT NULL DEFAULT 'user'
                 CHECK (actor_kind IN ('user','trusted_contact','system','worker')),
  action         text        NOT NULL CHECK (char_length(action) BETWEEN 3 AND 80),
  entity_type    text        NOT NULL CHECK (char_length(entity_type) BETWEEN 2 AND 60),
  entity_id      text,
  person_id      uuid        REFERENCES persons(id) ON DELETE SET NULL,
  family_id      uuid        REFERENCES families(id) ON DELETE SET NULL,
  metadata       jsonb,
  ip             text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_person_time_idx ON audit_logs (person_id, created_at DESC) WHERE person_id IS NOT NULL;
CREATE INDEX audit_logs_actor_time_idx ON audit_logs (actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

-- فهرس يدعم عرض "سجل الوصال" (اليوم · الوقت · الشخص · الطريقة · الحالة)
CREATE INDEX check_ins_log_view_idx ON check_ins (person_id, occurred_at DESC) INCLUDE (method, status);
