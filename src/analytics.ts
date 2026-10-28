// Query analisis butir yang dipakai API (/api/exams/:id/...) dan halaman guru.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

// Distribusi pilihan per opsi untuk soal pg/benar_salah.
export const distractorRows = (tx: Tx, examId: string) =>
  tx`with per_option as (
         select q.id as qid, substring(q.content->>'text', 1, 100) as text,
                q.content->'options' as options, (k.answer_key->>'index')::int as correct_index,
                coalesce(a.answer->>'index', 'null') as picked, count(*)::int as n
         from questions q
         join exam_questions eq on eq.question_id = q.id and eq.exam_id = ${examId}
         left join question_keys k on k.question_id = q.id
         left join answers a on a.question_id = q.id
            and a.session_id in (select id from exam_sessions where exam_id = ${examId} and status = 'submitted')
         where q.type in ('pg','benar_salah') and a.answer is not null
         group by q.id, q.content, k.answer_key, a.answer->>'index'
       )
       select qid as id, text, options, correct_index,
              sum(n)::int as total_answered,
              jsonb_object_agg(picked, n) as distribution
       from per_option
       group by qid, text, options, correct_index
       order by qid`;

// p-value (proporsi benar) + daya pembeda D (kuartil atas − bawah).
export const itemRows = (tx: Tx, examId: string) =>
  tx`with
      sessions as (
        select es.id, sc.final_score,
               ntile(4) over (order by sc.final_score) as quartile
        from exam_sessions es
        left join scores sc on sc.session_id = es.id
        where es.exam_id = ${examId} and es.status = 'submitted'
      ),
      answered as (
        select a.question_id, a.session_id, s.quartile,
               case q.type
                 when 'pg'          then ((k.answer_key->>'index')::int = (a.answer->>'index')::int)
                 when 'benar_salah' then ((k.answer_key->>'index')::int = (a.answer->>'index')::int)
                 when 'isian'       then exists(
                   select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                   where lower(trim(x.value)) = lower(trim(a.answer->>'text')))
                 when 'pgk_centang' then (
                   select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(k.answer_key->'correct') x
                 ) = (
                   select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(a.answer->'selected') x
                 )
                 when 'menjodohkan' then a.answer->'pairs' = k.answer_key->'pairs'
                 when 'uraian'      then (a.answer->>'manual_score')::numeric >= q.points * 0.5
                 else false end as benar
        from answers a
        join sessions s on s.id = a.session_id
        join questions q on q.id = a.question_id
        left join question_keys k on k.question_id = q.id
      )
      select q.id, q.type, substring(q.content->>'text', 1, 120) as text,
             count(ans.session_id)::int as n,
             coalesce(round(avg(case when ans.benar then 1 else 0 end)::numeric, 3), 0) as p_value,
             coalesce(round(
               (avg(case when ans.benar and ans.quartile = 4 then 1 else 0 end) -
                avg(case when ans.benar and ans.quartile = 1 then 1 else 0 end))::numeric, 3), 0) as discrimination
      from questions q
      join exam_questions eq on eq.question_id = q.id and eq.exam_id = ${examId}
      left join answered ans on ans.question_id = q.id
      group by q.id, q.type, q.content->>'text'
      order by discrimination desc nulls last, p_value asc`;
