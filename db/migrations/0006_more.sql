-- Formula skor custom per ujian (bobot kategori, pengurangan salah, dll).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS scoring_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Grup / rangkaian ujian: siswa menyelesaikan paket secara berurutan.
CREATE TABLE IF NOT EXISTS exam_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title      text NOT NULL,
  description text,
  strict_order boolean NOT NULL DEFAULT true,  -- jika true, harus urut
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE exams ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES exam_groups(id) ON DELETE SET NULL;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS group_position int;
CREATE INDEX IF NOT EXISTS exams_group ON exams (group_id, group_position);

ALTER TABLE exam_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_groups
  USING (app_is_owner() OR school_id = app_school_id())
  WITH CHECK (app_is_owner() OR school_id = app_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON exam_groups TO cbt_app;

-- Chat sederhana per sesi ujian: siswa ↔ pengawas/guru.
CREATE TABLE IF NOT EXISTS exam_messages (
  id         bigserial PRIMARY KEY,
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  from_role  text NOT NULL CHECK (from_role IN ('student','staff')),
  from_name  text,  -- untuk tampilan
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_messages_session ON exam_messages (session_id, created_at);

ALTER TABLE exam_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_messages
  USING (app_is_owner() OR school_id = app_school_id())
  WITH CHECK (app_is_owner() OR school_id = app_school_id());
GRANT SELECT, INSERT ON exam_messages TO cbt_app;
