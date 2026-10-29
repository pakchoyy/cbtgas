-- Kode buka 6 angka untuk sesi yang terkunci karena pelanggaran. Pengawas
-- membacakannya ke siswa; setelah dimasukkan, hitungan pelanggaran mulai dari 0.
ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS unlock_code text;
ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS unlock_tries int NOT NULL DEFAULT 0;
-- Default baru: kunci setelah 3 pelanggaran.
ALTER TABLE exams ALTER COLUMN lock_after_violations SET DEFAULT 3;
