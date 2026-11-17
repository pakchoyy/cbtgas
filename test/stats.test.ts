import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.ts";
import { connectD1 } from "../src/d1.ts";
import { categoryStatsD1, weakCategoriesD1, distractorD1, itemD1, ntile4, looseCorrect } from "../src/statsd1.ts";
import { orderLength } from "../src/score.ts";
import { distractorRows, itemRows } from "../src/analytics.ts";


// 1 sekolah, 1 ujian, 8 siswa (skor 10..80), 3 soal; semua sesi 'submitted'.
async function seed() {
  const sql = connectD1(fakeD1()).unscoped();
  await sql`insert into schools (id,code,name,level,operator_name,operator_phone) values ('S','abc','S','SMA','o','1')`;
  await sql`insert into categories (id,school_id,name) values ('c1','S','Aljabar'), ('c2','S','Geometri')`;
  await sql`insert into exams (id,school_id,title,kind,duration_minutes) values ('E','S','t','k',10)`;
  const qs: Array<[string, string, string | null, unknown, number]> = [
    ["q1", "pg", "c1", { index: 1 }, 1], ["q2", "isian", "c1", { accepted: ["x"] }, 1], ["q3", "pgk_centang", "c2", { correct: [0, 2] }, 1],
  ];
  for (const [i, [id, type, cat, key, pts]] of qs.entries()) {
    await sql`insert into questions (id,school_id,type,category_id,content,points) values (${id},'S',${type},${cat},${{ text: "Soal " + id, options: ["a", "b", "c"] }},${pts})`;
    await sql`insert into question_keys (question_id,school_id,answer_key) values (${id},'S',${key})`;
    await sql`insert into exam_questions (exam_id,question_id,school_id,position) values ('E',${id},'S',${i + 1})`;
  }
  for (let n = 1; n <= 8; n++) {
    await sql`insert into students (id,school_id,name,username,pin_hash) values (${"st" + n},'S',${"S" + n},${"u" + n},'h')`;
    await sql`insert into exam_sessions (id,school_id,exam_id,student_id,deadline_at,status) values (${"ses" + n},'S','E',${"st" + n},now(),'submitted')`;
    await sql`insert into scores (session_id,school_id,exam_id,student_id,final_score) values (${"ses" + n},'S','E',${"st" + n},${n * 10})`;
    // q1 (pg): siswa 1-4 salah (pilih 0), 5-8 benar. q2: hanya siswa 6-8 benar. q3: semua benar.
    await sql`insert into answers (session_id,question_id,school_id,answer) values (${"ses" + n},'q1','S',${{ index: n <= 4 ? 0 : 1 }})`;
    await sql`insert into answers (session_id,question_id,school_id,answer) values (${"ses" + n},'q2','S',${{ text: n >= 6 ? " X" : "y" }})`;
    await sql`insert into answers (session_id,question_id,school_id,answer) values (${"ses" + n},'q3','S',${{ selected: [2, 0] }})`;
  }
  return sql;
}

test("ntile4 sama dengan Postgres", () => {
  assert.deepEqual(ntile4(8), [1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual(ntile4(6), [1, 1, 2, 2, 3, 4]);
  assert.deepEqual(ntile4(2), [1, 2]);
  assert.deepEqual(ntile4(0), []);
});

test("looseCorrect: pgk_centang himpunan sama persis, uraian >= 50%, basic membatasi tipe", () => {
  assert.equal(looseCorrect("pgk_centang", { correct: [0, 2] }, { selected: [2, 0] }, 1), true);
  assert.equal(looseCorrect("pgk_centang", { correct: [0, 2] }, { selected: [0] }, 1), false);
  assert.equal(looseCorrect("pgk_centang", { correct: [0, 2] }, { selected: [2, 0] }, 1, true), false);
  assert.equal(looseCorrect("uraian", null, { manual_score: 2 }, 4), true);
  assert.equal(looseCorrect("uraian", null, { manual_score: 1 }, 4), false);
  assert.equal(looseCorrect("simulasi", null, { manual_score: 9 }, 4), false);
});

test("categoryStatsD1: per kategori, urut nama", async () => {
  const sql = await seed();
  // st6 (kelas campur): c1 = q1 benar + q2 benar; c2 = q3 benar
  assert.deepEqual(await categoryStatsD1(sql, "st6"), [
    { category: "Aljabar", total: 2, benar: 2 }, { category: "Geometri", total: 1, benar: 1 }]);
  assert.deepEqual(await categoryStatsD1(sql, "st1"), [
    { category: "Aljabar", total: 2, benar: 0 }, { category: "Geometri", total: 1, benar: 1 }]);
});

test("weakCategoriesD1: >=2 jawaban dan <70%, hanya tipe dasar", async () => {
  const sql = await seed();
  assert.deepEqual(await weakCategoriesD1(sql, "st1"), [{ cat_id: "c1", category: "Aljabar", total: 2, benar: 0 }]);
  assert.deepEqual(await weakCategoriesD1(sql, "st6"), []);
});

test("distractorRows (jalur D1): distribusi pilihan per soal", async () => {
  const sql = await seed();
  const rows = await distractorRows(sql, "E");
  assert.deepEqual(rows, [{
    id: "q1", text: "Soal q1", options: ["a", "b", "c"], correct_index: 1, total_answered: 8, distribution: { 0: 4, 1: 4 },
  }]);
});

test("itemRows (jalur D1): p-value dan daya pembeda (kuartil 4 - kuartil 1)", async () => {
  const sql = await seed();
  const rows = await itemRows(sql, "E");
  const by = Object.fromEntries(rows.map((r: any) => [r.id, r]));
  // q1: benar siswa 5-8 -> p=.5; Q4 (siswa 7,8) benar 2, Q1 (1,2) benar 0 -> (2-0)/8 = .25
  assert.deepEqual([by.q1.n, by.q1.p_value, by.q1.discrimination], [8, 0.5, 0.25]);
  // q2: benar siswa 6-8 -> p=.375; Q4 benar 2, Q1 0 -> .25
  assert.deepEqual([by.q2.p_value, by.q2.discrimination], [0.375, 0.25]);
  // q3: semua benar -> p=1; Q4 dan Q1 sama-sama 2 -> 0
  assert.deepEqual([by.q3.p_value, by.q3.discrimination], [1, 0]);
  assert.deepEqual(rows.map((r: any) => r.id), ["q2", "q1", "q3"]); // discrimination desc, lalu p_value asc (q1 dan q2 sama-sama 0.25)
  assert.equal(by.q1.type, "pg");
});

test("itemD1 tanpa jawaban: n=0, p=0, d=0", async () => {
  const sql = await seed();
  await sql`delete from answers`;
  const rows = await itemD1(sql, "E");
  assert.ok(rows.every((r) => r.n === 0 && r.p_value === 0 && r.discrimination === 0));
  assert.deepEqual(await distractorD1(sql, "E"), []);
});

test("orderLength: array, {order}, null", () => {
  assert.equal(orderLength(["a", "b"]), 2);
  assert.equal(orderLength({ order: ["a"], perms: {} }), 1);
  assert.equal(orderLength('{"order":["a","b","c"]}'), 3);
  assert.equal(orderLength(null), 0);
});

test("translator: make_interval, greatest, json_patch, cast integer, returning dengan subquery", async () => {
  const sql = await seed();
  await sql`update exam_sessions set deadline_at = '2026-01-01T10:00:00.000Z' where id = 'ses1'`;
  const [a] = await sql`update exam_sessions set deadline_at = deadline_at + make_interval(mins => ${15}) where id = 'ses1' returning deadline_at`;
  assert.equal(a.deadline_at, "2026-01-01T10:15:00.000Z");
  const [b] = await sql`update exam_sessions set deadline_at = deadline_at + make_interval(mins => ${-5}) where id = 'ses1' returning deadline_at`;
  assert.equal(b.deadline_at, "2026-01-01T10:10:00.000Z");
  const [g] = await sql`update exam_sessions set deadline_at = greatest(deadline_at, now() + interval '15 minutes') where id = 'ses1' returning deadline_at`;
  assert.ok(g.deadline_at > "2026-11-01"); // 'now' + 15 menit menang atas 2026-01-01
  const old = await sql`update exams set status = 'closed' where created_at < now() - make_interval(days => ${1}) returning id`;
  assert.equal(old.length, 0);
  // json_patch = || jsonb untuk patch skalar/array
  await sql`update answers set answer = coalesce(answer, '{}'::jsonb) || ${{ manual_score: 3 }} where session_id = 'ses1' and question_id = 'q1'`;
  const [pa] = await sql`select answer from answers where session_id = 'ses1' and question_id = 'q1'`;
  assert.deepEqual(pa.answer, { index: 0, manual_score: 3 }); // kolom JSON sudah diurai
  await sql`insert into answers (session_id,question_id,school_id,answer) values ('ses1','q3','S',${{ selected: [1] }})
    on conflict (session_id, question_id) do update set answer = coalesce(answers.answer, '{}'::jsonb) || ${{ selected: [4, 5], note: "n" }}, updated_at = now()`;
  const [pb] = await sql`select answer from answers where session_id = 'ses1' and question_id = 'q3'`;
  assert.deepEqual(pb.answer, { selected: [4, 5], note: "n" });
  const [p] = await sql`update exam_sessions set last_seen_at = now() where id = 'ses2' returning paused_at,
    cast((select count(*) from exam_messages m where m.session_id = exam_sessions.id and m.from_role = 'staff') as integer) as staff_msgs`;
  assert.equal(p.staff_msgs, 0);
});

test("jsonb: x - 'k' - 'k2' dan x ? 'k' diterjemahkan; kolom JSON diurai; chat tidak", async () => {
  const sql = await seed();
  await sql`update questions set content = ${{ text: "t", image: "i.png", audio: "a.mp3", html: "<b>", keep: 1 }} where id = 'q1'`;
  const [r] = await sql`select q.id, q.content - 'image' - 'audio' - 'html' as content, q.content ? 'image' as has_image,
    q.content ? 'nope' as has_nope from questions q where q.id = 'q1'`;
  assert.deepEqual(r.content, { text: "t", keep: 1 });
  assert.deepEqual([r.has_image, r.has_nope], [true, 0]); // has_image dikenal sebagai boolean, alias lain tetap angka
  await sql`insert into exam_messages (school_id,session_id,from_role,content) values ('S','ses1','staff','{"bukan":"json"}')`;
  const [m] = await sql`select content from exam_messages`;
  assert.equal(m.content, '{"bukan":"json"}'); // teks chat dibiarkan
  await assert.rejects(sql`select content - 'a b' from questions`, /jsonb/);
});
