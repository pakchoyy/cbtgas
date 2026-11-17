// End-to-end: aplikasi Hono SUNGGUHAN (index.ts) berjalan di atas D1 palsu (DB_BACKEND=d1). Hyperdrive sengaja
// diarahkan ke alamat tak valid: bila ada rute yang diam-diam masih memakai Neon, tes ini gagal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1Db } from "./fake-d1.ts";
import { connectD1 } from "../src/d1.ts";
import { hashPin } from "../src/hash.ts";

(globalThis as any).caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };
const { default: worker } = await import("../src/index.ts");

const SID = "aaaaaaaa-0000-4000-8000-000000000001";
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function boot() {
  const f = fakeD1Db();
  const open = connectD1(f.d1).unscoped();
  const env: any = {
    DB_BACKEND: "d1", DB: f.d1, HYPERDRIVE: { get connectionString(): string { throw new Error("NEON DIPAKAI padahal DB_BACKEND=d1"); } },
    SESSION_SECRET: "x".repeat(48), APP_ENV: "production", DEMO_LOGIN: "1", APP_ORIGIN: "https://t.test",
    GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s",
  };
  await open`insert into schools (id,code,name,level,operator_name,operator_phone) values (${SID},'demo-sma','SMA Demo','SMA','Op','081')`;
  await open`insert into users (id,school_id,email,role) values ('adm',${SID},'admin@demo.id','admin')`;
  await open`insert into classes (id,school_id,name,grade,year) values ('cl',${SID},'XI-1',11,'2026')`;
  await open`insert into students (id,school_id,class_id,name,username,pin_hash) values ('st',${SID},'cl','Siswa Satu','siswa1',${await hashPin("123456")})`;
  await open`insert into categories (id,school_id,name) values ('cat',${SID},'Aljabar')`;
  await open`insert into exams (id,school_id,title,kind,duration_minutes,status) values ('E',${SID},'Ulangan 1','harian',30,'open')`;
  await open`insert into exam_classes (exam_id,class_id,school_id) values ('E','cl',${SID})`;
  const qs: Array<[string, string, unknown, unknown]> = [
    ["q1", "pg", { text: "1+1?", options: ["1", "2", "3"] }, { index: 1 }],
    ["q2", "isian", { text: "Ibu kota?" }, { accepted: ["jakarta"] }],
    ["q3", "pgk_centang", { text: "Genap?", options: ["0", "1", "2"] }, { correct: [0, 2] }],
  ];
  for (const [i, [id, type, content, key]] of qs.entries()) {
    await open`insert into questions (id,school_id,type,content,points,category_id) values (${id},${SID},${type},${content},1,'cat')`;
    await open`insert into question_keys (question_id,school_id,answer_key) values (${id},${SID},${key})`;
    await open`insert into exam_questions (exam_id,question_id,school_id,position) values ('E',${id},${SID},${i + 1})`;
  }
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const h = new Headers(init.headers); if (init.cookie) h.set("Cookie", init.cookie);
    return worker.fetch(new Request("https://t.test" + path, { ...init, headers: h, redirect: "manual" }), env, ctx);
  };
  const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
  return { ...f, open, env, call, cookieOf };
}

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const jsonOf = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

test("alur siswa penuh di D1: login, mulai, jawab, pelanggaran, pesan, kumpul, nilai, riwayat", async () => {
  const w = await boot();
  const bad = await w.call("/s/login", json({ username: "siswa1", pin: "000000" }));
  assert.equal(bad.status, 401);
  const lg = await w.call("/s/login", json({ username: "siswa1", pin: "123456" }));
  assert.equal(lg.status, 200);
  const cookie = w.cookieOf(lg);
  assert.match(cookie, /^cbt_sstu=/);
  assert.equal((await w.call("/s", { cookie })).status, 200);

  const start = await w.call("/s/exams/E/start", { method: "POST", cookie, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" });
  assert.equal(start.status, 302);
  const loc = start.headers.get("location")!;
  assert.match(loc, /^\/s\/take\/[0-9a-f-]{36}$/, `redirect: ${loc}`);
  const sid = loc.split("/").pop()!;
  assert.equal((await w.call(loc, { cookie })).status, 200);

  const ans = await w.call(`/s/take/${sid}/answers`, { ...json({ answers: [
    { question_id: "q1", index: 1 }, { question_id: "q2", text: " Jakarta " }, { question_id: "q3", selected: [0, 2] }] }), cookie });
  assert.deepEqual(await jsonOf(ans), { ok: true, saved: 3 });
  // jawaban ulang menggabung (json_patch), tidak menimpa kunci lain
  await w.call(`/s/take/${sid}/answers`, { ...json({ answers: [{ question_id: "q1", index: 1, note: "yakin" }] }), cookie });
  const [q1] = await w.open`select answer from answers where session_id = ${sid} and question_id = 'q1'`;
  assert.deepEqual(q1.answer, { index: 1, note: "yakin" });

  assert.equal((await w.call(`/s/take/${sid}/ping`, { method: "POST", cookie })).status, 200);
  assert.equal((await w.call(`/s/take/${sid}/messages`, { cookie })).status, 200);
  assert.equal((await w.call(`/s/take/${sid}/message`, { ...json({ content: "izin ke toilet" }), cookie })).status, 200);
  const v = await jsonOf(await w.call(`/s/take/${sid}/violation`, { ...json({ kind: "tab_blur" }), cookie }));
  assert.equal(v.ok, true); assert.equal(v.count, 1);
  assert.equal((await w.open`select count(*) as n from violations`)[0].n, 1);

  const sub = await jsonOf(await w.call(`/s/take/${sid}/submit`, { method: "POST", cookie }));
  assert.equal(sub.ok, true);
  assert.equal(sub.score, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(await w.open`select status from exam_sessions where id = ${sid}`)), [{ status: "submitted" }]);
  assert.equal((await w.open`select final_score from scores where session_id = ${sid}`)[0].final_score, 100);
  const again = await jsonOf(await w.call(`/s/take/${sid}/submit`, { method: "POST", cookie }));
  assert.equal(again.already, true);

  for (const p of [`/s/done/${sid}`, "/s/history", `/s/history/${sid}`, "/s/rekomendasi", "/s/me", "/s"]) {
    const r = await w.call(p, { cookie });
    assert.equal(r.status, 200, `${p} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  assert.equal(w.stats.queries > 0, true);
});

test("semua halaman dan API GET staf (rute asli, id nyata) tidak error di D1", async () => {
  const w = await boot();
  const lg = await w.call("/auth/dev-login", { method: "POST" });
  assert.equal(lg.status, 302);
  const cookie = w.cookieOf(lg);
  // satu sesi selesai agar halaman per-sesi/per-siswa punya data
  const stu = await w.call("/s/login", json({ username: "siswa1", pin: "123456" }));
  const sc = w.cookieOf(stu);
  const st = await w.call("/s/exams/E/start", { method: "POST", cookie: sc, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" });
  const sid = st.headers.get("location")!.split("/").pop()!;
  await w.call(`/s/take/${sid}/answers`, { ...json({ answers: [{ question_id: "q1", index: 0 }, { question_id: "q2", text: "Jakarta" }] }), cookie: sc });
  await w.call(`/s/take/${sid}/submit`, { method: "POST", cookie: sc });

  const get = [
    "/app", "/app/students", "/app/exam-groups", "/app/exams", "/app/settings", "/app/exams/new", "/app/exams/E", "/app/pin-resets",
    "/app/exams/E/uraian", "/app/exams/E/admin", "/app/exams/E/print", `/app/sessions/${sid}/certificate`, "/app/students/st/report",
    "/app/students/st/analytics", "/app/restore", "/app/bulk", "/app/audit", "/app/users", "/app/shared-banks", "/app/passages",
    "/app/exams/E/lab", "/app/exams/E/insights", "/app/exams/E/items", "/app/exams/E/live", "/app/categories", `/app/sessions/${sid}/grade`,
    "/app/questions", "/api/classes", "/api/overview", "/api/users", "/api/categories", "/api/passages", "/api/questions", "/api/pin-resets",
    "/api/public-banks", "/api/shared-banks", "/api/questions/export.csv", "/api/questions/q1", "/api/exam-groups", "/api/exams",
    "/api/students", "/api/students/st/analytics", `/api/sessions/${sid}/messages`, "/api/exams/E/chats", "/api/exams/E/live",
    "/api/exams/E/scores.csv", "/api/reports/backup.json", "/api/reports/rekap.xlsx", "/api/reports/scores.csv", "/api/exams/E/distractors",
    "/api/exams/E/items", "/api/exams/E/summary", "/api/exams/E/scores", "/auth/me", "/health", "/brand.css", "/logo",
  ];
  const bad: string[] = [], seen: Record<string, number> = {};
  for (const p of get) {
    const r = await w.call(p, { cookie });
    seen[r.status] = (seen[r.status] ?? 0) + 1;
    if (r.status >= 400 && !(p === "/logo" && r.status === 404)) bad.push(`${p} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  }
  assert.deepEqual(bad, []);
  assert.ok((seen[200] ?? 0) >= get.length - 2, JSON.stringify(seen));
});

test("penulisan staf lewat rute asli: ganti soal/kelas ujian (atomik), impor soal massal, waktu non-UTC dinormalkan", async () => {
  const w = await boot();
  const cookie = w.cookieOf(await w.call("/auth/dev-login", { method: "POST" }));
  const post = (p: string, body: unknown, method = "POST") => w.call(p, { ...json(body), method, cookie });

  assert.deepEqual(await jsonOf(await post("/api/exams/E/questions", { question_ids: ["q3", "q1"] })), { ok: true, count: 2 });
  assert.deepEqual((await w.open`select question_id, position from exam_questions order by position`).map((r) => [r.question_id, r.position]), [["q3", 1], ["q1", 2]]);
  assert.deepEqual(await jsonOf(await post("/api/exams/E/classes", { class_ids: [] })), { ok: true, count: 0 });
  assert.equal((await w.open`select count(*) as n from exam_classes`)[0].n, 0);
  await post("/api/exams/E/classes", { class_ids: ["cl"] });
  assert.equal((await w.open`select count(*) as n from exam_classes`)[0].n, 1);

  const imp = await jsonOf(await post("/api/questions/bulk", { questions: [
    { type: "pg", text: "2+2?", options: ["3", "4"], correct: 1, category_name: "Baru" },
    { type: "pg", text: "3+3?", options: ["5", "6"], correct: 1, category_name: "baru" },
    { type: "isian", text: "Ibu kota Jawa Barat?", accepted: ["bandung"], category_name: "Baru" },
    { type: "tidak-ada" },
  ] }));
  assert.equal(imp.ok + imp.fail.length, 4, JSON.stringify(imp));
  assert.ok(imp.ok >= 1, JSON.stringify(imp));
  assert.equal((await w.open`select count(*) as n from categories where lower(name) = 'baru'`)[0].n, 1); // satu kategori dibuat sekali
  assert.equal((await w.open`select count(*) as n from question_keys`)[0].n, 3 + imp.ok);

  const mk = await jsonOf(await post("/api/exams", { title: "Jadwal", kind: "harian", duration_minutes: 20,
    starts_at: "2026-11-20T08:00:00+07:00", ends_at: "2026-11-20T09:00:00+07:00" }));
  const id = mk.id ?? mk.exam?.id;
  assert.ok(id, JSON.stringify(mk));
  const [ex] = await w.open`select starts_at, ends_at from exams where id = ${id}`;
  assert.deepEqual([ex.starts_at, ex.ends_at], ["2026-11-20T01:00:00.000Z", "2026-11-20T02:00:00.000Z"]);
  await post(`/api/exams/${id}`, { starts_at: "2026-11-19T10:00:00+07:00" }, "PATCH");
  assert.equal((await w.open`select starts_at from exams where id = ${id}`)[0].starts_at, "2026-11-19T03:00:00.000Z");
});
