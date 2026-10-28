-- Email wali untuk rapor terjadwal.
ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_email text;

-- Timer pause: catat kapan di-pause.
ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS paused_at timestamptz;

-- Bank soal publik (shared bank). Slug untuk URL.
CREATE TABLE IF NOT EXISTS shared_banks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,64}$'),
  title      text NOT NULL,
  description text,
  payload    jsonb NOT NULL,     -- {questions:[{type,content,answer_key,rubric,points}], exported_at}
  download_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shared_banks_school ON shared_banks (school_id);

ALTER TABLE shared_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_banks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shared_banks
  USING (app_is_owner() OR school_id = app_school_id())
  WITH CHECK (app_is_owner() OR school_id = app_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON shared_banks TO cbt_app;

-- Fungsi publik: ambil bank tanpa butuh RLS context (SECURITY DEFINER).
-- Dipakai endpoint /public/banks/:slug supaya pengunjung non-login bisa unduh.
CREATE OR REPLACE FUNCTION public_bank(p_slug text)
RETURNS TABLE (slug text, title text, description text, payload jsonb, download_count int)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT slug, title, description, payload, download_count
   FROM shared_banks WHERE slug = p_slug $$;
REVOKE ALL ON FUNCTION public_bank(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_bank(text) TO cbt_app;

CREATE OR REPLACE FUNCTION increment_bank_download(p_slug text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ UPDATE shared_banks SET download_count = download_count + 1 WHERE slug = p_slug $$;
GRANT EXECUTE ON FUNCTION increment_bank_download(text) TO cbt_app;
