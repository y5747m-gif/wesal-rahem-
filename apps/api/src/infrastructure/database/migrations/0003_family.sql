-- ══════════════════════════════════════════════════════════════════════
-- وصال — 0003: العائلات والأدوار (البنية جاهزة، والاستخدام الكامل في المرحلة 2)
-- الأدوار: owner · admin · member · trusted_contact
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE families (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  owner_user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timezone       text        NOT NULL DEFAULT 'Africa/Cairo',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz
);
SELECT wesal_add_updated_at_trigger('families');

CREATE TABLE family_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text        NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner','admin','member','trusted_contact')),
  status       text        NOT NULL DEFAULT 'invited'
               CHECK (status IN ('invited','active','left','removed')),
  invited_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  joined_at    timestamptz,
  left_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_members_active_needs_joined CHECK (status <> 'active' OR joined_at IS NOT NULL)
);
SELECT wesal_add_updated_at_trigger('family_members');
CREATE UNIQUE INDEX family_members_one_row_per_user ON family_members (family_id, user_id);
-- مالك واحد فقط لكل عائلة
CREATE UNIQUE INDEX family_members_single_owner ON family_members (family_id)
  WHERE role = 'owner' AND status = 'active';
CREATE INDEX family_members_user_idx ON family_members (user_id) WHERE status = 'active';
