-- Tes rumus nilai score_session() dengan jawaban tetap.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/score_session.sql
-- Seluruh tes di dalam transaksi dan di-ROLLBACK.
BEGIN;

INSERT INTO schools (id, code, name, level, operator_name, operator_phone) VALUES
  ('cccccccc-0000-0000-0000-000000000001','tes-nilai','Tes Nilai','SMA','Op','081');
INSERT INTO students (id, school_id, name, username, pin_hash) VALUES
  ('cccccccc-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-000000000001','Siswa','s1','x');
INSERT INTO exams (id, school_id, title, kind, duration_minutes, scoring_config) VALUES
  ('cccccccc-0000-0000-0000-0000000000e1','cccccccc-0000-0000-0000-000000000001','Tes','harian',60,
   '{"wrong_penalty": 0.25}');

-- q1 pg 2 poin benar · q2 pg 1 poin salah (penalti) · q3 isian benar (beda spasi/kapital)
-- q4 pgk 2 poin: 1 benar + 1 salah = 0 · q5 benar_salah benar pakai petunjuk (×0.5)
-- q6 uraian 3 poin dinilai 2 · q7 simulasi 2 poin belum dinilai · q8 pg tidak dijawab
INSERT INTO questions (id, school_id, type, content, points) VALUES
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','pg','{"text":"1"}',2),
  ('cccccccc-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001','pg','{"text":"2"}',1),
  ('cccccccc-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000001','isian','{"text":"3"}',1),
  ('cccccccc-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000001','pgk_centang','{"text":"4"}',2),
  ('cccccccc-0000-0000-0000-000000000005','cccccccc-0000-0000-0000-000000000001','benar_salah','{"text":"5"}',1),
  ('cccccccc-0000-0000-0000-000000000006','cccccccc-0000-0000-0000-000000000001','uraian','{"text":"6"}',3),
  ('cccccccc-0000-0000-0000-000000000007','cccccccc-0000-0000-0000-000000000001','simulasi','{"text":"7"}',2),
  ('cccccccc-0000-0000-0000-000000000008','cccccccc-0000-0000-0000-000000000001','pg','{"text":"8"}',1);
INSERT INTO question_keys (question_id, school_id, answer_key) VALUES
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','{"index":1}'),
  ('cccccccc-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001','{"index":0}'),
  ('cccccccc-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000001','{"accepted":["jakarta"]}'),
  ('cccccccc-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000001','{"correct":[0,2]}'),
  ('cccccccc-0000-0000-0000-000000000005','cccccccc-0000-0000-0000-000000000001','{"index":0}'),
  ('cccccccc-0000-0000-0000-000000000008','cccccccc-0000-0000-0000-000000000001','{"index":0}');
INSERT INTO exam_questions (exam_id, question_id, school_id, position)
  SELECT 'cccccccc-0000-0000-0000-0000000000e1', id, school_id, row_number() OVER (ORDER BY id)
  FROM questions WHERE school_id = 'cccccccc-0000-0000-0000-000000000001';
INSERT INTO exam_sessions (id, school_id, exam_id, student_id, deadline_at) VALUES
  ('cccccccc-0000-0000-0000-0000000000f1','cccccccc-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-0000000000e1','cccccccc-0000-0000-0000-0000000000a1', now() + interval '1 hour');
INSERT INTO answers (session_id, question_id, school_id, answer)
  SELECT 'cccccccc-0000-0000-0000-0000000000f1', q::uuid, 'cccccccc-0000-0000-0000-000000000001', a::jsonb
  FROM (VALUES
    ('cccccccc-0000-0000-0000-000000000001','{"index":1}'),
    ('cccccccc-0000-0000-0000-000000000002','{"index":3}'),
    ('cccccccc-0000-0000-0000-000000000003','{"text":"  Jakarta "}'),
    ('cccccccc-0000-0000-0000-000000000004','{"selected":[0,1]}'),
    ('cccccccc-0000-0000-0000-000000000005','{"index":0,"hint_used":true}'),
    ('cccccccc-0000-0000-0000-000000000006','{"text":"esai","manual_score":2}'),
    ('cccccccc-0000-0000-0000-000000000007','{"state":{}}')
  ) v(q, a);

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM score_session('cccccccc-0000-0000-0000-0000000000f1');
  -- got = 2 − 0.25 + 1 + 0 + 0.5 + 2 + 0 + 0 = 5.25 ; total = 13 ; pending = 2 (simulasi)
  IF r.got <> 5.25 THEN RAISE EXCEPTION 'FAIL: got = % (harus 5.25)', r.got; END IF;
  IF r.total <> 13 THEN RAISE EXCEPTION 'FAIL: total = % (harus 13)', r.total; END IF;
  IF r.manual_pending <> 2 THEN RAISE EXCEPTION 'FAIL: manual_pending = % (harus 2)', r.manual_pending; END IF;
  RAISE NOTICE 'OK: score_session';
END $$;

ROLLBACK;
