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

// Anggaran query per permintaan. D1 paket gratis: 50, berbayar: 1000 (per invokasi Worker). Statement dalam batch() dihitung satu per satu.
test("jumlah query D1 per rute (laporan + anggaran paket gratis 50)", async () => {
  const w = await boot();
  const staff = w.cookieOf(await w.call("/auth/dev-login", { method: "POST" }));
  const stu = w.cookieOf(await w.call("/s/login", json({ username: "siswa1", pin: "123456" })));
  const form = { "Content-Type": "application/x-www-form-urlencoded" };
  const rows: Array<[string, number]> = [];
  const measure = async (label: string, path: string, init: RequestInit & { cookie?: string }) => {
    const before = w.stats.queries;
    const r = await w.call(path, init);
    await r.text();
    rows.push([`${init.method ?? "GET"} ${label}`, w.stats.queries - before]);
    return r;
  };
  const st = await measure("/s/exams/:id/start", "/s/exams/E/start", { method: "POST", cookie: stu, headers: form, body: "token=" });
  const sid = st.headers.get("location")!.split("/").pop()!;
  await measure("/s", "/s", { cookie: stu });
  await measure("/s/take/:sid", `/s/take/${sid}`, { cookie: stu });
  await measure("/s/take/:sid/answers", `/s/take/${sid}/answers`, { ...json({ answers: [{ question_id: "q1", index: 1 }, { question_id: "q2", text: "x" }, { question_id: "q3", selected: [0] }] }), cookie: stu });
  await measure("/s/take/:sid/ping", `/s/take/${sid}/ping`, { method: "POST", cookie: stu });
  await measure("/s/take/:sid/violation", `/s/take/${sid}/violation`, { ...json({ kind: "tab_blur" }), cookie: stu });
  await measure("/s/take/:sid/submit", `/s/take/${sid}/submit`, { method: "POST", cookie: stu });
  await measure("/s/done/:sid", `/s/done/${sid}`, { cookie: stu });
  for (const p of ["/app", "/app/students", "/app/exams", "/app/exams/E", "/app/exams/E/live", "/app/exams/E/insights", "/app/exams/E/items",
    "/app/bank", "/app/questions", "/app/students/st/report", "/app/restore", "/api/overview", "/api/exams/E/live", "/api/exams/E/scores", "/api/reports/backup.json", "/owner"]) {
    await measure(p, p, { cookie: staff });
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log("\nQUERY PER RUTE (terbanyak dulu):\n" + rows.map(([k, n]) => `${String(n).padStart(4)}  ${k}`).join("\n"));
  const over = rows.filter(([, n]) => n > 50);
  assert.deepEqual(over, [], "rute melebihi 50 query (batas paket gratis D1)");
});

test("simpan jawaban: 120 jawaban = sedikit query (insert banyak baris), tetap menggabung kunci lama", async () => {
  const w = await boot();
  for (let i = 0; i < 120; i++) {
    await w.open`insert into questions (id,school_id,type,content,points) values (${"x" + i},${SID},'pg','{}',1)`;
    await w.open`insert into exam_questions (exam_id,question_id,school_id,position) values ('E',${"x" + i},${SID},${10 + i})`;
  }
  const stu = w.cookieOf(await w.call("/s/login", json({ username: "siswa1", pin: "123456" })));
  const st = await w.call("/s/exams/E/start", { method: "POST", cookie: stu, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" });
  const sid = st.headers.get("location")!.split("/").pop()!;
  await w.call(`/s/take/${sid}/answers`, { ...json({ answers: [{ question_id: "x0", index: 1, note: "a" }] }), cookie: stu });
  const before = w.stats.queries;
  const body = { answers: Array.from({ length: 120 }, (_, i) => ({ question_id: "x" + i, index: 0 })) };
  assert.deepEqual(await jsonOf(await w.call(`/s/take/${sid}/answers`, { ...json(body), cookie: stu })), { ok: true, saved: 120 });
  const used = w.stats.queries - before;
  assert.ok(used <= 12, `120 jawaban memakai ${used} query`);
  assert.equal((await w.open`select count(*) as n from answers where session_id = ${sid}`)[0].n, 120);
  assert.deepEqual((await w.open`select answer from answers where session_id = ${sid} and question_id = 'x0'`)[0].answer, { index: 0, note: "a" });
});

test("catchUp D1: sesi kedaluwarsa diproses bertahap (5 per permintaan), semuanya akhirnya selesai", async () => {
  const w = await boot();
  const { catchUp } = await import("../src/catchup.ts");
  const sql = connectD1(w.d1);
  for (let i = 0; i < 12; i++) {
    await w.open`insert into students (id,school_id,class_id,name,username,pin_hash) values (${"s" + i},${SID},'cl','N',${"u" + i},'h')`;
    await w.open`insert into exam_sessions (id,school_id,exam_id,student_id,deadline_at,status) values (${"se" + i},${SID},'E',${"s" + i},'2020-01-01T00:00:00.000Z','active')`;
  }
  const done = async () => (await w.open`select count(*) as n from exam_sessions where status = 'expired'`)[0].n;
  // catchUp menahan diri 20 detik per sekolah per proses; majukan jam palsu supaya tiap panggilan benar-benar jalan
  const realNow = Date.now; let t = realNow() + 3_600_000;
  Date.now = () => (t += 30_000);
  const q0 = w.stats.queries;
  await catchUp(sql, SID);
  assert.equal(await done(), 5);
  assert.ok(w.stats.queries - q0 <= 50, `catchUp memakai ${w.stats.queries - q0} query`);
  try { await catchUp(sql, SID); await catchUp(sql, SID); } finally { Date.now = realNow; }
  assert.equal(await done(), 12);
});

test("isolasi antar sekolah lewat rute asli: guru/siswa sekolah A tidak bisa membaca atau mengubah data sekolah B", async () => {
  const w = await boot();
  const B = "bbbbbbbb-0000-4000-8000-000000000002";
  await w.open`insert into schools (id,code,name,level,operator_name,operator_phone) values (${B},'sek-b','Sekolah B','SMA','Op','081')`;
  await w.open`insert into classes (id,school_id,name,year) values ('clB',${B},'B-1','2026')`;
  await w.open`insert into students (id,school_id,class_id,name,username,pin_hash) values ('stB',${B},'clB','Siswa B','siswab','h')`;
  await w.open`insert into exams (id,school_id,title,kind,duration_minutes,status) values ('EB',${B},'Rahasia B','harian',30,'open')`;
  await w.open`insert into exam_classes (exam_id,class_id,school_id) values ('EB','clB',${B})`;
  await w.open`insert into questions (id,school_id,type,content,points) values ('qB',${B},'pg',${{ text: "SOAL RAHASIA B" }},1)`;
  await w.open`insert into question_keys (question_id,school_id,answer_key) values ('qB',${B},${{ index: 0 }})`;
  await w.open`insert into exam_questions (exam_id,question_id,school_id,position) values ('EB','qB',${B},1)`;
  await w.open`insert into exam_sessions (id,school_id,exam_id,student_id,deadline_at) values ('sesB',${B},'EB','stB',now())`;

  const staff = w.cookieOf(await w.call("/auth/dev-login", { method: "POST" })); // admin sekolah A
  const leaks: string[] = [];
  for (const p of ["/app/exams/EB", "/app/exams/EB/live", "/app/exams/EB/items", "/app/exams/EB/print", "/app/students/stB/report",
    "/app/sessions/sesB/grade", "/api/exams/EB/scores", "/api/exams/EB/live", "/api/exams/EB/summary", "/api/questions/qB", "/api/students/stB/analytics"]) {
    const r = await w.call(p, { cookie: staff });
    const t = await r.text();
    if (/Rahasia B|SOAL RAHASIA B|Siswa B/.test(t)) leaks.push(`${p} membocorkan data B (status ${r.status})`);
  }
  assert.deepEqual(leaks, []);
  assert.ok(!(await (await w.call("/api/exams", { cookie: staff })).text()).includes("Rahasia B"));
  assert.ok(!(await (await w.call("/api/questions", { cookie: staff })).text()).includes("SOAL RAHASIA B"));
  assert.ok(!(await (await w.call("/api/students", { cookie: staff })).text()).includes("Siswa B"));

  // menulis ke data B juga ditolak/tak berpengaruh
  const json = (m: string, b: unknown) => ({ method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), cookie: staff });
  await w.call("/api/exams/EB", json("PATCH", { title: "DIBAJAK" }));
  await w.call("/api/exams/EB/questions", json("POST", { question_ids: [] }));
  await w.call("/api/exams/EB", { method: "DELETE", cookie: staff });
  await w.call("/api/questions/qB", { method: "DELETE", cookie: staff });
  assert.equal((await w.open`select title from exams where id = 'EB'`)[0].title, "Rahasia B");
  assert.equal((await w.open`select count(*) as n from exam_questions where exam_id = 'EB'`)[0].n, 1);
  assert.equal((await w.open`select count(*) as n from questions where id = 'qB'`)[0].n, 1);

  // siswa A tidak bisa masuk ke sesi/ujian B
  const stu = w.cookieOf(await w.call("/s/login", json("POST", { username: "siswa1", pin: "123456" })));
  const take = await w.call("/s/take/sesB", { cookie: stu });
  assert.ok(!(await take.text()).includes("SOAL RAHASIA B"));
  const sub = await w.call("/s/take/sesB/submit", { method: "POST", cookie: stu });
  assert.notEqual(sub.status, 200);
  assert.equal((await w.open`select status from exam_sessions where id = 'sesB'`)[0].status, "active");
  const start = await w.call("/s/exams/EB/start", { method: "POST", cookie: stu, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" });
  assert.match(start.headers.get("location") ?? "", /err=/); // ditolak: ujian bukan untuk kelas siswa A
  assert.equal((await w.open`select count(*) as n from exam_sessions where exam_id = 'EB' and student_id = 'st'`)[0].n, 0);
});
