import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { connectD1 } from "../src/d1.ts";
import { scoreItems, scoreItem, jsonEq, type Item } from "../src/score.ts";

const it = (o: Partial<Item> & { type: string }): Item => ({ points: 1, weight: 1, penalty: 0, key: null, ans: null, ...o });

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(readFileSync(new URL("../db/d1/0001_init.sql", import.meta.url), "utf8"));
  return { prepare: (sql: string) => ({ bind: (...p: unknown[]) => ({ all: async () => {
    const st = db.prepare(sql);
    if (st.columns().length) return { results: st.all(...(p as never[])), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(st.run(...(p as never[])).changes) } };
  } }) }) } as unknown as D1Database;
}

// Fixture sama dengan db/tests/score_session.sql; hasil acuan: got 5.25, total 13, pending 2.
test("fixture db/tests/score_session.sql di D1 = 5.25 / 13 / 2", async () => {
  const sql = connectD1(fakeD1());
  const S = "s1", E = "e1", ST = "st1", SES = "f1";
  await sql`insert into schools (id,code,name,level,operator_name,operator_phone) values (${S},'tes-nilai','Tes','SMA','Op','081')`;
  await sql`insert into students (id,school_id,name,username,pin_hash) values (${ST},${S},'Siswa','s1','x')`;
  await sql`insert into exams (id,school_id,title,kind,duration_minutes,scoring_config) values (${E},${S},'Tes','harian',60,${'{"wrong_penalty": 0.25}'})`;
  const qs: Array<[string, string, number, unknown, unknown]> = [
    ["q1", "pg", 2, { index: 1 }, { index: 1 }],
    ["q2", "pg", 1, { index: 0 }, { index: 3 }],
    ["q3", "isian", 1, { accepted: ["jakarta"] }, { text: "  Jakarta " }],
    ["q4", "pgk_centang", 2, { correct: [0, 2] }, { selected: [0, 1] }],
    ["q5", "benar_salah", 1, { index: 0 }, { index: 0, hint_used: true }],
    ["q6", "uraian", 3, null, { text: "esai", manual_score: 2 }],
    ["q7", "simulasi", 2, null, { state: {} }],
    ["q8", "pg", 1, { index: 0 }, undefined],
  ];
  let pos = 0;
  for (const [id, type, pts, key, ans] of qs) {
    await sql`insert into questions (id,school_id,type,content,points) values (${id},${S},${type},${'{"text":"x"}'},${pts})`;
    if (key) await sql`insert into question_keys (question_id,school_id,answer_key) values (${id},${S},${key})`;
    await sql`insert into exam_questions (exam_id,question_id,school_id,position) values (${E},${id},${S},${++pos})`;
  }
  await sql`insert into exam_sessions (id,school_id,exam_id,student_id,deadline_at) values (${SES},${S},${E},${ST},now())`;
  for (const [id, , , , ans] of qs) if (ans) await sql`insert into answers (session_id,question_id,school_id,answer) values (${SES},${id},${S},${ans})`;
  const { scoreSession } = await import("../src/score.ts");
  assert.deepEqual(await scoreSession(sql, SES), { got: 5.25, total: 13, manual_pending: 2 });
});

test("pool soal: question_order objek {order} membatasi soal yang dihitung", async () => {
  const sql = connectD1(fakeD1());
  await sql`insert into schools (id,code,name,level,operator_name,operator_phone) values ('s','aaa','S','SMA','o','1')`;
  await sql`insert into students (id,school_id,name,username,pin_hash) values ('st','s','n','u','x')`;
  await sql`insert into exams (id,school_id,title,kind,duration_minutes) values ('e','s','t','k',10)`;
  for (const id of ["a", "b"]) {
    await sql`insert into questions (id,school_id,type,content,points) values (${id},'s','pg','{}',1)`;
    await sql`insert into question_keys (question_id,school_id,answer_key) values (${id},'s',${{ index: 0 }})`;
    await sql`insert into exam_questions (exam_id,question_id,school_id,position) values ('e',${id},'s',1)`;
  }
  await sql`insert into exam_sessions (id,school_id,exam_id,student_id,deadline_at,question_order) values ('x','s','e','st',now(),${{ order: ["a"], perms: {} }})`;
  const { scoreSession } = await import("../src/score.ts");
  assert.deepEqual(await scoreSession(sql, "x"), { got: 0, total: 1, manual_pending: 0 });
});

test("pg/benar_salah: benar, salah kena penalti, kosong 0, tanpa kunci tetap kena penalti", () => {
  const base = { type: "pg", points: 2, penalty: 0.25 };
  assert.equal(scoreItem(it({ ...base, key: { index: 1 }, ans: { index: 1 } })), 2);
  assert.equal(scoreItem(it({ ...base, key: { index: 1 }, ans: { index: 0 } })), -0.5);
  assert.equal(scoreItem(it({ ...base, key: { index: 1 }, ans: null })), 0);
  assert.equal(scoreItem(it({ ...base, key: null, ans: { index: 0 } })), -0.5);
  assert.equal(scoreItem(it({ ...base, key: { index: "1" }, ans: { index: 1 } })), 2);
});

test("isian: abaikan spasi/kapital, banyak jawaban diterima, kosong salah", () => {
  const k = { accepted: ["Jakarta", "dki jakarta"] };
  assert.equal(scoreItem(it({ type: "isian", key: k, ans: { text: " DKI Jakarta " } })), 1);
  assert.equal(scoreItem(it({ type: "isian", key: k, ans: { text: "Bandung" } })), 0);
  assert.equal(scoreItem(it({ type: "isian", key: k, ans: {} })), 0);
});

test("pgk_centang: parsial, salah centang mengurangi, tidak di bawah 0", () => {
  const key = { correct: [0, 2, 3] };
  assert.ok(Math.abs(scoreItem(it({ type: "pgk_centang", points: 3, key, ans: { selected: [0, 2] } })) - 2) < 1e-9);
  assert.equal(scoreItem(it({ type: "pgk_centang", points: 3, key, ans: { selected: [0, 1, 4] } })), 0);
  assert.equal(scoreItem(it({ type: "pgk_centang", points: 3, key: { correct: [] }, ans: { selected: [] } })), 0);
});

test("pgk_kategori: sebanding jumlah pernyataan tepat", () => {
  const key = { values: ["B", "S", "B", "S"] };
  assert.equal(scoreItem(it({ type: "pgk_kategori", points: 4, key, ans: { cats: ["B", "S", "S", "S"] } })), 3);
  assert.equal(scoreItem(it({ type: "pgk_kategori", points: 4, key, ans: null })), 0);
});

test("menjodohkan: kesetaraan jsonb (urutan kunci objek bebas, urutan array tidak)", () => {
  assert.ok(jsonEq({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }));
  assert.ok(!jsonEq([1, 2], [2, 1]));
  assert.equal(scoreItem(it({ type: "menjodohkan", points: 2, key: { pairs: { a: "1", b: "2" } }, ans: { pairs: { b: "2", a: "1" } } })), 2);
  assert.equal(scoreItem(it({ type: "menjodohkan", points: 2, key: { pairs: { a: "1" } }, ans: { pairs: { a: "2" } } })), 0);
});

test("dinamis_hitung: empat operasi, desimal, bagi nol", () => {
  const d = (formula: string, a: number, b: number, text: string) =>
    scoreItem(it({ type: "dinamis_hitung", points: 1, key: { formula }, ans: { vars: { a, b }, text } }));
  assert.equal(d("+", 2, 3, "5"), 1);
  assert.equal(d("-", 2, 3, "-1"), 1);
  assert.equal(d("*", 4, 3, "12"), 1);
  assert.equal(d("/", 8, 2, "4"), 1);
  assert.equal(d("+", 0.1, 0.2, "0.3"), 1);
  assert.equal(d("/", 1, 0, "0"), 0);
  assert.equal(d("+", 2, 3, ""), 0);
  assert.equal(d("+", 2, 3, "abc"), 0);
});

test("uraian/simulasi: nilai manual tanpa bobot, pending bila belum dinilai; petunjuk ×0.5; bobot kategori", () => {
  const r = scoreItems([
    it({ type: "uraian", points: 3, weight: 2, ans: { manual_score: 2 } }),
    it({ type: "simulasi", points: 2, ans: { state: {} } }),
    it({ type: "uraian", points: 1, ans: null }),
    it({ type: "pg", points: 1, weight: 2, key: { index: 0 }, ans: { index: 0, hint_used: true } }),
  ]);
  assert.deepEqual(r, { got: 3, total: 11, manual_pending: 3 });
});

test("jumlah desimal tidak berdebu floating point", () => {
  const r = scoreItems(Array.from({ length: 3 }, () => it({ type: "pg", points: 0.1, key: { index: 0 }, ans: { index: 0 } })));
  assert.equal(r.got, 0.3);
});
