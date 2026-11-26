-- D1 produksi yang sudah berjalan: jumlah jawaban per sesi disimpan, bukan dihitung ulang tiap 8 detik di layar pantau.
-- Jalankan sekali: npx wrangler d1 execute cbt-yuk --remote --file db/d1/0002_answered_count.sql
ALTER TABLE exam_sessions ADD COLUMN answered_count integer NOT NULL DEFAULT 0;
UPDATE exam_sessions SET answered_count = (SELECT count(*) FROM answers a WHERE a.session_id = exam_sessions.id AND a.answer IS NOT NULL);
CREATE INDEX IF NOT EXISTS exam_sessions_due ON exam_sessions (school_id, status, deadline_at);
PRAGMA optimize;
