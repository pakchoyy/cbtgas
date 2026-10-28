-- Rate limiting sederhana: counter per (bucket, key, window).
-- Bucket = nama endpoint, key = IP (atau IP+username), window_start di-truncate per menit.
CREATE TABLE IF NOT EXISTS rate_counters (
  bucket text NOT NULL,
  key    text NOT NULL,
  window_start timestamptz NOT NULL,
  count  int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);
CREATE INDEX IF NOT EXISTS rate_counters_cleanup ON rate_counters (window_start);

-- RLS tidak dipakai (akses lintas-tenant intentional); GRANT ke cbt_app.
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_counters TO cbt_app;

-- Tipe soal matematika dinamis + perluas CHECK constraint.
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check CHECK (type IN
  ('pg','benar_salah','isian','uraian','pgk_centang','pgk_kategori','menjodohkan','simulasi','dinamis_hitung'));
