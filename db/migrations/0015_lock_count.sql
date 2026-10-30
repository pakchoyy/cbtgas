-- Berapa kali sesi pernah dikunci karena pelanggaran. Kunci kedua = dikumpulkan otomatis.
ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS lock_count int NOT NULL DEFAULT 0;
