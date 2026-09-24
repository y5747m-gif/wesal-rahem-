-- ══════════════════════════════════════════════════════════════════════
-- وصال — 0005: الاطمئنان ومحاولات التواصل والجهات الموثوقة وروابط "أنا بخير"
--
-- قاعدتان حاكمتان:
--  1) لا يُخزَّن رقم الجهة الموثوقة كسجل دائم قبل قبولها الدعوة.
--  2) كل عملية تحمل idempotency_key حتى تكون إعادة الإرسال (والمزامنة دون اتصال) آمنة.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE check_ins (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id           uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  entry_id            uuid        REFERENCES schedule_entries(id) ON DELETE SET NULL,
  occurred_at         timestamptz NOT NULL,
  method              text        NOT NULL CHECK (method IN (
                        'call','message','visit','in_person','web_link','sms_reply',
                        'senior_button','trusted_contact','manual')),
  status              text        NOT NULL DEFAULT 'reassured'
                      CHECK (status IN ('reassured','called_no_answer','snoozed')),
  confirmed_by_kind   text        NOT NULL DEFAULT 'owner'
                      CHECK (confirmed_by_kind IN ('owner','family_member','trusted_contact','person_self','system')),
  confirmed_by_user_id uuid       REFERENCES users(id) ON DELETE SET NULL,
  notes               text,
  idempotency_key     text        NOT NULL UNIQUE,
  client_occurred_at  timestamptz,
  synced_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_ins_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500),
  -- الاطمئنان لا يكون في المستقبل (سماح 5 دقائق لفرق الساعات بين الأجهزة)
  CONSTRAINT check_ins_not_in_future CHECK (occurred_at <= now() + interval '5 minutes'),
  -- تأكيد الشخص لنفسه لا يُسند إلى مستخدم آخر (التحقق من الربط يتم في طبقة التطبيق
  -- لأن قيود CHECK في PostgreSQL لا تقبل الاستعلامات الفرعية)
  CONSTRAINT check_ins_self_has_no_external_confirmer CHECK (
    confirmed_by_kind <> 'person_self' OR confirmed_by_user_id IS NULL
  )
);
CREATE INDEX check_ins_person_time_idx ON check_ins (person_id, occurred_at DESC);
CREATE INDEX check_ins_entry_idx ON check_ins (entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX check_ins_created_idx ON check_ins (created_at DESC);

CREATE TABLE communication_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  entry_id         uuid        REFERENCES schedule_entries(id) ON DELETE SET NULL,
  attempted_at     timestamptz NOT NULL DEFAULT now(),
  kind             text        NOT NULL DEFAULT 'call' CHECK (kind IN ('call','message')),
  outcome          text        NOT NULL CHECK (outcome IN ('no_answer','answered','busy','unreachable','will_retry')),
  retry_after      timestamptz,
  idempotency_key  text        NOT NULL UNIQUE,
  created_by       uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempts_person_time_idx ON communication_attempts (person_id, attempted_at DESC);
CREATE INDEX attempts_pending_retry_idx ON communication_attempts (retry_after)
  WHERE retry_after IS NOT NULL AND outcome <> 'answered';

-- ────────────────────────── الجهات الموثوقة ──────────────────────────
-- الدعوة أولًا: الرقم مشفّر هنا ولا يصبح جهة موثوقة دائمة إلا بعد القبول.
CREATE TABLE contact_invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  invited_by_user_id uuid       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name         text        NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 80),
  phone_encrypted   text        NOT NULL,
  phone_hash        text        NOT NULL,
  relationship      text        CHECK (relationship IS NULL OR relationship IN (
                      'father','mother','grandfather','grandmother','brother','sister',
                      'uncle_paternal','aunt_paternal','uncle_maternal','aunt_maternal',
                      'cousin_paternal','cousin_maternal','son','daughter','spouse',
                      'friend','neighbor','other')),
  token_hash        text        NOT NULL UNIQUE,
  status            text        NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited','accepted','declined','revoked','expired')),
  scopes            text[]      NOT NULL DEFAULT '{receive_alerts,confirm_check_in,see_basic_profile}',
  personal_note     text,
  invited_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  responded_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_expiry_after_invite CHECK (expires_at > invited_at),
  CONSTRAINT invitations_response_consistency CHECK (
    (status IN ('accepted','declined')) = (responded_at IS NOT NULL)
  ),
  CONSTRAINT invitations_note_length CHECK (personal_note IS NULL OR char_length(personal_note) <= 300)
);
CREATE INDEX invitations_person_idx ON contact_invitations (person_id, status);
-- دعوة سارية واحدة فقط لنفس الرقم على نفس الشخص (منع الإزعاج والتكرار)
CREATE UNIQUE INDEX invitations_active_phone_uniq ON contact_invitations (person_id, phone_hash)
  WHERE status = 'invited';
CREATE INDEX invitations_expiring_idx ON contact_invitations (expires_at) WHERE status = 'invited';

CREATE TABLE trusted_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  invitation_id  uuid        REFERENCES contact_invitations(id) ON DELETE SET NULL,
  user_id        uuid        REFERENCES users(id) ON DELETE SET NULL,
  full_name      text        NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 80),
  -- بعد القبول فقط يُخزَّن الرقم (مشفّرًا + بصمة)
  phone_encrypted text       NOT NULL,
  phone_hash     text        NOT NULL,
  relationship   text,
  scopes         text[]      NOT NULL DEFAULT '{receive_alerts,confirm_check_in,see_basic_profile}',
  status         text        NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','withdrawn','revoked')),
  accepted_at    timestamptz NOT NULL,
  withdrawn_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trusted_contacts_withdrawn_consistency CHECK (
    (status <> 'accepted') = (withdrawn_at IS NOT NULL)
  )
);
-- جهة موثوقة مقبولة واحدة فقط لكل رقم على نفس الشخص
CREATE UNIQUE INDEX trusted_contacts_person_phone_uniq ON trusted_contacts (person_id, phone_hash)
  WHERE status = 'accepted';
CREATE INDEX trusted_contacts_person_idx ON trusted_contacts (person_id) WHERE status = 'accepted';

-- ─────────────────── روابط "أنا بخير" بدون تطبيق ───────────────────
-- الرابط فريد وينتهي بعد وقت قصير ولا يكشف بيانات.
CREATE TABLE web_check_in_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid        NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  entry_id      uuid        REFERENCES schedule_entries(id) ON DELETE SET NULL,
  token_hash    text        NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_links_single_use CHECK (used_at IS NULL OR used_at <= expires_at)
);
CREATE INDEX web_links_person_idx ON web_check_in_links (person_id, expires_at DESC);
