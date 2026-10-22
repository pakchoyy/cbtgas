-- CBT Sekolah SD-SMA: skema fase A + RLS multi-sekolah (Postgres / Neon)
-- Konteks per transaksi (diset Worker lewat SET LOCAL / set_config(..., true)):
--   app.school_id : uuid sekolah aktif
--   app.role      : 'owner' | 'admin' | 'teacher' | 'proctor' | 'student'
--   app.user_id   : uuid pengguna/siswa aktif

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Role database =====
-- cbt_migrator = pemilik tabel (hanya untuk migrasi). cbt_app = dipakai Worker, TIDAK bypass RLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cbt_app') THEN
    CREATE ROLE cbt_app NOLOGIN NOBYPASSRLS NOSUPERUSER;
  END IF;
END $$;

-- ===== Fungsi konteks =====
CREATE OR REPLACE FUNCTION app_school_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.school_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.role', true), '') $$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_is_owner() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app_role() = 'owner' $$;

CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app_role() IN ('admin','teacher','proctor') $$;

-- ===== Sekolah =====
CREATE TABLE schools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{3,32}$'),
  name        text NOT NULL,
  level       text NOT NULL CHECK (level IN ('SD','SMP','SMA','CAMPURAN')),
  npsn        text,
  logo_key    text,
  color       text NOT NULL DEFAULT 'biru',
  operator_name  text NOT NULL,
  operator_phone text NOT NULL,
  plan        text NOT NULL DEFAULT 'trial',
  student_quota     int NOT NULL DEFAULT 300,
  concurrent_quota  int NOT NULL DEFAULT 300,
  active      boolean NOT NULL DEFAULT true,
  privacy_consent_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Resolusi kode sekolah sebelum login (tanpa membuka daftar sekolah lain)
CREATE OR REPLACE FUNCTION resolve_school(p_code text)
RETURNS TABLE (id uuid, name text, level text, logo_key text, color text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT s.id, s.name, s.level, s.logo_key, s.color
   FROM schools s WHERE s.code = lower(p_code) AND s.active $$;
REVOKE ALL ON FUNCTION resolve_school(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_school(text) TO cbt_app;

-- ===== Pengguna staf (guru/admin/pengawas) =====
CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email      text NOT NULL,
  name       text,
  role       text NOT NULL CHECK (role IN ('admin','teacher','proctor')),
  google_sub text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, email)
);

-- Pemilik sistem (di luar sekolah, hanya via role 'owner')
CREATE TABLE system_owners (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE
);

-- ===== Kelas & siswa =====
CREATE TABLE classes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  grade     int,
  year      text NOT NULL,
  UNIQUE (school_id, name, year)
);

CREATE TABLE students (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id  uuid REFERENCES classes(id) ON DELETE SET NULL,
  name      text NOT NULL,
  nisn      text,
  gender    text CHECK (gender IN ('L','P')),
  username  text NOT NULL,
  pin_hash  text NOT NULL,
  qr_token_hash text,
  photo_key text,
  pin_failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, username)
);

-- ===== Bank soal =====
CREATE TABLE categories (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  parent_id uuid REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE passages (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title     text,
  body      text NOT NULL
);

CREATE TABLE questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  passage_id  uuid REFERENCES passages(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN
    ('pg','benar_salah','isian','uraian','pgk_centang','pgk_kategori','menjodohkan')),
  content     jsonb NOT NULL,          -- teks soal, opsi, gambar (TANPA kunci)
  points      numeric(6,2) NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Kunci jawaban dipisah; tidak pernah dikirim ke siswa
CREATE TABLE question_keys (
  question_id uuid PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  answer_key  jsonb NOT NULL,
  rubric      text
);

-- ===== Ujian =====
CREATE TABLE exams (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  creator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title     text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('harian','pts_pas','sumatif','tryout')),
  duration_minutes int NOT NULL CHECK (duration_minutes > 0),
  shuffle_questions boolean NOT NULL DEFAULT false,
  shuffle_options   boolean NOT NULL DEFAULT false,
  anticheat_level   text NOT NULL DEFAULT 'log'
    CHECK (anticheat_level IN ('log','warn','lock')),
  lock_after_violations int CHECK (lock_after_violations > 0),
  token_hash text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE exam_classes (
  exam_id   uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_id  uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  PRIMARY KEY (exam_id, class_id)
);

CREATE TABLE exam_questions (
  exam_id     uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  position    int NOT NULL,
  weight      numeric(6,2) NOT NULL DEFAULT 1,
  PRIMARY KEY (exam_id, question_id)
);

-- ===== Sesi & jawaban =====
CREATE TABLE exam_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id    uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,       -- dihitung server
  finished_at timestamptz,
  last_seen_at timestamptz,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','submitted','expired')),
  violation_count int NOT NULL DEFAULT 0,
  question_order jsonb,
  UNIQUE (exam_id, student_id)             -- satu sesi aktif per siswa per ujian
);

CREATE TABLE answers (
  session_id  uuid NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  answer      jsonb,
  flagged     boolean NOT NULL DEFAULT false,
  client_seq  bigint NOT NULL DEFAULT 0,   -- tolak batch lama (idempoten)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, question_id)
);

CREATE TABLE violations (
  id         bigserial PRIMARY KEY,
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scores (
  session_id uuid PRIMARY KEY REFERENCES exam_sessions(id) ON DELETE CASCADE,
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id    uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  auto_score numeric(7,2),
  manual_score numeric(7,2),
  final_score numeric(7,2),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz
);

-- ===== Indeks =====
CREATE INDEX ON users (school_id);
CREATE INDEX ON students (school_id, class_id);
CREATE INDEX ON questions (school_id, category_id);
CREATE INDEX ON exams (school_id, status, starts_at);
CREATE INDEX ON exam_sessions (exam_id, status);
CREATE INDEX ON exam_sessions (student_id);
CREATE INDEX ON answers (school_id, session_id);
CREATE INDEX ON violations (session_id);
CREATE INDEX ON scores (exam_id);

-- ===== RLS =====
-- Tabel dengan school_id: staf dan siswa hanya lihat sekolahnya; owner lihat semua.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','classes','students','categories','passages',
    'questions','question_keys','exams','exam_classes','exam_questions',
    'exam_sessions','answers','violations','scores'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (app_is_owner() OR school_id = app_school_id())
      WITH CHECK (app_is_owner() OR school_id = app_school_id())$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO cbt_app', t);
  END LOOP;
END $$;

-- Sequence (mis. violations.id bigserial) butuh USAGE/SELECT eksplisit;
-- default privileges-nya di-set agar sequence baru nanti ikut.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cbt_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cbt_app;

-- Sekolah: hanya baris sendiri (atau owner). Daftar sekolah baru lewat fungsi khusus.
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
CREATE POLICY school_self ON schools
  USING (app_is_owner() OR id = app_school_id())
  WITH CHECK (app_is_owner() OR id = app_school_id());
GRANT SELECT, UPDATE ON schools TO cbt_app;

CREATE OR REPLACE FUNCTION register_school(
  p_code text, p_name text, p_level text, p_npsn text,
  p_operator_name text, p_operator_phone text, p_admin_email text, p_google_sub text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO schools (code, name, level, npsn, operator_name, operator_phone, privacy_consent_at)
  VALUES (lower(p_code), p_name, p_level, p_npsn, p_operator_name, p_operator_phone, now())
  RETURNING id INTO v_id;
  INSERT INTO users (school_id, email, role, google_sub)
  VALUES (v_id, lower(p_admin_email), 'admin', p_google_sub);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION register_school(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_school(text,text,text,text,text,text,text,text) TO cbt_app;

-- Pencarian staf saat login Google (sebelum school_id diketahui); hanya mengembalikan undangan aktif
CREATE OR REPLACE FUNCTION find_staff_by_email(p_email text)
RETURNS TABLE (user_id uuid, school_id uuid, role text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT u.id, u.school_id, u.role FROM users u
   JOIN schools s ON s.id = u.school_id AND s.active
   WHERE u.email = lower(p_email) AND u.active $$;
REVOKE ALL ON FUNCTION find_staff_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_staff_by_email(text) TO cbt_app;

GRANT SELECT ON system_owners TO cbt_app;
