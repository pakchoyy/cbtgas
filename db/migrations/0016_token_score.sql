-- Token ujian berganti tiap 15 menit (dihitung dari rahasia server, tidak disimpan).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS use_token boolean NOT NULL DEFAULT false;
-- Tampilkan nilai ke siswa setelah mengumpulkan.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_score boolean NOT NULL DEFAULT true;
