-- Tambah tipe 'simulasi' (HTML+JS interaktif di iframe sandbox).
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check CHECK (type IN
  ('pg','benar_salah','isian','uraian','pgk_centang','pgk_kategori','menjodohkan','simulasi'));
