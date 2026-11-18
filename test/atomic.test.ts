import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1Db } from "./fake-d1.ts";
import { connectD1, withTenantD1 } from "../src/d1.ts";
import { atomic } from "../src/dbfn.ts";
import { finalizeSession, createSession } from "../src/scoring.ts";

const S = "aaaaaaaa-0000-4000-8000-000000000001";

async function world() {
  const f = fakeD1Db();
  const open = connectD1(f.d1).unscoped();
  await open`insert into schools (id,code,name,level,operator_name,operator_phone) values (${S},'sek-a','A','SMA','o','1')`;
  await open`insert into classes (id,school_id,name,year) values ('cl',${S},'X','2026')`;
  await open`insert into students (id,school_id,class_id,name,username,pin_hash) values ('st',${S},'cl','N','u','h')`;
  await open`insert into exams (id,school_id,title,kind,duration_minutes,shuffle_options) values ('E',${S},'t','k',30,1)`;
  await open`insert into exam_classes (exam_id,class_id,school_id) values ('E','cl',${S})`;
  const qs: Array<[string, string, unknown, unknown]> = [
    ["q1", "pg", { text: "a", options: ["x", "y", "z"] }, { index: 1 }],
    ["q2", "dinamis_hitung", { text: "b", a: { min: 1, max: 5 }, b: { min: 1, max: 5 } }, { formula: "+" }],
  ];
  for (const [i, [id, type, content, key]] of qs.entries()) {
    await open`insert into questions (id,school_id,type,content,points) values (${id},${S},${type},${content},1)`;
    await open`insert into question_keys (question_id,school_id,answer_key) values (${id},${S},${key})`;
    await open`insert into exam_questions (exam_id,question_id,school_id,position) values ('E',${id},${S},${i + 1})`;
  }
  const asA = <T,>(fn: Parameters<typeof withTenantD1<T>>[2]) => withTenantD1(connectD1(f.d1), { schoolId: S, role: "student", userId: "st" }, fn);
  return { ...f, open, asA };
}
const failOn = (db: { exec(s: string): void }, table: string) =>
  db.exec(`create trigger boom_${table} before insert on ${table} begin select raise(abort, 'boom'); end`);

test("batch: semua penulisan masuk dalam satu transaksi; satu gagal membatalkan semuanya", async () => {
  const w = await world();
  const ok = await atomic(connectD1(w.d1).unscoped(), [
    (q) => q`insert into categories (school_id,name) values (${S},'a')`,
    (q) => q`insert into categories (school_id,name) values (${S},'b')`,
  ]);
  assert.deepEqual(ok.map((r) => r.count), [1, 1]);
  assert.equal(w.stats.batches, 1);
  await assert.rejects(atomic(connectD1(w.d1).unscoped(), [
    (q) => q`insert into categories (school_id,name) values (${S},'c')`,
    (q) => q`insert into categories (school_id,name) values (${S},'d')`,
    (q) => q`insert into classes (id,school_id,name,year) values ('cl',${S},'dup','2026')`, // PK kembar -> gagal
  ]));
  assert.deepEqual((await w.open`select name from categories order by name`).map((r) => r.name), ["a", "b"]); // c, d batal
});

test("batch: insert banyak baris (dipecah per 100 parameter) tetap satu transaksi", async () => {
  const w = await world();
  const rows = Array.from({ length: 120 }, (_, i) => ({ school_id: S, name: `K${i}` }));
  await assert.rejects(w.asA((tx) => atomic(tx, [
    (q) => q`insert into categories ${q(rows, "school_id", "name")}`,
    (q) => q`insert into classes (id,school_id,name,year) values ('cl',${S},'dup','2026')`,
  ])));
  assert.equal((await w.open`select count(*) as n from categories`)[0].n, 0); // 120 baris ikut batal
  const r = await w.asA((tx) => atomic(tx, [(q) => q`insert into categories ${q(rows, "school_id", "name")}`]));
  assert.equal(r[0].count, 120);
});

test("batch tetap kena batas sekolah: insert/ubah sekolah lain ditolak dan tak ada yang tertulis", async () => {
  const w = await world();
  await assert.rejects(w.asA((tx) => atomic(tx, [
    (q) => q`insert into categories (school_id,name) values (${S},'ok')`,
    (q) => q`insert into categories (school_id,name) values (${"bbbbbbbb-0000-4000-8000-000000000002"},'bocor')`,
  ])), /sekolah lain/);
  assert.equal((await w.open`select count(*) as n from categories`)[0].n, 0);
});

test("ganti soal ujian (hapus + isi ulang): gagal di tengah tidak menghapus soal lama", async () => {
  const w = await world();
  failOn(w.db, "exam_questions");
  const rows = [{ exam_id: "E", question_id: "q1", school_id: S, position: 1 }];
  await assert.rejects(w.asA((tx) => atomic(tx, [
    (q) => q`delete from exam_questions where exam_id = ${"E"}`,
    (q) => q`insert into exam_questions ${q(rows, "exam_id", "question_id", "school_id", "position")}`,
  ])), /boom/);
  assert.equal((await w.open`select count(*) as n from exam_questions`)[0].n, 2); // soal lama utuh
});

test("Neon: atomic menjalankan langkah berurutan pada tx biasa", async () => {
  const log: string[] = [];
  const tx: any = (s: TemplateStringsArray) => { log.push(s.join("?").trim()); return Promise.resolve([{ ok: 1 }]); };
  const r = await atomic(tx, [(q) => q`delete from a`, (q) => q`insert into a (x) values (1)`]);
  assert.deepEqual(log, ["delete from a", "insert into a (x) values (1)"]);
  assert.equal(r.length, 2);
});

test("createSession D1: sesi + angka acak soal dinamis satu transaksi", async () => {
  const w = await world();
  const id = await w.asA((tx) => createSession(tx, S, "E", "st"));
  const ses = await w.open`select id, status, question_order from exam_sessions`;
  assert.equal(ses.length, 1); assert.equal(ses[0].id, id);
  assert.equal((ses[0].question_order as any).order.length, 2);
  assert.equal((ses[0].question_order as any).perms.q1.length, 3); // opsi diacak
  const [a] = await w.open`select question_id, answer from answers`;
  assert.equal(a.question_id, "q2");
  assert.ok((a.answer as any).vars.a >= 1 && (a.answer as any).vars.b <= 5);
});

test("createSession D1: gagal menyimpan angka soal dinamis -> sesi tidak ikut terbuat", async () => {
  const w = await world();
  failOn(w.db, "answers");
  await assert.rejects(w.asA((tx) => createSession(tx, S, "E", "st")), /boom/);
  assert.equal((await w.open`select count(*) as n from exam_sessions`)[0].n, 0);
});

async function sessionWithAnswer(w: Awaited<ReturnType<typeof world>>) {
  const id = await w.asA((tx) => createSession(tx, S, "E", "st"));
  await w.open`insert into answers (session_id,question_id,school_id,answer) values (${id},'q1',${S},${{ index: 1 }})`;
  return id;
}

test("finalizeSession D1: sesi ditutup dan nilai tersimpan dalam satu batch", async () => {
  const w = await world();
  const id = await sessionWithAnswer(w);
  const before = w.stats.batches;
  const r = await w.asA((tx) => finalizeSession(tx, id, "submitted"));
  assert.equal(w.stats.batches, before + 1);
  assert.equal(r.score, 50); // q1 benar (1 dari 2 poin), q2 tak dijawab
  const [ses] = await w.open`select status, finished_at from exam_sessions where id = ${id}`;
  assert.equal(ses.status, "submitted"); assert.ok(ses.finished_at);
  assert.equal((await w.open`select final_score from scores where session_id = ${id}`)[0].final_score, 50);
});

test("finalizeSession D1: gagal simpan nilai -> sesi TIDAK menjadi submitted", async () => {
  const w = await world();
  const id = await sessionWithAnswer(w);
  failOn(w.db, "scores");
  await assert.rejects(w.asA((tx) => finalizeSession(tx, id, "submitted")), /boom/);
  assert.equal((await w.open`select status from exam_sessions where id = ${id}`)[0].status, "active");
});

test("finalizeSession D1 dengan langkah 'before' (pelanggaran): semuanya atau tidak sama sekali", async () => {
  const w = await world();
  const id = await sessionWithAnswer(w);
  const before = [
    (q: any) => q`insert into violations (school_id, session_id, kind) values (${S}, ${id}, 'tab_blur')`,
    (q: any) => q`update exam_sessions set violation_count = 3, lock_count = lock_count + 1 where id = ${id}`,
  ];
  failOn(w.db, "scores");
  await assert.rejects(w.asA((tx) => finalizeSession(tx, id, "submitted", before)), /boom/);
  assert.equal((await w.open`select count(*) as n from violations`)[0].n, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(await w.open`select status, violation_count from exam_sessions where id = ${id}`)), [{ status: "active", violation_count: 0 }]);
  w.db.exec("drop trigger boom_scores");
  await w.asA((tx) => finalizeSession(tx, id, "submitted", before));
  assert.equal((await w.open`select count(*) as n from violations`)[0].n, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(await w.open`select status, violation_count, lock_count from exam_sessions where id = ${id}`)), [{ status: "submitted", violation_count: 3, lock_count: 1 }]);
});
