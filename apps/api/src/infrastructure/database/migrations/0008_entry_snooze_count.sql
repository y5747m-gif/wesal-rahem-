-- ══════════════════════════════════════════════════════════════════════
-- وصال — 0008: عدّاد التأجيلات على الموعد
--
-- لماذا؟ لأن "⏰ لاحقًا" يجب أن يكون محدودًا (لا مماطلة بلا نهاية)،
-- ولأن سجل الوصال يجب أن يبقى نظيفًا من التأجيلات (سجل تواصل لا سجل أزرار).
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE schedule_entries
  ADD COLUMN IF NOT EXISTS snooze_count integer NOT NULL DEFAULT 0;

ALTER TABLE schedule_entries
  DROP CONSTRAINT IF EXISTS entries_snooze_count_non_negative;
ALTER TABLE schedule_entries
  ADD CONSTRAINT entries_snooze_count_non_negative CHECK (snooze_count >= 0);

-- التأجيل المتكرر يستحق فهرسًا لدعم استعلامات "من يؤجّل كثيرًا؟" (تقارير لاحقة)
CREATE INDEX IF NOT EXISTS entries_snoozed_idx ON schedule_entries (person_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;
