import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { connectDb, withTenant } from "../src/db.ts";
import { isD1 } from "../src/d1.ts";
import { fakeD1 } from "./fake-d1.ts";

const hd = { connectionString: "postgres://u:p@127.0.0.1:1/db" } as unknown as Hyperdrive;

test("bawaan = Neon: tanpa DB_BACKEND tetap Hyperdrive, walau binding DB ada", () => {
  assert.equal(isD1(connectDb({ HYPERDRIVE: hd })), false);
  assert.equal(isD1(connectDb({ HYPERDRIVE: hd, DB: fakeD1() })), false);
  assert.equal(isD1(connectDb({ HYPERDRIVE: hd, DB: fakeD1(), DB_BACKEND: "" })), false);
  assert.equal(isD1(connectDb({ HYPERDRIVE: hd, DB: fakeD1(), DB_BACKEND: "neon" })), false);
  assert.equal(isD1(connectDb({ HYPERDRIVE: hd, DB: fakeD1(), DB_BACKEND: "D1" })), false); // harus persis "d1"
});

test("DB_BACKEND=d1 memakai D1; tanpa binding DB gagal keras (tidak diam-diam ke Neon)", () => {
  assert.equal(isD1(connectDb({ HYPERDRIVE: hd, DB: fakeD1(), DB_BACKEND: "d1" })), true);
  assert.throws(() => connectDb({ HYPERDRIVE: hd, DB_BACKEND: "d1" }), /binding D1 'DB'/);
});

test("withTenant memilih jalur D1 dan menerapkan batas sekolah", async () => {
  const sql = connectDb({ HYPERDRIVE: hd, DB: fakeD1(), DB_BACKEND: "d1" });
  const open = (sql as any).unscoped();
  await open`insert into schools (id,code,name,level,operator_name,operator_phone) values ('A','sek-a','A','SMA','o','1'), ('B','sek-b','B','SMA','o','1')`;
  const seen = await withTenant(sql, { schoolId: "A", role: "admin" }, (tx) => tx`select code from schools`);
  assert.deepEqual(seen.map((r: any) => r.code), ["sek-a"]);
});

test("tak ada titik koneksi di luar db.ts yang melewati sakelar", () => {
  const dir = new URL("../src/", import.meta.url);
  const offenders: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && x !== "db.ts")) {
    const src = readFileSync(new URL(f, dir), "utf8");
    src.split("\n").forEach((l, i) => { if (/connectionString|\bconnect\(/.test(l) && !/^\s*\/\//.test(l)) offenders.push(`${f}:${i + 1} ${l.trim().slice(0, 80)}`); });
  }
  assert.deepEqual(offenders, []);
});
