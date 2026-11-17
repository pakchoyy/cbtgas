import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.ts";
import { connectD1, withTenantD1 } from "../src/d1.ts";
import * as fn from "../src/dbfn.ts";

const reg = (code: string, email = "Guru@Sekolah.id", name = "SMA Satu") => ({
  code, name, level: "SMA", npsn: null, operator_name: "Op", operator_phone: "081", admin_email: email, google_sub: "g1",
});

test("registerSchool D1: sekolah + admin; kode & email dinormalkan; staf ditemukan", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const id = await fn.registerSchool(sql, reg("SMA-Satu"));
  const staff = await fn.findStaffByEmail(sql, "GURU@sekolah.id");
  assert.deepEqual(staff.map((r) => [r.school_id, r.role]), [[id, "admin"]]);
  const sch = await fn.resolveSchool(sql, "Sma-Satu");
  assert.equal(sch[0].id, id);
});

test("registerSchool D1: kode kembar -> galat berbentuk Postgres (23505 / *code*)", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  await fn.registerSchool(sql, reg("sma-satu"));
  await assert.rejects(fn.registerSchool(sql, reg("sma-satu", "lain@x.id")), (e: any) =>
    e.code === "23505" && e.constraint_name.includes("code"));
});

test("registerSchool D1: gagal bikin admin -> sekolah dibatalkan (tidak yatim)", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  await assert.rejects(fn.registerSchool(sql, { ...reg("sma-dua"), admin_email: null as unknown as string }));
  assert.equal((await fn.resolveSchool(sql, "sma-dua")).length, 0);
});

test("sekolah nonaktif disembunyikan dari resolve/staf/siswa", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const id = await fn.registerSchool(sql, reg("sma-tiga", "a@b.id"));
  await sql`insert into students (school_id,name,username,pin_hash) values (${id},'Budi','Budi.S','h')`;
  assert.equal((await fn.findStudentsByUsername(sql, " budi.s ")).length, 1);
  assert.equal(await fn.usernameTaken(sql, "budi.s"), true);
  assert.equal(await fn.usernameTaken(sql, "lain"), false);
  await sql`update schools set active = 0 where id = ${id}`;
  assert.equal((await fn.resolveSchool(sql, "sma-tiga")).length, 0);
  assert.equal((await fn.findStaffByEmail(sql, "a@b.id")).length, 0);
  assert.equal((await fn.findStudentsByUsername(sql, "budi.s")).length, 0);
});

test("siswa nonaktif tidak ditemukan", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const id = await fn.registerSchool(sql, reg("sma-empat", "c@d.id"));
  await sql`insert into students (school_id,name,username,pin_hash,active) values (${id},'X','x1','h',${false})`;
  assert.equal((await fn.findStudentsByUsername(sql, "x1")).length, 0);
});

test("bank publik: katalog, mine, payload terurai, hitungan unduh", async () => {
  const sql = connectD1(fakeD1()).unscoped();
  const a = await fn.registerSchool(sql, reg("sekolah-a", "a@a.id", "Sekolah A"));
  const b = await fn.registerSchool(sql, reg("sekolah-b", "b@b.id", "Sekolah B"));
  await sql`insert into shared_banks (school_id,slug,title,payload) values (${a},'bank-a','Bank A',${{ questions: [1, 2, 3] }})`;
  await sql`insert into shared_banks (school_id,slug,title,payload,download_count) values (${b},'bank-b','Bank B',${{ questions: [] }},5)`;
  const asA = withTenantD1(sql, { schoolId: a, role: "admin" }, (tx) => fn.listPublicBanks(tx));
  const rows = await asA;
  assert.deepEqual(rows.map((r) => [r.slug, r.question_count, r.school_name, r.mine]),
    [["bank-b", 0, "Sekolah B", false], ["bank-a", 3, "Sekolah A", true]]);
  const [bank] = await fn.publicBank(sql, "bank-a");
  assert.deepEqual(bank.payload, { questions: [1, 2, 3] });
  await fn.incrementBankDownload(sql, "bank-a");
  assert.equal((await fn.publicBank(sql, "bank-a"))[0].download_count, 1);
  assert.equal((await fn.publicBank(sql, "tidak-ada")).length, 0);
});

// Neon: SQL harus tetap memanggil fungsi Postgres yang sama (tanpa isD1).
test("Neon: tiap helper memanggil fungsi SQL aslinya", async () => {
  const seen: string[] = [];
  const sql: any = (s: TemplateStringsArray) => { seen.push(s.join("?").replace(/\s+/g, " ").trim()); return Promise.resolve([{ id: "x" }]); };
  await fn.resolveSchool(sql, "a"); await fn.findStaffByEmail(sql, "a"); await fn.findStudentsByUsername(sql, "a");
  await fn.publicBank(sql, "a"); await fn.incrementBankDownload(sql, "a"); await fn.listPublicBanks(sql);
  await fn.registerSchool(sql, reg("abc"));
  const joined = seen.join("\n");
  for (const f of ["resolve_school(?)", "find_staff_by_email(?)", "find_students_by_username(?)", "public_bank(?)",
    "increment_bank_download(?)", "list_public_banks()", "register_school("]) assert.ok(joined.includes(f), f);
});
