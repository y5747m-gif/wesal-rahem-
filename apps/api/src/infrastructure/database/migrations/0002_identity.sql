-- ══════════════════════════════════════════════════════════════════════
-- وصال — 0002: الهوية والجلسات والإعدادات الشخصية
-- المبدأ: أقل قدر من البيانات + تشفير الحقول الحساسة في التخزين.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- لا نخزّن رقم الهاتف نصًا صريحًا: بصمة للبحث + قيمة مشفّرة
  phone_hash            text        NOT NULL UNIQUE,
  phone_encrypted       text        NOT NULL,
  phone_verified_at     timestamptz,
  display_name          text,
  email                 text,
  locale                text        NOT NULL DEFAULT 'ar'
                        CHECK (locale IN ('ar','en')),
  timezone              text        NOT NULL DEFAULT 'Africa/Cairo',
  theme                 text        NOT NULL DEFAULT 'system'
                        CHECK (theme IN ('light','dark','system')),
  font_scale            text        NOT NULL DEFAULT 'default'
                        CHECK (font_scale IN ('small','default','large','extra_large','senior')),
  reduced_motion        boolean     NOT NULL DEFAULT false,
  senior_mode           boolean     NOT NULL DEFAULT false,
  haptics_enabled       boolean     NOT NULL DEFAULT true,
  onboarding_completed  boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT users_display_name_length
    CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT users_email_format
    CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  CONSTRAINT users_email_lowercase CHECK (email IS NULL OR email = lower(email))
);
SELECT wesal_add_updated_at_trigger('users');
CREATE INDEX users_active_idx ON users (id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_email_uniq ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE devices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform              text        NOT NULL CHECK (platform IN ('ios','android','web')),
  push_token_hash       text        UNIQUE,
  push_token_encrypted  text,
  locale                text        NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  timezone              text        NOT NULL DEFAULT 'Africa/Cairo',
  app_version           text,
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON devices (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_otps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash    text        NOT NULL,
  code_hash     text        NOT NULL,
  purpose       text        NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','recovery')),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  attempts      integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_otps_lookup_idx ON auth_otps (phone_hash, created_at DESC);
CREATE INDEX auth_otps_cleanup_idx ON auth_otps (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE auth_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash  text        NOT NULL UNIQUE,
  device_id           uuid        REFERENCES devices(id) ON DELETE SET NULL,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_revoked_consistency CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE privacy_settings (
  user_id                        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  share_check_in_with_family     boolean NOT NULL DEFAULT true,
  allow_trusted_contact_alerts   boolean NOT NULL DEFAULT false,  -- الافتراضي: لا تصعيد بلا موافقة
  ai_enabled                     boolean NOT NULL DEFAULT false,  -- الوضوح قبل كل شيء
  location_sharing_enabled       boolean NOT NULL DEFAULT false,  -- لا تتبع موقع مستمر
  data_retention_days            integer NOT NULL DEFAULT 730 CHECK (data_retention_days BETWEEN 30 AND 3650),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);
SELECT wesal_add_updated_at_trigger('privacy_settings');

CREATE TABLE consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text NOT NULL CHECK (subject_type IN ('user','person')),
  subject_id    uuid NOT NULL,
  scope         text NOT NULL
                CHECK (scope IN ('auto_escalation','data_sharing','ai_features','notifications','web_check_in')),
  granted       boolean NOT NULL,
  version       text NOT NULL DEFAULT '1.0',
  granted_at    timestamptz,
  revoked_at    timestamptz,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consents_granted_needs_timestamp CHECK (granted = false OR granted_at IS NOT NULL),
  CONSTRAINT consents_revoked_needs_grant CHECK (revoked_at IS NULL OR granted_at IS NOT NULL)
);
-- موافقة سارية واحدة فقط لكل (موضوع، نطاق)
CREATE UNIQUE INDEX consents_active_uniq ON consents (subject_type, subject_id, scope) WHERE revoked_at IS NULL;
CREATE INDEX consents_subject_idx ON consents (subject_type, subject_id);
