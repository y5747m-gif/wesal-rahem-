-- ══════════════════════════════════════════════════════════════════════
-- وصال — 0001: الدوال المساعدة
--
-- قرار: لا نستخدم أي إضافات (extensions) — gen_random_uuid() مدمجة في نواة
-- PostgreSQL منذ الإصدار 13، والبريد يُخزَّن نصًا مع فهرس على lower(email).
-- هذا يجعل المخطط قابلًا للتشغيل على أي PostgreSQL حديث بلا صلاحيات إضافية.
-- ══════════════════════════════════════════════════════════════════════

-- تحديث updated_at تلقائيًا
CREATE OR REPLACE FUNCTION wesal_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

-- دالة مساعدة لإنشاء مُشغّل updated_at على أي جدول
CREATE OR REPLACE FUNCTION wesal_add_updated_at_trigger(table_name text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION wesal_set_updated_at()',
    table_name || '_updated_at', table_name
  );
END;
$fn$;

-- تنظيف نهايات الأسبوع في النصوص (يُستخدم في البحث)
CREATE OR REPLACE FUNCTION wesal_search_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $fn$
  SELECT lower(btrim(regexp_replace(value, '\s+', ' ', 'g')));
$fn$;
