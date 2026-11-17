#!/usr/bin/env node
// Salin data Neon -> D1. Membaca Neon (hanya SELECT), menulis berkas .sql yang Anda jalankan sendiri ke D1.
//
//   DATABASE_URL=postgres://... node scripts/neon-to-d1.mjs export out/
//   for f in out/*.sql; do npx wrangler d1 execute cbt-yuk --remote --file "$f"; done
//   node scripts/neon-to-d1.mjs count-query            # cetak kueri hitung untuk D1
//   npx wrangler d1 execute cbt-yuk --remote --json --command "<kueri itu>" > out/d1.json
//   node scripts/neon-to-d1.mjs verify out/ out/d1.json
//
// DATABASE_URL: pakai role yang sama dengan Hyperdrive (cbt_login). Skrip memakai SET LOCAL ROLE cbt_app + app.role=owner
// di dalam transaksi READ ONLY, jadi tidak ada yang berubah di Neon.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ORDER, SKIP, parseSchema, insertSql, parentsFirst, countQuery, compareCounts } from "./migrate-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = parseSchema(fs.readFileSync(path.join(here, "../db/d1/0001_init.sql"), "utf8"));
const byName = new Map(schema.map((t) => [t.name, t]));
const ROWS_PER_FILE = 2000;

const missing = schema.map((t) => t.name).filter((n) => !ORDER.includes(n) && !SKIP.includes(n));
if (missing.length) { console.error(`Tabel di skema D1 belum ada di ORDER/SKIP: ${missing.join(", ")}`); process.exit(2); }

const [cmd, a, b] = process.argv.slice(2);

if (cmd === "count-query") {
  console.log(countQuery(ORDER.map((n) => byName.get(n))));
} else if (cmd === "export") {
  const out = a ?? "out";
  if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL."); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, fetch_types: false, prepare: false });
  const counts = {};
  try {
    await sql.begin("read only", async (tx) => {
      await tx`set local role cbt_app`;
      await tx`select set_config('app.role', 'owner', true), set_config('app.school_id', '', true)`;
      let file = 0;
      for (const name of ORDER) {
        const table = byName.get(name);
        let rows = await tx.unsafe(`select * from "${name}"`);
        if (name === "categories") rows = parentsFirst(rows);
        counts[name] = rows.length;
        for (let i = 0; i < rows.length || (i === 0 && rows.length === 0); i += ROWS_PER_FILE) {
          if (!rows.length) break;
          const part = rows.slice(i, i + ROWS_PER_FILE);
          const f = path.join(out, `${String(++file).padStart(3, "0")}-${name}-${Math.floor(i / ROWS_PER_FILE) + 1}.sql`);
          fs.writeFileSync(f, insertSql(table, part).join("\n") + "\n");
        }
        console.log(`${name}: ${rows.length} baris`);
      }
      const [s] = await tx`select coalesce(round(sum(final_score)::numeric, 2), 0) as n from scores`;
      const [aw] = await tx`select count(*)::int as n from answers where answer is not null`;
      counts["scores.sum_final"] = Number(s.n); counts["answers.with_json"] = aw.n;
    });
  } finally { await sql.end(); }
  fs.writeFileSync(path.join(out, "counts.neon.json"), JSON.stringify(counts, null, 2));
  console.log(`\nSelesai. Berkas SQL + counts.neon.json ada di ${out}/`);
} else if (cmd === "verify") {
  const neon = JSON.parse(fs.readFileSync(path.join(a, "counts.neon.json"), "utf8"));
  const raw = JSON.parse(fs.readFileSync(b, "utf8"));
  // keluaran wrangler --json: [{ results: [{ t, n }, ...] }]
  const rows = (Array.isArray(raw) ? raw[0] : raw).results;
  const d1 = Object.fromEntries(rows.map((r) => [r.t, r.n]));
  const problems = compareCounts(neon, d1);
  if (problems.length) { console.error("TIDAK SAMA:\n  " + problems.join("\n  ")); process.exit(1); }
  console.log(`OK: ${Object.keys(neon).length} hitungan sama antara Neon dan D1.`);
} else {
  console.error("Pakai: export <dir> | count-query | verify <dir> <d1.json>");
  process.exit(2);
}
