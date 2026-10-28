-- Ujian pool: setiap siswa mendapat N soal acak dari daftar exam_questions.
-- 0 (default) berarti pakai semua soal.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS questions_per_session int NOT NULL DEFAULT 0
  CHECK (questions_per_session >= 0);
