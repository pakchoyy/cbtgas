import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { connectD1, withTenantD1 } from "../src/d1.ts";

// D1 palsu di atas node:sqlite: cukup prepare().bind().all() seperti API D1.
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(readFileSync(new URL("../db/d1/0001_init.sql", import.meta.url), "utf8"));
  return {
    prepare(sql: string) {
      return { bind: (...p: unknown[]) => ({ all: async () => {
        const st = db.prepare(sql);
        if (st.columns().length) return { results: st.all(...(p as never[])), meta: { changes: 0 } };
        const r = st.run(...(p as never[]));
        return { results: [], meta: { changes: Number(r.changes) } };
      } }) };
    },
  } as unknown as D1Database;
}
const school = { code: "demo-sma", name: "Demo", level: "SMA", operator_name: "a", operator_phone: "1" };

async function seed(sql: ReturnType<typeof connectD1>) {
  const [s] = await sql`insert into schools (code,name,level,operator_name,operator_phone)
    values (${school.code},${school.name},${school.level},${school.operator_name},${school.operator_phone}) returning id`;
  return s.id as string;
}

test("insert returning, boolean, Date, now()", async () => {
  const sql = connectD1(fakeD1());
  const id = await seed(sql);
  const r = await sql`select id, active from schools where id = ${id} and created_at <= now()`;
  assert.equal(r.length, 1);
  assert.equal(r[0].active, 1);
  await sql`update schools set active = ${false}, privacy_consent_at = ${new Date("2026-01-02T03:04:05.000Z")} where id = ${id}`;
  const [u] = await sql`select active, privacy_consent_at from schools where id = ${id}`;
  assert.deepEqual([u.active, u.privacy_consent_at], [0, "2026-01-02T03:04:05.000Z"]);
});

test("update .count, interval, cast ::uuid dibuang", async () => {
  const sql = connectD1(fakeD1());
  const id = await seed(sql);
  const u = await sql`update schools set plan = 'pro' where id = ${id}::uuid`;
  assert.equal(u.count, 1);
  const old = await sql`select id from schools where created_at <= now() - interval '10 minutes'`;
  assert.equal(old.length, 0);
  const fresh = await sql`select id from schools where created_at > now() - interval '10 minutes'`;
  assert.equal(fresh.length, 1);
});

test("in ${tx(list)}, tx.json, tx(rows, ...cols) dipecah >100 parameter", async () => {
  const sql = connectD1(fakeD1());
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
  const sql = connectD1(fakeD1());
  const hit = () => sql`insert into rate_counters (bucket,key,window_start,count) values ('b','k','w',1)
    on conflict (bucket,key,window_start) do update set count = rate_counters.count + 1 returning count`;
  await hit(); await hit();
  assert.equal((await hit())[0].count, 3);
});

test("sintaks Postgres yang belum didukung ditolak jelas", async () => {
  const sql = connectD1(fakeD1());
  await assert.rejects(sql`select x::int from t`, /belum didukung/);
  await assert.rejects(sql`select 1 from t for update`, /for update/);
  await assert.rejects(sql`select jsonb_typeof(x) from t`, /jsonb/);
});

test("withTenantD1 membawa ctx tanpa membocorkannya antar pemanggil", async () => {
  const sql = connectD1(fakeD1());
  const [a, b] = await Promise.all([
    withTenantD1(sql, { schoolId: "A", role: "admin" }, async (tx) => tx.ctx?.schoolId),
    withTenantD1(sql, { schoolId: "B", role: "admin" }, async (tx) => tx.ctx?.schoolId),
  ]);
  assert.deepEqual([a, b], ["A", "B"]);
  assert.equal(sql.ctx, undefined);
});
