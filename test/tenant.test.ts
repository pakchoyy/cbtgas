import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { connectD1, withTenantD1, translateSql } from "../src/d1.ts";
import { scopeSql, TENANT_TABLES } from "../src/tenant.ts";

// Ganti ${...} (kurung kurawal bisa bersarang) dengan '?'; "in ${tx(list)}" jadi "in (?)".
function placeholders(q: string): string {
  let out = "", i = 0;
  while (i < q.length) {
    if (q[i] === "$" && q[i + 1] === "{") {
      let d = 0, j = i + 1;
      for (; j < q.length; j++) { if (q[j] === "{") d++; else if (q[j] === "}" && --d === 0) break; }
      const inner = q.slice(i + 2, j);
      out += /^\s*(?:tx|sp|sql)\(/.test(inner) && /\bin\s*$/i.test(out) ? "(?)" : "?";
      i = j + 1;
    } else out += q[i++];
  }
  return out;
}

const schema = readFileSync(new URL("../db/d1/0001_init.sql", import.meta.url), "utf8");
function fakeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(schema);
  const d1 = { prepare: (sql: string) => ({ bind: (...p: unknown[]) => ({ all: async () => {
    const st = db.prepare(sql);
    if (st.columns().length) return { results: st.all(...(p as never[])), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(st.run(...(p as never[])).changes) } };
  } }) }) } as unknown as D1Database;
  return { db, d1 };
}
const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "bbbbbbbb-0000-4000-8000-000000000002";

async function world() {
  const { d1 } = fakeDb();
  const root = connectD1(d1);
  const open = root.unscoped();
  for (const [id, code] of [[A, "sek-a"], [B, "sek-b"]]) {
    await open`insert into schools (id,code,name,level,operator_name,operator_phone) values (${id},${code},${code},'SMA','o','1')`;
    const k = id === A ? "a" : "b";
    await open`insert into classes (id,school_id,name,year) values (${"cl-" + k},${id},'X','2026')`;
    await open`insert into students (id,school_id,class_id,name,username,pin_hash) values (${"st-" + k},${id},${"cl-" + k},'N',${"u" + k},'h')`;
    await open`insert into exams (id,school_id,title,kind,duration_minutes) values (${"ex-" + k},${id},${"T" + k},'k',10)`;
    await open`insert into exam_classes (exam_id,class_id,school_id) values (${"ex-" + k},${"cl-" + k},${id})`;
    await open`insert into questions (id,school_id,type,content) values (${"q-" + k},${id},'pg','{}')`;
    await open`insert into exam_sessions (id,school_id,exam_id,student_id,deadline_at) values (${"ses-" + k},${id},${"ex-" + k},${"st-" + k},now())`;
  }
  return { root, open, asA: <T,>(fn: Parameters<typeof withTenantD1<T>>[2]) => withTenantD1(root, { schoolId: A, role: "admin" }, fn) };
}

test("baca: id sekolah lain tidak terlihat (select, join, subquery, alias)", async () => {
  const w = await world();
  await w.asA(async (tx) => {
    assert.equal((await tx`select id from exams where id = ${"ex-b"}`).length, 0);
    assert.equal((await tx`select id from exams where id = ${"ex-a"}`).length, 1);
    assert.equal((await tx`select e.id from exams e join exam_classes ec on ec.exam_id = e.id`).length, 1);
    assert.equal((await tx`select count(*) as n from exams`)[0].n, 1);
    assert.equal((await tx`select id from exams as x where x.id in (select exam_id from exam_classes)`).length, 1);
    assert.equal((await tx`select (select name from schools where id = es.school_id) as s from exam_sessions es`).length, 1);
    assert.deepEqual((await tx`select name from schools`).map((r) => r.name), ["sek-a"]);
    assert.equal((await tx`select 1 from students st left join classes c on c.id = st.class_id where st.id = ${"st-b"}`).length, 0);
  });
});

test("ubah/hapus: baris sekolah lain tidak tersentuh (update, delete, returning, subquery)", async () => {
  const w = await world();
  await w.asA(async (tx) => {
    assert.equal((await tx`update exams set title = 'HACK' where id = ${"ex-b"}`).count, 0);
    assert.equal((await tx`update exams set title = 'HACK' where id = ${"ex-b"} returning id`).length, 0);
    assert.equal((await tx`update exams set title = 'ok' where id = ${"ex-a"} returning id`).length, 1);
    assert.equal((await tx`update exams set title = 'semua'`).count, 1);            // tanpa where: hanya sekolah A
    assert.equal((await tx`delete from questions where id = ${"q-b"}`).count, 0);
    assert.equal((await tx`delete from questions where id in (select id from questions)`).count, 1);
    assert.equal((await tx`update exam_sessions set last_seen_at = now() where id = ${"ses-b"}
      returning cast((select count(*) from exam_messages m where m.session_id = exam_sessions.id) as integer) as n`).length, 0);
  });
  const left = await w.open`select id, title from exams order by id`;
  assert.deepEqual(left.map((r) => [r.id, r.title]), [["ex-a", "semua"], ["ex-b", "Tb"]]);
  assert.equal((await w.open`select count(*) as n from questions`)[0].n, 1); // q-b masih ada
});

test("insert: school_id wajib dan harus milik sesi (nilai terikat, literal, banyak baris, tx(rows))", async () => {
  const w = await world();
  await w.asA(async (tx) => {
    await tx`insert into categories (school_id, name) values (${A}, 'ok')`;
    await assert.rejects(tx`insert into categories (school_id, name) values (${B}, 'bocor')`, /sekolah lain/);
    await assert.rejects(tx`insert into categories (name) values ('x')`, /tanpa kolom school_id/);
    await assert.rejects(tx`insert into categories (name, school_id) values ('x', 'bbbbbbbb-0000-4000-8000-000000000002')`, /bukan milik sesi/);
    await assert.rejects(tx`insert into categories (school_id, name) values (${A}, 'a'), (${B}, 'b')`, /sekolah lain/);
    await assert.rejects(tx`insert into categories ${tx([{ school_id: B, name: "z" }], "school_id", "name")}`, /sekolah lain/);
    const ins = await tx`insert into categories ${tx([{ school_id: A, name: "p" }, { school_id: A, name: "q" }], "school_id", "name")}`;
    assert.equal(ins.count, 2);
    await assert.rejects(tx`insert into schools (code,name,level,operator_name,operator_phone) values ('x','x','SMA','o','1')`, /schools/);
    // upsert pola jawaban
    await tx`insert into answers (session_id,question_id,school_id,answer) values (${"ses-a"},${"q-a"},${A},${{ index: 1 }})
      on conflict (session_id, question_id) do update set answer = coalesce(answers.answer, '{}'::jsonb) || ${{ text: "t" }}, updated_at = now()`;
  });
  assert.equal((await w.open`select count(*) as n from categories`)[0].n, 3);
});

test("tanpa konteks ditolak; non-tenant boleh; unscoped dan owner lintas sekolah", async () => {
  const w = await world();
  await assert.rejects(w.root`select * from exams`, /tanpa withTenant/);
  await assert.rejects(w.root`update exams set title = 'x'`, /tanpa withTenant/);
  await w.root`insert into rate_counters (bucket,key,window_start,count) values ('b','k','w',1)`;
  assert.equal((await w.open`select * from exams`).length, 2);
  await withTenantD1(w.root, { schoolId: "", role: "owner" }, async (tx) => {
    assert.equal((await tx`select * from exams`).length, 2);
    assert.equal((await tx`select * from schools`).length, 2);
  });
  // staf tanpa sekolah (schoolId kosong) tidak melihat apa pun
  await withTenantD1(w.root, { schoolId: "", role: "admin" }, async (tx) => {
    assert.equal((await tx`select * from exams`).length, 0);
    assert.equal((await tx`update exams set title = 'x'`).count, 0);
  });
  // id sekolah yang aneh tidak bisa menyuntik SQL
  await withTenantD1(w.root, { schoolId: "x' or '1'='1", role: "admin" }, async (tx) => {
    assert.equal((await tx`select * from exams`).length, 0);
  });
});

// Pemeriksaan statis atas SEMUA query di kode.
test("semua query di src: setelah ditulis ulang tak ada tabel tenant tanpa batas sekolah; semua insert menyertakan school_id", () => {
  const { db } = fakeDb();
  const sid = A;
  const names = readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts") && !["dbfn.ts", "d1.ts", "tenant.ts", "db.ts"].includes(f));
  const T = [...TENANT_TABLES].join("|");
  const refRe = new RegExp(`\\b(from|join)\\s+(${T})\\b`, "gi");
  const wrapped = new RegExp(`\\(select \\* from (${T}) where (school_id|id) = '${sid}'\\)`, "g");
  let checked = 0; const problems: string[] = [];
  for (const f of names) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/\b(?:tx|sql|sp)`([^`]*)`/g)) {
      let q = m[1];
      if (!/^\s*(select|with|insert|update|delete)\b/i.test(q)) continue;
      if (/\$\{\s*(?:tx|sp|sql)\(/.test(q) && /^\s*insert/i.test(q)) continue; // tx(rows, ...)
      q = placeholders(q);
      if (/\bscore_session\s*\(/.test(q)) continue; // cabang khusus Neon
      let t: string; try { t = translateSql(q); } catch { continue; } // cabang khusus Neon
      const where = `${f}:${src.slice(0, m.index).split("\n").length}`;
      if (/^\s*insert\s+into\s+([a-z_]+)\s*\(([^)]*)\)/i.test(t)) {
        const [, tbl, cols] = /^\s*insert\s+into\s+([a-z_]+)\s*\(([^)]*)\)/i.exec(t)!;
        if (TENANT_TABLES.has(tbl.toLowerCase()) && tbl.toLowerCase() !== "schools" && !/\bschool_id\b/.test(cols)) problems.push(`${where} insert ${tbl} tanpa school_id`);
      }
      let s: string;
      try { s = scopeSql(t, sid); } catch (e) { problems.push(`${where} scopeSql: ${(e as Error).message}`); continue; }
      try { db.prepare(s); } catch (e) { problems.push(`${where} tak bisa dikompilasi: ${(e as Error).message}\n   ${s.replace(/\s+/g, " ").slice(0, 160)}`); continue; }
      const left = s.replace(wrapped, "").replace(/^\s*(?:insert\s+into|delete\s+from)\s+[a-z_]+/i, "");
      if (refRe.test(left)) problems.push(`${where} masih ada tabel tenant tanpa batas: ${left.replace(/\s+/g, " ").slice(0, 140)}`);
      refRe.lastIndex = 0;
      if (/^\s*(update|delete)\b/i.test(t)) {
        const tb = /^\s*(?:update|delete\s+from)\s+([a-z_]+)/i.exec(t)![1].toLowerCase();
        if (TENANT_TABLES.has(tb) && !s.includes(`.${tb === "schools" ? "id" : "school_id"} = '${sid}'`)) problems.push(`${where} ${tb}: update/delete tanpa batas sekolah`);
      }
      checked++;
    }
  }
  assert.ok(checked > 200, `hanya ${checked} query diperiksa`);
  assert.deepEqual(problems, []);
});
