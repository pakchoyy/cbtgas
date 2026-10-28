-- Satu-satunya rumus nilai. Dipanggil dari submit siswa, cron (sesi kedaluwarsa),
-- kumpul paksa, dan penilaian manual guru, supaya nilai tidak bergantung pada
-- cara ujian ditutup.
--
-- got            : poin diperoleh (sudah termasuk bobot kategori, penalti salah,
--                  potongan petunjuk 50%, dan nilai manual uraian/simulasi bila ada)
-- total          : total poin soal di sesi ini (× bobot)
-- manual_pending : poin soal uraian/simulasi yang belum dinilai guru
--
-- SECURITY INVOKER: berjalan dengan RLS pemanggil.
CREATE OR REPLACE FUNCTION score_session(p_session uuid)
RETURNS TABLE (got numeric, total numeric, manual_pending numeric)
LANGUAGE sql STABLE AS $$
  WITH s AS (
    SELECT es.id, es.exam_id,
           coalesce(
             CASE WHEN jsonb_typeof(es.question_order) = 'object' THEN es.question_order->'order'
                  WHEN jsonb_typeof(es.question_order) = 'array'  THEN es.question_order END,
             (SELECT to_jsonb(array_agg(question_id)) FROM exam_questions WHERE exam_id = es.exam_id)
           ) AS qorder
    FROM exam_sessions es WHERE es.id = p_session
  ),
  items AS (
    SELECT q.type, q.points, k.answer_key AS key, a.answer AS ans,
           coalesce((e.scoring_config->'category_weights'->>q.category_id::text)::numeric, 1) AS w,
           coalesce((e.scoring_config->>'wrong_penalty')::numeric, 0) AS pen
    FROM s
    CROSS JOIN LATERAL jsonb_array_elements_text(s.qorder) AS qid
    JOIN questions q ON q.id = qid.value::uuid
    JOIN exams e ON e.id = s.exam_id
    LEFT JOIN question_keys k ON k.question_id = q.id
    LEFT JOIN answers a ON a.session_id = s.id AND a.question_id = q.id
  ),
  judged AS (
    SELECT type, points * w AS pts, pen, ans, key,
      CASE type
        WHEN 'pg'          THEN (key->>'index')::int = (ans->>'index')::int
        WHEN 'benar_salah' THEN (key->>'index')::int = (ans->>'index')::int
        WHEN 'isian'       THEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(key->'accepted') x
                                        WHERE lower(trim(x.value)) = lower(trim(ans->>'text')))
        WHEN 'menjodohkan' THEN ans->'pairs' = key->'pairs'
        WHEN 'dinamis_hitung' THEN
          (CASE key->>'formula'
             WHEN '+' THEN (ans->'vars'->>'a')::numeric + (ans->'vars'->>'b')::numeric
             WHEN '-' THEN (ans->'vars'->>'a')::numeric - (ans->'vars'->>'b')::numeric
             WHEN '*' THEN (ans->'vars'->>'a')::numeric * (ans->'vars'->>'b')::numeric
             WHEN '/' THEN (ans->'vars'->>'a')::numeric / nullif((ans->'vars'->>'b')::numeric, 0)
           END) = nullif(ans->>'text', '')::numeric
      END AS benar
    FROM items
  )
  SELECT
    coalesce(sum(
      (CASE type
        WHEN 'pg'          THEN CASE WHEN benar THEN pts WHEN ans ? 'index' THEN -pts * pen ELSE 0 END
        WHEN 'benar_salah' THEN CASE WHEN benar THEN pts WHEN ans ? 'index' THEN -pts * pen ELSE 0 END
        WHEN 'pgk_centang' THEN greatest(0::numeric,
            ((SELECT count(*) FROM jsonb_array_elements_text(key->'correct') kx
               WHERE kx::int IN (SELECT x::int FROM jsonb_array_elements_text(coalesce(ans->'selected','[]')) x))
           - (SELECT count(*) FROM jsonb_array_elements_text(coalesce(ans->'selected','[]')) ax
               WHERE ax::int NOT IN (SELECT x::int FROM jsonb_array_elements_text(key->'correct') x))
            )::numeric / nullif(jsonb_array_length(key->'correct'), 0) * pts)
        WHEN 'uraian'      THEN coalesce((ans->>'manual_score')::numeric, 0)
        WHEN 'simulasi'    THEN coalesce((ans->>'manual_score')::numeric, 0)
        ELSE CASE WHEN benar THEN pts ELSE 0 END
      END)
      * CASE WHEN ans->>'hint_used' = 'true' THEN 0.5 ELSE 1 END
    ), 0),
    coalesce(sum(pts), 0),
    coalesce(sum(CASE WHEN type IN ('uraian','simulasi') AND ans->>'manual_score' IS NULL THEN pts ELSE 0 END), 0)
  FROM judged
$$;
GRANT EXECUTE ON FUNCTION score_session(uuid) TO cbt_app;
