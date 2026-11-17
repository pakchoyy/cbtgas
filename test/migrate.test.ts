import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ORDER, SKIP, parseSchema, literal, insertSql, parentsFirst, countQuery, compareCounts } from "../scripts/migrate-lib.mjs";
import { fakeD1Db } from "./fake-d1.ts";
import { connectD1 } from "../src/d1.ts";

const schemaSql = readFileSync(new URL("../db/d1/0001_init.sql", import.meta.url), "utf8");
const schema = parseSchema(schemaSql);
const T = (n: string) => schema.find((t: any) => t.name === n)!;

test("daftar tabel & kolom mengikuti skema D1 (tak ada yang terlewat atau berlebih)", () => {
  const db = new DatabaseSync(":memory:"); db.exec(schemaSql);
  const real = (db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all() as any[]).map((r) => r.name).sort();
  assert.deepEqual([...ORDER, ...SKIP].sort(), real);
  for (const t of schema) {
    const cols = (db.prepare(`pragma table_info(${t.name})`).all() as any[]).map((c) => c.name);
    assert.deepEqual(t.cols.map((c: any) => c.name), cols, `kolom ${t.name}`);
  }
  assert.ok(T("questions").cols.find((c: any) => c.name === "content").json);
  assert.ok(T("users").cols.find((c: any) => c.name === "active").bool);
  assert.equal(T("scores").cols.find((c: any) => c.name === "final_score").type, "real");
});

test("literal: tipe Postgres -> literal SQLite", () => {
  const col = (name: string, type: string, extra = {}) => ({ name, type, json: false, bool: false, ...extra });
  assert.equal(literal(null, col("x", "text")), "NULL");
  assert.equal(literal("it's", col("x", "text")), "'it''s'");
  assert.equal(literal(new Date("2026-01-02T03:04:05Z"), col("x", "text")), "'2026-01-02T03:04:05.000Z'");
  assert.equal(literal("66.70", col("x", "real")), "66.7");
  assert.equal(literal("9007199254", col("x", "integer")), "9007199254");
  assert.equal(literal(true, col("x", "integer", { bool: true })), "1");
  assert.equal(literal(false, col("x", "integer", { bool: true })), "0");
  assert.equal(literal({ a: "o'k", b: [1, null] }, col("x", "text", { json: true })), `'{"a":"o''k","b":[1,null]}'`);
  assert.equal(literal("teks", col("x", "text", { json: true })), `'"teks"'`);
  assert.throws(() => literal("abc", col("x", "real")), /angka tidak valid/);
  assert.throws(() => literal(new Date("x"), col("x", "text")), /tanggal tidak valid/);
});

test("parentsFirst: induk kategori lebih dulu walau urutan sumber terbalik", () => {
  const rows = [{ id: "c", parent_id: "b" }, { id: "b", parent_id: "a" }, { id: "a", parent_id: null }, { id: "z", parent_id: null }];
  const out = parentsFirst(rows).map((r: any) => r.id);
  assert.ok(out.indexOf("a") < out.indexOf("b") && out.indexOf("b") < out.indexOf("c"));
  assert.equal(out.length, 4);
});

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const d = (s: string) => new Date(s);

test("round trip: baris bergaya Neon masuk ke D1 lewat SQL hasil skrip, tipe benar, FK utuh, aplikasi bisa membacanya", async () => {
  const rows: Record<string, any[]> = {
    schools: [{ id: U(1), code: "sek-a", name: "SMA O'Brien", level: "SMA", npsn: null, logo_key: null, color: "biru", operator_name: "Op", operator_phone: "081",
      plan: "trial", student_quota: 300, concurrent_quota: 300, active: true, privacy_consent_at: d("2026-01-01T00:00:00Z"), created_at: d("2026-01-01T00:00:00Z") }],
    users: [{ id: U(2), school_id: U(1), email: "a@b.id", name: null, role: "admin", google_sub: "g", active: true, created_at: d("2026-01-01T00:00:00Z") }],
    system_owners: [{ id: U(3), email: "owner@x.id" }],
    classes: [{ id: U(4), school_id: U(1), name: "XI-1", grade: 11, year: "2026" }],
    students: [{ id: U(5), school_id: U(1), class_id: U(4), name: "Budi", nisn: null, gender: "L", username: "budi", pin_hash: "h", qr_token_hash: null, photo_key: null,
      guardian_email: null, pin_failed_count: 0, locked_until: null, active: true, created_at: d("2026-01-01T00:00:00Z") }],
    pin_resets: [],
    categories: [{ id: U(7), school_id: U(1), name: "Anak", parent_id: U(6) }, { id: U(6), school_id: U(1), name: "Induk", parent_id: null }],
    passages: [{ id: U(8), school_id: U(1), title: null, body: "bacaan" }],
    questions: [{ id: U(9), school_id: U(1), author_id: U(2), category_id: U(6), passage_id: U(8), type: "pg", content: { text: "1+1?", options: ["1", "2"] },
      points: "2.50", created_at: d("2026-01-01T00:00:00Z"), updated_at: d("2026-01-02T00:00:00Z") }],
    question_keys: [{ question_id: U(9), school_id: U(1), answer_key: { index: 1 }, rubric: null }],
    exam_groups: [{ id: U(10), school_id: U(1), title: "G", description: null, strict_order: true, created_at: d("2026-01-01T00:00:00Z") }],
    exams: [{ id: U(11), school_id: U(1), creator_id: U(2), title: "Ulangan", kind: "harian", duration_minutes: 30, shuffle_questions: false, shuffle_options: true,
      anticheat_level: "warn", lock_after_violations: 3, token_hash: null, use_token: false, show_score: true, questions_per_session: 0, scoring_config: { wrong_penalty: 0.25 },
      group_id: U(10), group_position: 1, starts_at: d("2026-02-01T01:00:00Z"), ends_at: d("2026-02-01T02:00:00Z"), status: "open", created_at: d("2026-01-01T00:00:00Z") }],
    exam_classes: [{ exam_id: U(11), class_id: U(4), school_id: U(1) }],
    exam_questions: [{ exam_id: U(11), question_id: U(9), school_id: U(1), position: 1, weight: "1.00" }],
    exam_sessions: [{ id: U(12), school_id: U(1), exam_id: U(11), student_id: U(5), started_at: d("2026-02-01T01:05:00Z"), deadline_at: d("2026-02-01T01:35:00Z"),
      finished_at: d("2026-02-01T01:30:00Z"), last_seen_at: null, paused_at: null, status: "submitted", violation_count: 1, unlock_code: null, unlock_tries: 0, lock_count: 0,
      question_order: { order: [U(9)], perms: { [U(9)]: [1, 0] } } }],
    answers: [{ session_id: U(12), question_id: U(9), school_id: U(1), answer: { index: 1, note: "it's ok" }, flagged: false, client_seq: "5", updated_at: d("2026-02-01T01:20:00Z") }],
    violations: [{ id: "7", school_id: U(1), session_id: U(12), kind: "tab_blur", occurred_at: d("2026-02-01T01:10:00Z") }],
    scores: [{ session_id: U(12), school_id: U(1), exam_id: U(11), student_id: U(5), auto_score: "66.67", manual_score: null, final_score: "66.67", approved_by: null, approved_at: null }],
    exam_messages: [{ id: "3", school_id: U(1), session_id: U(12), from_role: "student", from_name: "Budi", content: "{\"bukan\":\"json\"} it's", created_at: d("2026-02-01T01:11:00Z") }],
    audit_log: [{ id: "1", school_id: U(1), actor_id: U(2), actor_email: "a@b.id", actor_role: "admin", action: "exam.open", entity: "exam", entity_id: U(11), details: { title: "Ulangan" }, created_at: d("2026-02-01T00:59:00Z") }],
    shared_banks: [{ id: U(13), school_id: U(1), slug: "bank-1", title: "Bank", description: null, payload: { questions: [1, 2] }, download_count: "4", created_by: U(2), created_at: d("2026-01-03T00:00:00Z") }],
  };
  const f = fakeD1Db();
  for (const name of ORDER) {
    let r = rows[name] ?? [];
    if (name === "categories") r = parentsFirst(r);
    for (const stmt of insertSql(T(name), r)) f.db.exec(stmt); // FK aktif: gagal bila urutan/tipe salah
  }
  const sql = connectD1(f.d1).unscoped();
  assert.equal((await sql`select count(*) as n from questions`)[0].n, 1);
  const [q] = await sql`select content, points from questions`;
  assert.deepEqual(q.content, { text: "1+1?", options: ["1", "2"] });
  assert.equal(q.points, 2.5);
  const [e] = await sql`select starts_at, shuffle_options, show_score, scoring_config from exams`;
  assert.deepEqual([e.starts_at, e.shuffle_options, e.show_score, e.scoring_config], ["2026-02-01T01:00:00.000Z", true, true, { wrong_penalty: 0.25 }]);
  assert.equal((await sql`select name from schools`)[0].name, "SMA O'Brien");
  assert.deepEqual((await sql`select answer, client_seq from answers`)[0].answer, { index: 1, note: "it's ok" });
  assert.equal((await sql`select content from exam_messages`)[0].content, "{\"bukan\":\"json\"} it's"); // teks chat utuh
  // hitungan: kueri hitung yang sama berjalan di D1 dan mencocokkan hitungan sumber
  const counts: Record<string, number> = {};
  for (const n of ORDER) counts[n] = rows[n].length;
  counts["scores.sum_final"] = 66.67; counts["answers.with_json"] = 1;
  const got = Object.fromEntries((f.db.prepare(countQuery(ORDER.map((n) => T(n)))).all() as any[]).map((r: any) => [r.t, r.n]));
  assert.deepEqual(compareCounts(counts, got), []);
  assert.deepEqual(compareCounts({ ...counts, schools: 2 }, got), ["schools: Neon=2 D1=1"]);
});

test("teks sangat panjang (logo data URI) dipecah agar tiap statement < 100 KB, hasil utuh", () => {
  const db = new DatabaseSync(":memory:"); db.exec(schemaSql);
  const logo = "data:image/png;base64," + "A'😀".repeat(30000);
  const stmts = insertSql(T("schools"), [{ id: "s1", code: "sma-x", name: "X", level: "SMA", logo_key: logo, operator_name: "o",
    operator_phone: "1", color: "biru", plan: "trial", student_quota: 1, concurrent_quota: 1, active: true, created_at: "2026-01-01T00:00:00Z" }]);
  assert.ok(stmts.length > 1);
  for (const s of stmts) { assert.ok(Buffer.byteLength(s) < 100_000); db.exec(s); }
  assert.equal((db.prepare("select logo_key from schools").get() as any).logo_key, logo);
});

test("JSON sangat panjang (gambar/audio soal, isi bank publik) dirakit bertahap: tiap statement < 100 KB, CHECK json_valid lolos, hasil utuh", () => {
  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); db.exec(schemaSql);
  db.exec("insert into schools (id,code,name,level,operator_name,operator_phone) values ('s1','sma-x','X','SMA','o','1')");
  const img = "data:image/png;base64," + "Qm9v".repeat(60000); // ~240 KB
  const content = { text: "Perhatikan gambar 'ini' 😀", image: img, audio: "data:audio/mpeg;base64," + "QUFB".repeat(40000), options: ["a", "b"] };
  const stmts = [
    ...insertSql(T("questions"), [{ id: "q1", school_id: "s1", type: "pg", content, points: 1, created_at: new Date(), updated_at: new Date() }]),
    ...insertSql(T("question_keys"), [{ question_id: "q1", school_id: "s1", answer_key: { index: 0, note: "x".repeat(150000) }, rubric: null }]),
    ...insertSql(T("shared_banks"), [{ id: "b1", school_id: "s1", slug: "bank-1", title: "B", payload: { questions: [content, content] }, download_count: 0, created_at: new Date() }]),
  ];
  assert.ok(stmts.length > 20);
  for (const st of stmts) { assert.ok(Buffer.byteLength(st) < 100_000, `statement ${Buffer.byteLength(st)} byte`); db.exec(st); }
  assert.deepEqual(JSON.parse((db.prepare("select content from questions").get() as any).content), content);
  assert.equal(JSON.parse((db.prepare("select answer_key from question_keys").get() as any).answer_key).note.length, 150000);
  assert.deepEqual(JSON.parse((db.prepare("select payload from shared_banks").get() as any).payload), { questions: [content, content] });
  assert.equal((db.prepare("select count(*) as n from sqlite_master where name = '_mig_buf'").get() as any).n, 0); // penampung dibersihkan
});
