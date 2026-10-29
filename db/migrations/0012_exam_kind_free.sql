-- Jenis ujian boleh diketik bebas oleh guru (mis. "Ulangan Bab 3", "Asesmen Sumatif").
ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_kind_check;
ALTER TABLE exams ADD CONSTRAINT exams_kind_check CHECK (length(trim(kind)) BETWEEN 1 AND 60);
