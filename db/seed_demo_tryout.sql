-- Tryout demo untuk tombol "Coba demo → sebagai siswa". Idempoten.
DO $$
DECLARE
  v_school uuid := (SELECT id FROM schools WHERE code = 'demo-sma');
  v_admin uuid := (SELECT id FROM users WHERE school_id = v_school AND role = 'admin' ORDER BY created_at LIMIT 1);
  v_class uuid; v_exam uuid; v_q uuid; v_pos int := 0;
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM exams WHERE school_id = v_school AND title = 'Tryout Demo CBT Yuk') THEN RETURN; END IF;

  INSERT INTO classes (school_id, name, grade, year) VALUES (v_school, 'Kelas Demo', 12, '2026/2027') RETURNING id INTO v_class;
  INSERT INTO exams (school_id, creator_id, title, kind, duration_minutes, status, shuffle_options, anticheat_level)
    VALUES (v_school, v_admin, 'Tryout Demo CBT Yuk', 'tryout', 15, 'open', false, 'warn') RETURNING id INTO v_exam;
  INSERT INTO exam_classes (exam_id, class_id, school_id) VALUES (v_exam, v_class, v_school);

  FOR r IN SELECT * FROM (VALUES
    ('pg', '{"text":"Hasil dari $\\frac{3}{4} + \\frac{1}{2}$ adalah …","options":["$1\\frac{1}{4}$","$1\\frac{1}{2}$","$\\frac{5}{6}$","$\\frac{4}{6}$"]}', '{"index":0}', 10),
    ('pg', '{"text":"Penulisan kata baku yang tepat terdapat pada kalimat …","options":["Ibu membeli obat di apotek.","Atlit itu berlari sangat cepat.","Ayah memberi nasehat kepada adik.","Kami makan di restoran sederhana sambil menunggu jadual."]}', '{"index":0}', 10),
    ('benar_salah', '{"text":"Air mendidih pada suhu 100 °C pada tekanan 1 atmosfer.","options":["Benar","Salah"]}', '{"index":0}', 10),
    ('pgk_centang', '{"text":"Manakah yang termasuk sumber energi terbarukan? (pilih semua yang benar)","options":["Tenaga surya","Batu bara","Tenaga angin","Minyak bumi","Panas bumi"]}', '{"correct":[0,2,4]}', 15),
    ('menjodohkan', '{"text":"Jodohkan tokoh dengan perannya.","left":["Ki Hajar Dewantara","R.A. Kartini","Ir. Soekarno"],"right":["Proklamator kemerdekaan","Bapak Pendidikan Nasional","Pelopor emansipasi perempuan"]}', '{"pairs":[[0,1],[1,2],[2,0]]}', 15),
    ('isian', '{"text":"Ibu kota Provinsi Jawa Timur adalah …"}', '{"accepted":["surabaya","kota surabaya"]}', 10),
    ('pg', '{"text":"Sebuah persegi panjang memiliki panjang 12 cm dan lebar 5 cm. Kelilingnya adalah …","options":["17 cm","34 cm","60 cm","24 cm"]}', '{"index":1}', 10),
    ('uraian', '{"text":"Jelaskan dengan singkat mengapa menjaga kebersihan sungai penting bagi lingkungan sekitar."}', '{}', 20)
  ) AS t(type, content, akey, pts) LOOP
    v_pos := v_pos + 1;
    INSERT INTO questions (school_id, author_id, type, content, points)
      VALUES (v_school, v_admin, r.type, r.content::jsonb, r.pts) RETURNING id INTO v_q;
    INSERT INTO question_keys (question_id, school_id, answer_key) VALUES (v_q, v_school, r.akey::jsonb);
    INSERT INTO exam_questions (exam_id, question_id, school_id, position) VALUES (v_exam, v_q, v_school, v_pos);
  END LOOP;
END $$;
SELECT e.id, e.title, e.status, (SELECT count(*) FROM exam_questions WHERE exam_id = e.id) n
FROM exams e WHERE title = 'Tryout Demo CBT Yuk';
