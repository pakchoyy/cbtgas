import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.ts";
import { connectD1, withTenantD1 } from "../src/d1.ts";

const school = { code: "demo-sma", name: "Demo", level: "SMA", operator_name: "a", operator_phone: "1" };

async function seed(sql: ReturnType<typeof connectD1>) {
  const [s] = await sql`insert into schools (code,name,level,operator_name,operator_phone)
    values (${school.code},${school.name},${school.level},${school.operator_name},${school.operator_phone}) returning id`;
  return s.id as string;
}

test("insert returning, boolean, Date, now()", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const id = await seed(sql);
  const r = await sql`select id, active from schools where id = ${id} and created_at <= now()`;
  assert.equal(r.length, 1);
  assert.equal(r[0].active, true); // kolom boolean dikembalikan sebagai boolean, seperti Postgres
  await sql`update schools set active = ${false}, privacy_consent_at = ${new Date("2026-01-02T03:04:05.000Z")} where id = ${id}`;
  const [u] = await sql`select active, privacy_consent_at from schools where id = ${id}`;
  assert.deepEqual([u.active, u.privacy_consent_at], [false, "2026-01-02T03:04:05.000Z"]);
});

test("update .count, interval, cast ::uuid dibuang", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const id = await seed(sql);
  const u = await sql`update schools set plan = 'pro' where id = ${id}::uuid`;
  assert.equal(u.count, 1);
  const old = await sql`select id from schools where created_at <= now() - interval '10 minutes'`;
  assert.equal(old.length, 0);
  const fresh = await sql`select id from schools where created_at > now() - interval '10 minutes'`;
  assert.equal(fresh.length, 1);
});

test("in ${tx(list)}, tx.json, tx(rows, ...cols) dipecah >100 parameter", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const sid = await seed(sql);
  const rows = Array.from({ length: 120 }, (_, i) => ({ school_id: sid, name: `K${i}`, year: "2026" }));
  const ins = await sql`insert into classes ${sql(rows, "school_id", "name", "year")}`;
  assert.equal(ins.count, 120);
  const some = await sql`select name from classes where name in ${sql(["K1", "K2", "K3"])}`;
  assert.equal(some.length, 3);
  await sql`insert into questions (school_id,type,content) values (${sid},'pg',${sql.json({ q: "1+1?", opts: ["1", "2"] })})`;
  const [q] = await sql`select content->>'q' as q from questions`;
  assert.equal(q.q, "1+1?");
  await assert.rejects(sql`select 1 where 1 in ${sql(Array.from({ length: 101 }, (_, i) => i))}`, /melebihi batas/);
  await assert.rejects(sql`select 1 where 1 in ${sql([])}`, /kosong/);
});

test("on conflict do update + returning (pola rate limit)", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const hit = () => sql`insert into rate_counters (bucket,key,window_start,count) values ('b','k','w',1)
    on conflict (bucket,key,window_start) do update set count = rate_counters.count + 1 returning count`;
  await hit(); await hit();
  assert.equal((await hit())[0].count, 3);
});

test("sintaks Postgres yang belum didukung ditolak jelas", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  await assert.rejects(sql`select x::boolean from t`, /belum didukung/);
  await assert.rejects(sql`select 1 from t for update`, /for update/);
  await assert.rejects(sql`select jsonb_typeof(x) from t`, /jsonb/);
});

test("withTenantD1 membawa ctx tanpa membocorkannya antar pemanggil", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const [a, b] = await Promise.all([
    withTenantD1(sql, { schoolId: "A", role: "admin" }, async (tx) => tx.ctx?.schoolId),
    withTenantD1(sql, { schoolId: "B", role: "admin" }, async (tx) => tx.ctx?.schoolId),
  ]);
  assert.deepEqual([a, b], ["A", "B"]);
  assert.equal(sql.ctx, undefined);
});

test("cast operan berkurung/fungsi, greatest null-aman, jsonb_array_length(x->'k')", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const [a] = await sql`select (select count(*) from schools)::int as n, count(*)::int as m, round(avg(1)::numeric, 1) as r,
    ('7')::int + (select 2)::int as s from schools`;
  assert.deepEqual({ ...a }, { n: 0, m: 0, r: null, s: 9 });
  // greatest/least mengabaikan NULL (seperti Postgres), bukan menghasilkan NULL
  const [g] = await sql`select greatest(null, 3) as a, greatest(2, null) as b, greatest(null, null) as c, least(null, 3) as d, least(5, 4) as e, greatest(1, 2) as f`;
  assert.deepEqual({ ...g }, { a: 3, b: 2, c: null, d: 3, e: 4, f: 2 });
  await assert.rejects(sql`select greatest(1, 2, 3)`, /selain 2 argumen/);
  await sql`insert into schools (id,code,name,level,operator_name,operator_phone) values ('s','abc','n','SMA','o','1')`;
  await sql`insert into shared_banks (school_id,slug,title,payload) values ('s','bank-1','t',${{ questions: [1, 2, 3, 4] }})`;
  const [b] = await sql`select jsonb_array_length(payload->'questions') as n from shared_banks`;
  assert.equal(b.n, 4);
});

test("daftar id panjang (>100) disisipkan sebagai literal; angka/teks aneh tetap kena batas parameter", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  await sql`insert into schools (id,code,name,level,operator_name,operator_phone) values ('s','abc','n','SMA','o','1')`;
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  await sql`insert into categories ${sql(ids.map((id) => ({ id, school_id: "s", name: id })), "id", "school_id", "name")}`;
  assert.equal((await sql`select count(*) as n from categories where id in ${sql(ids)}`)[0].n, 250);
  assert.equal((await sql`update categories set name = 'x' where id in ${sql(ids.slice(0, 120))} returning id`).length, 120);
  // string berbahaya tidak pernah disisipkan: jatuh ke parameter lalu ditolak karena melewati batas
  await assert.rejects(sql`select 1 where 'a' in ${sql([...ids, "x' or '1'='1"])}`, /melebihi batas/);
});

test("D1 sibuk: kueri diulang otomatis; galat koneksi hanya diulang untuk kueri baca", async () => {
  const { withRetry } = await import("../src/d1.ts");
  let n = 0;
  assert.equal(await withRetry(async () => { if (++n < 3) throw new Error("D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window."); return "ok"; }), "ok");
  assert.equal(n, 3);
  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new Error("D1_ERROR: Network connection lost."); }, false));
  assert.equal(n, 1, "tulisan tidak diulang untuk galat koneksi");
  n = 0;
  assert.equal(await withRetry(async () => { if (++n < 2) throw new Error("Network connection lost."); return 1; }, true), 1);
  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new Error("UNIQUE constraint failed"); }, true));
  assert.equal(n, 1, "galat biasa tidak diulang");
});
