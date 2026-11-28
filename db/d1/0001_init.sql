-- CBT Yuk: skema Cloudflare D1 (SQLite). Hasil gabungan db/migrations/0001..0017 (Postgres/Neon).
--
-- Aturan konversi:
--   uuid        -> text, default uuid v4 acak (format sama dengan Neon, jadi data bisa disalin apa adanya)
--   timestamptz -> text ISO-8601 UTC "YYYY-MM-DDTHH:MM:SS.sssZ" (urut leksikal = urut waktu; JANGAN simpan format lain)
--   jsonb       -> text, dijaga CHECK (json_valid)
--   boolean     -> integer 0/1
--   numeric     -> real
--   bigserial   -> integer primary key autoincrement
--
-- TIDAK ADA di D1 (dikerjakan di kode Worker, langkah 2-3):
--   * Row-Level Security: tiap query tenant wajib memfilter school_id sendiri.
--   * Role/GRANT, fungsi app_*(), SECURITY DEFINER (resolve_school, register_school,
--     find_staff_by_email, find_students_by_username, public_bank, list_public_banks,
--     increment_bank_download) dan score_session() -> ditulis ulang di TypeScript.
-- Foreign key SQLite hanya aktif bila PRAGMA foreign_keys=ON (D1 mengaktifkannya).

-- ===== Sekolah =====
CREATE TABLE schools (
  id          text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
                substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
                substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  code        text NOT NULL UNIQUE CHECK (length(code) BETWEEN 3 AND 32 AND code NOT GLOB '*[^a-z0-9-]*'),
  name        text NOT NULL,
  level       text NOT NULL CHECK (level IN ('SD','SMP','SMA','CAMPURAN')),
  npsn        text,
  logo_key    text,
  color       text NOT NULL DEFAULT 'biru' CHECK (color IN ('biru','hijau','ungu','merah','oranye','toska')),
  operator_name  text NOT NULL,
  operator_phone text NOT NULL,
  plan        text NOT NULL DEFAULT 'trial',
  student_quota     integer NOT NULL DEFAULT 300,
  concurrent_quota  integer NOT NULL DEFAULT 300,
  active      integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  privacy_consent_at text,
  created_at  text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  cert_style  text CHECK (cert_style IS NULL OR json_valid(cert_style))  -- tampilan sertifikat (tema, judul, penanda tangan)
);

-- ===== Pengguna staf =====
CREATE TABLE users (
  id         text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
             substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
             substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id  text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email      text NOT NULL,
  name       text,
  role       text NOT NULL CHECK (role IN ('admin','teacher','proctor')),
  google_sub text,
  active     integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  password_hash text,                         -- login email + password (opsional, di samping Google)
  pw_failed  integer NOT NULL DEFAULT 0,
  pw_locked_until text,
  UNIQUE (school_id, email)
);

CREATE TABLE system_owners (
  id    text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
        substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
        substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  email text NOT NULL UNIQUE
);

-- ===== Kelas & siswa =====
CREATE TABLE classes (
  id        text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
            substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
            substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  grade     integer,
  year      text NOT NULL,
  UNIQUE (school_id, name, year)
);

CREATE TABLE students (
  id        text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
            substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
            substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id  text REFERENCES classes(id) ON DELETE SET NULL,
  name      text NOT NULL,
  nisn      text,
  gender    text CHECK (gender IN ('L','P')),
  username  text NOT NULL,
  pin_hash  text NOT NULL,
  qr_token_hash text,
  photo_key text,
  guardian_email text,
  pin_failed_count integer NOT NULL DEFAULT 0,
  locked_until text,
  active    integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (school_id, username)
);

CREATE TABLE pin_resets (
  id          text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
              substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
              substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id   text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requested_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_by  text REFERENCES users(id),
  approved_at  text,
  new_pin      text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);

-- ===== Bank soal =====
CREATE TABLE categories (
  id        text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
            substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
            substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  parent_id text REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE passages (
  id        text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
            substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
            substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title     text,
  body      text NOT NULL
);

CREATE TABLE questions (
  id          text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
              substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
              substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id   text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  author_id   text REFERENCES users(id) ON DELETE SET NULL,
  category_id text REFERENCES categories(id) ON DELETE SET NULL,
  passage_id  text REFERENCES passages(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN
    ('pg','benar_salah','isian','uraian','pgk_centang','pgk_kategori','menjodohkan','simulasi','dinamis_hitung')),
  content     text NOT NULL CHECK (json_valid(content)),   -- teks soal, opsi, gambar (TANPA kunci)
  points      real NOT NULL DEFAULT 1,
  created_at  text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE question_keys (
  question_id text PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  school_id   text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  answer_key  text NOT NULL CHECK (json_valid(answer_key)),
  rubric      text
);

-- ===== Ujian =====
CREATE TABLE exam_groups (
  id         text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
             substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
             substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id  text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title      text NOT NULL,
  description text,
  strict_order integer NOT NULL DEFAULT 1 CHECK (strict_order IN (0,1)),
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE exams (
  id        text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
            substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
            substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  creator_id text REFERENCES users(id) ON DELETE SET NULL,
  title     text NOT NULL,
  kind      text NOT NULL CHECK (length(trim(kind)) BETWEEN 1 AND 60),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  shuffle_questions integer NOT NULL DEFAULT 0 CHECK (shuffle_questions IN (0,1)),
  shuffle_options   integer NOT NULL DEFAULT 0 CHECK (shuffle_options IN (0,1)),
  anticheat_level   text NOT NULL DEFAULT 'log' CHECK (anticheat_level IN ('log','warn','lock')),
  lock_after_violations integer DEFAULT 3 CHECK (lock_after_violations > 0),
  token_hash text,
  use_token  integer NOT NULL DEFAULT 0 CHECK (use_token IN (0,1)),
  show_score integer NOT NULL DEFAULT 1 CHECK (show_score IN (0,1)),
  questions_per_session integer NOT NULL DEFAULT 0 CHECK (questions_per_session >= 0),
  scoring_config text NOT NULL DEFAULT '{}' CHECK (json_valid(scoring_config)),
  group_id   text REFERENCES exam_groups(id) ON DELETE SET NULL,
  group_position integer,
  starts_at  text,
  ends_at    text,
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','open','closed')),
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE exam_classes (
  exam_id   text NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_id  text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  school_id text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  PRIMARY KEY (exam_id, class_id)
);

CREATE TABLE exam_questions (
  exam_id     text NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  school_id   text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  weight      real NOT NULL DEFAULT 1,
  PRIMARY KEY (exam_id, question_id)
);

-- ===== Sesi & jawaban =====
CREATE TABLE exam_sessions (
  id         text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
             substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
             substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id  text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id    text NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  started_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deadline_at text NOT NULL,
  finished_at text,
  last_seen_at text,
  paused_at  text,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','submitted','expired')),
  violation_count integer NOT NULL DEFAULT 0,
  unlock_code text,
  unlock_tries integer NOT NULL DEFAULT 0,
  lock_count integer NOT NULL DEFAULT 0,
  question_order text CHECK (question_order IS NULL OR json_valid(question_order)),
  answered_count integer NOT NULL DEFAULT 0,  -- jumlah soal berjawaban; dibaca layar pantau tanpa menghitung ulang answers
  UNIQUE (exam_id, student_id)
);

CREATE TABLE answers (
  session_id  text NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  school_id   text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  answer      text CHECK (answer IS NULL OR json_valid(answer)),
  flagged     integer NOT NULL DEFAULT 0 CHECK (flagged IN (0,1)),
  client_seq  integer NOT NULL DEFAULT 0,
  updated_at  text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (session_id, question_id)
);

CREATE TABLE violations (
  id         integer PRIMARY KEY AUTOINCREMENT,
  school_id  text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  occurred_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE scores (
  session_id text PRIMARY KEY REFERENCES exam_sessions(id) ON DELETE CASCADE,
  school_id  text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id    text NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  auto_score real,
  manual_score real,
  final_score real,
  approved_by text REFERENCES users(id),
  approved_at text
);

CREATE TABLE exam_messages (
  id         integer PRIMARY KEY AUTOINCREMENT,
  school_id  text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  from_role  text NOT NULL CHECK (from_role IN ('student','staff')),
  from_name  text,
  content    text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_log (
  id          integer PRIMARY KEY AUTOINCREMENT,
  school_id   text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id    text REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  actor_role  text,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  details     text CHECK (details IS NULL OR json_valid(details)),
  created_at  text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE shared_banks (
  id         text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
             substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
             substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  school_id  text NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  slug       text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 64 AND slug NOT GLOB '*[^a-z0-9-]*'),
  title      text NOT NULL,
  description text,
  payload    text NOT NULL CHECK (json_valid(payload)),
  download_count integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Tanpa school_id (lintas-tenant, sengaja)
CREATE TABLE rate_counters (
  bucket text NOT NULL,
  key    text NOT NULL,
  window_start text NOT NULL,
  count  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

-- ===== Indeks =====
CREATE INDEX users_school            ON users (school_id);
CREATE INDEX students_school_class   ON students (school_id, class_id);
CREATE INDEX students_username       ON students (lower(username));   -- login tanpa kode sekolah
CREATE INDEX questions_school_cat    ON questions (school_id, category_id);
CREATE INDEX exams_school_status     ON exams (school_id, status, starts_at);
CREATE INDEX exams_group             ON exams (group_id, group_position);
CREATE INDEX exam_sessions_exam      ON exam_sessions (exam_id, status);
CREATE INDEX exam_sessions_student   ON exam_sessions (student_id);
CREATE INDEX exam_sessions_due       ON exam_sessions (school_id, status, deadline_at);  -- catchUp: sesi aktif yang lewat waktu
CREATE INDEX answers_school_session  ON answers (school_id, session_id);
CREATE INDEX violations_session      ON violations (session_id);
CREATE INDEX scores_exam             ON scores (exam_id);
CREATE INDEX pin_resets_school       ON pin_resets (school_id, status);
CREATE INDEX pin_resets_student      ON pin_resets (student_id);
CREATE INDEX audit_log_school        ON audit_log (school_id, created_at DESC);
CREATE INDEX audit_log_entity        ON audit_log (entity, entity_id);
CREATE INDEX exam_messages_session   ON exam_messages (session_id, created_at);
CREATE INDEX shared_banks_school     ON shared_banks (school_id);
CREATE INDEX rate_counters_cleanup   ON rate_counters (window_start);
