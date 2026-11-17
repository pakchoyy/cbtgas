// Adapter D1 yang meniru bagian postgres.js yang dipakai aplikasi ini (langkah 2 migrasi Neon -> D1).
// Belum dipasang ke rute mana pun; db.ts/Neon tetap jalan. Dipakai dengan: connectD1(env.DB).
//
// Yang ditiru:  sql`...${v}...`, tx`...`, tx(list) untuk "in ${tx(ids)}", tx(rows, ...kolom) untuk
//               "insert into t ${tx(rows, ...)}", tx(namaTabel), tx.json(v), begin(), savepoint(), hasil
//               berupa array baris dengan properti .count.
// Terjemahan:   greatest/least -> max/min null-aman; x::int/numeric -> cast(); jsonb_array_length(x->'k'); make_interval -> strftime; coalesce(x,'{}'::jsonb) || ? -> json_patch;
//               now() -> waktu ISO UTC; now() - interval 'N unit' -> strftime(...,'-N unit'); cast ::uuid/::text/
//               ::jsonb/::json dibuang; boolean -> 0/1; Date -> ISO string.
// Ditolak jelas (harus ditulis ulang manual di langkah 3): cast ::int/::numeric/::bigint, "for update",
//               "ilike", "= any(", jsonb_* / ? / @> dan fungsi Postgres lain yang tidak ada di SQLite.
//
// BATASAN YANG HARUS DIPAHAMI:
//  1. begin()/savepoint() TIDAK atomik. D1 tidak punya transaksi interaktif; tiap query jalan sendiri-sendiri.
//     Jalur yang butuh atomik (kumpul jawaban, penilaian, impor massal) harus dipindah ke batch() di langkah 3.
//  2. D1 membatasi 100 parameter per query. tx(list) di atas 100 isi ditolak; tx(rows, ...) dipecah otomatis
//     per query (juga tidak atomik).
//  3. Tidak ada RLS. withTenant() hanya membawa ctx ke fn; setiap query wajib memfilter school_id sendiri.
//  4. Kolom numeric kini kembali sebagai number (Postgres: string "60.00"); boolean kembali sebagai 0/1.

import { scopeSql, checkInsert, tablesIn } from "./tenant";

const MAX_PARAMS = 100;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export type Ctx = { schoolId: string; role: string; userId?: string };
type Row = Record<string, unknown>;
export type Rows = Row[] & { count: number };

class Json { v: unknown; constructor(v: unknown) { this.v = v; } }
class Ident { name: string; constructor(name: string) { this.name = name; } }
class List { items: unknown[]; constructor(items: unknown[]) { this.items = items; } }
class Values { rows: Row[]; cols: string[]; constructor(rows: Row[], cols: string[]) { this.rows = rows; this.cols = cols; } }
type Fragment = { text: string; params: unknown[] };

function bind(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  // postgres.js mengirim objek/array polos sebagai JSON (kolom jsonb); D1 menyimpannya sebagai teks JSON.
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

// Awal operan tepat sebelum posisi `end` (untuk "<operan>::tipe"): (…), fungsi(…), 'literal', atau nama/angka.
function operandStart(t: string, end: number): number {
  let i = end;
  if (t[i - 1] === ")") {
    let depth = 0;
    for (i = end - 1; i >= 0; i--) { if (t[i] === ")") depth++; else if (t[i] === "(" && --depth === 0) break; }
    if (i < 0) return -1;
    while (i > 0 && /[\w.]/.test(t[i - 1])) i--; // nama fungsi di depan kurung
    return i;
  }
  if (t[i - 1] === "'") { i = t.lastIndexOf("'", i - 2); return i; }
  while (i > 0 && /[\w.]/.test(t[i - 1])) i--;
  return i === end ? -1 : i;
}

// Argumen tingkat atas dari "nama(a, b)" yang dimulai pada `open` (posisi "(").
function splitArgs(t: string, open: number): { args: string[]; close: number } | null {
  let depth = 0, cur = "", inStr = false; const args: string[] = [];
  for (let i = open; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { cur += ch; if (ch === "'") inStr = false; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === "(") { depth++; if (depth === 1) continue; }
    if (ch === ")") { depth--; if (depth === 0) { args.push(cur.trim()); return { args, close: i }; } }
    if (ch === "," && depth === 1) { args.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  return null;
}

// <operan>::int -> cast(<operan> as integer); ::numeric/real/float -> cast(... as real). Dikerjakan dari kanan ke kiri.
function rewriteCasts(t: string): string {
  const re = /::\s*(int|integer|bigint|numeric|real|float)\b/gi;
  const hits = [...t.matchAll(re)].reverse();
  for (const m of hits) {
    const st = operandStart(t, m.index!);
    if (st < 0) continue;
    const to = /^(int|integer|bigint)$/i.test(m[1]) ? "integer" : "real";
    t = `${t.slice(0, st)}cast(${t.slice(st, m.index)} as ${to})${t.slice(m.index! + m[0].length)}`;
  }
  return t;
}

// greatest/least(a, b) -> max/min yang MENGABAIKAN NULL seperti Postgres (max(a,b) SQLite bernilai NULL bila salah satu NULL).
function rewriteExtremes(t: string): string {
  for (;;) {
    const m = /\b(greatest|least)\s*\(/i.exec(t);
    if (!m) return t;
    const open = m.index + m[0].length - 1;
    const sp = splitArgs(t, open);
    if (!sp || sp.args.length !== 2) throw new Error(`d1: sintaks Postgres belum didukung: ${m[1]}() dengan selain 2 argumen`);
    const [a, b] = sp.args, fn = m[1].toLowerCase() === "greatest" ? "max" : "min";
    t = `${t.slice(0, m.index)}${fn}(coalesce(${a}, ${b}), coalesce(${b}, ${a}))${t.slice(sp.close + 1)}`;
  }
}

export function translateSql(text: string): string {
  let t = text;
  // X +/- make_interval(mins|hours|days|secs => N)  ->  strftime(..., X, '+N unit')
  t = t.replace(/(now\(\)|[a-z_][\w.]*)\s*([+-])\s*make_interval\(\s*(mins|hours|days|secs)\s*=>\s*(\?|\d+)\s*\)/gi,
    (_m, base, sign, unit, n) => {
      const u = ({ mins: "minutes", hours: "hours", days: "days", secs: "seconds" } as Record<string, string>)[unit.toLowerCase()];
      const val = sign === "-" ? `-(${n})` : `(${n})`;
      return `strftime('%Y-%m-%dT%H:%M:%fZ', ${/^now/i.test(base) ? "'now'" : base}, printf('%+d ${u}', ${val}))`;
    });
  // jsonb: x - 'k1' - 'k2' (hapus kunci) -> json_remove; x ? 'k' (kunci ada) -> json_type(...) is not null.
  t = t.replace(/([a-z_][\w.]*)((?:\s*-\s*'[a-z_][a-z0-9_]*')+)/gi, (_m, col, keys: string) =>
    `json_remove(${col}, ${[...keys.matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((k) => `'$.${k[1]}'`).join(", ")})`);
  t = t.replace(/([a-z_][\w.]*)\s+\?\s+'([a-z_][a-z0-9_]*)'/gi, (_m, col, key) => `(json_type(${col}, '$.${key}') is not null)`);
  // greatest/least(a,b) null-aman; <operan>::int/numeric -> cast(); jsonb_array_length(x->'k') -> json_array_length.
  t = rewriteExtremes(t);
  t = rewriteCasts(t);
  t = t.replace(/jsonb_array_length\(\s*([a-z_][\w.]*)\s*->\s*'([a-z_][a-z0-9_]*)'\s*\)/gi, "json_array_length($1, '$.$2')");
  // coalesce(kolom, '{}'::jsonb) || ?  ->  json_patch(...). Setara dengan || jsonb untuk patch berisi nilai skalar/array
  // (kasus di aplikasi ini); beda: json_patch menggabung objek bersarang dan membuang kunci bernilai null.
  t = t.replace(/coalesce\(\s*([\w.]+)\s*,\s*'\{\}'::jsonb\s*\)\s*\|\|\s*\?/gi, "json_patch(coalesce($1, '{}'), ?)");
  t = t.replace(/\bnow\(\)\s*-\s*interval\s+'(\d+)\s+(second|minute|hour|day)s?'/gi,
    (_m, n, u) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','-${n} ${u}s')`);
  t = t.replace(/\bnow\(\)\s*\+\s*interval\s+'(\d+)\s+(second|minute|hour|day)s?'/gi,
    (_m, n, u) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','+${n} ${u}s')`);
  t = t.replace(/\bnow\(\)/gi, NOW);
  t = t.replace(/::(uuid|text|jsonb|json|timestamptz|date)\b(\[\])?/gi, "");
  const bad = [
    [/::\s*(int|integer|bigint|numeric|float|real|boolean)\b/i, "cast ::tipe yang operannya tak dikenal / ::boolean (tulis ulang pakai cast(x as ...))"],
    [/\bfor\s+update\b/i, "for update"],
    [/\bilike\b/i, "ilike (pakai lower(a) like lower(b))"],
    [/=\s*any\s*\(/i, "= any(...) (pakai in ${tx(list)})"],
    [/\binterval\b|make_interval/i, "interval yang tidak dikenal"],
    [/\bjsonb_[a-z_]+\s*\(|\bto_jsonb\s*\(|\bjsonb_typeof\b/i, "fungsi jsonb_*/to_jsonb (pakai json_* SQLite)"],
    [/\?\s*['|&]|[\w)]\s+-\s*'|@>|<@|#>/, "operator jsonb (-, ?, @>, #>) di luar pola yang dikenal"],
    [/\bgen_random_uuid\s*\(/i, "gen_random_uuid() (default kolom D1 sudah membuat uuid)"],
    [/\bdate_trunc\s*\(|\bto_char\s*\(|\bextract\s*\(/i, "date_trunc/to_char/extract (pakai strftime)"],
    [/\bwith\s+ordinality\b|\bunnest\s*\(/i, "unnest/ordinality"],
  ] as const;
  for (const [re, why] of bad) if (re.test(t)) throw new Error(`d1: sintaks Postgres belum didukung: ${why}\nSQL: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
  return t;
}

function build(strings: TemplateStringsArray, values: unknown[]): Fragment {
  let text = strings[0];
  const params: unknown[] = [];
  values.forEach((v, i) => {
    const next = strings[i + 1];
    if (v instanceof Ident) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(v.name)) throw new Error(`d1: nama identifier tidak valid: ${v.name}`);
      text += `"${v.name}"`;
    } else if (v instanceof List) {
      if (!v.items.length) throw new Error("d1: tx(list) kosong ('in ()' tidak valid)");
      text += `(${v.items.map(() => "?").join(",")})`;
      params.push(...v.items.map(bind));
    } else if (v instanceof Json) {
      text += "?";
      params.push(JSON.stringify(v.v));
    } else if (v instanceof Values) {
      throw new Error("d1: tx(rows, ...kolom) hanya boleh setelah 'insert into <tabel>'");
    } else {
      text += "?";
      params.push(bind(v));
    }
    text += next;
  });
  return { text: translateSql(text), params };
}

class Pending { strings: TemplateStringsArray; values: unknown[]; constructor(s: TemplateStringsArray, v: unknown[]) { this.strings = s; this.values = v; } }
export type Lazy = {
  (strings: TemplateStringsArray, ...values: unknown[]): unknown;
  (rows: Row[], ...cols: string[]): unknown;
  (list: unknown[]): unknown;
  json(v: unknown): unknown;
};

export interface D1Sql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Rows>;
  (list: unknown[]): List;
  (rows: Row[], ...cols: string[]): Values;
  (rows: Row[], cols: string[]): Values;
  (name: string): Ident;
  json(v: unknown): Json;
  begin<T>(fn: (tx: D1Sql) => Promise<T>): Promise<T>;
  savepoint<T>(fn: (sp: D1Sql) => Promise<T>): Promise<T>;
  /** Pembentuk query tertunda untuk batch(): lazy`...` tidak dijalankan sampai dikirim lewat batch(). */
  lazy: Lazy;
  /** Jalankan beberapa query lazy sebagai SATU transaksi D1 (semua berhasil atau semua batal). Hasil: satu Rows per item. */
  batch(items: unknown[]): Promise<Rows[]>;
  readonly ctx?: Ctx;
  /** Versi tanpa pembatasan sekolah (padanan SECURITY DEFINER); hanya untuk dbfn.ts. */
  unscoped(): D1Sql;
  /** Penanda backend: kode bersama memakai ini untuk memilih jalur D1 vs Neon. */
  readonly isD1: true;
}

// scope: batasi ke school_id sesi (meniru RLS); open: tanpa batas (owner / unscoped()); deny: query akar tanpa konteks.
type Mode = { kind: "scope"; schoolId: string } | { kind: "open" } | { kind: "deny" };

function guard(f: Fragment, mode: Mode): Fragment {
  if (mode.kind === "open") return f;
  if (mode.kind === "deny") {
    const t = tablesIn(f.text);
    if (t.length) throw new Error(`d1: query ke tabel tenant (${t.join(",")}) tanpa withTenant(); pakai withTenantD1 atau sql.unscoped() bila memang lintas-tenant`);
    return f;
  }
  if (/^\s*insert\b/i.test(f.text)) checkInsert(f.text, f.params, mode.schoolId);
  return { text: scopeSql(f.text, mode.schoolId), params: f.params };
}

// D1 mengembalikan kolom jsonb sebagai teks; Postgres sebagai objek. Kolom ini diurai agar kode bersama tak berubah.
// "content" juga nama kolom teks biasa di exam_messages, jadi dilewati bila query menyebut tabel itu.
const JSON_COLS = ["content", "answer_key", "answer", "payload", "scoring_config", "question_order", "details"];
// Kolom boolean (juga hasil turunan has_*): D1 mengembalikan 0/1, Postgres true/false. Penting karena nilainya ikut
// tertulis ke HTML (mis. data-on="${u.active}" lalu dibandingkan dengan 'true' di skrip klien).
const BOOL_COLS = ["active", "shuffle_questions", "shuffle_options", "use_token", "show_score", "strict_order",
  "flagged", "has_logo", "has_essay", "has_image", "mine"];
function parseJsonCols(rows: Row[], text: string): void {
  const chat = /\bexam_messages\b/i.test(text);
  for (const r of rows) {
    for (const c of BOOL_COLS) { const v = r[c]; if (v === 0 || v === 1) r[c] = v === 1; }
    for (const c of JSON_COLS) {
      const v = r[c];
      if (typeof v !== "string" || (c === "content" && chat)) continue;
      const ch = v.charCodeAt(0); // { atau [
      if (ch !== 123 && ch !== 91) continue;
      try { r[c] = JSON.parse(v); } catch { /* biarkan teks */ }
    }
  }
}

async function run(db: D1Database, f0: Fragment, mode: Mode): Promise<Rows> {
  const f = guard(f0, mode);
  if (f.params.length > MAX_PARAMS) throw new Error(`d1: ${f.params.length} parameter melebihi batas ${MAX_PARAMS} per query`);
  const r = await db.prepare(f.text).bind(...f.params).all<Row>();
  const rows = (r.results ?? []) as Rows;
  parseJsonCols(rows, f.text);
  rows.count = rows.length ? rows.length : (r.meta?.changes ?? 0);
  return rows;
}

const dbs = new WeakMap<object, D1Database>();
const dbOf = (sql: D1Sql): D1Database => dbs.get(sql)!;

function modeOf(ctx: Ctx | undefined, open: boolean): Mode {
  if (open) return { kind: "open" };
  if (!ctx) return { kind: "deny" };
  return ctx.role === "owner" ? { kind: "open" } : { kind: "scope", schoolId: ctx.schoolId };
}

function make(db: D1Database, ctx?: Ctx, open = false): D1Sql {
  const mode = modeOf(ctx, open);
  const fn = (first: unknown, ...rest: unknown[]): unknown => {
    if (Array.isArray(first) && "raw" in first) {
      const strings = first as unknown as TemplateStringsArray;
      // "insert into t ${tx(rows, ...)}" dipecah per 100 parameter, jadi ditangani terpisah.
      if (rest.some((v) => v instanceof Values)) return insertRows(db, strings, rest, mode);
      try { return run(db, build(strings, rest), mode); } catch (e) { return Promise.reject(e); }
    }
    if (typeof first === "string") return new Ident(first);
    if (Array.isArray(first)) {
      const cols = Array.isArray(rest[0]) ? (rest[0] as string[]) : (rest as string[]);
      return cols.length ? new Values(first as Row[], cols) : new List(first);
    }
    throw new Error("d1: pemanggilan tx(...) tidak dikenal");
  };
  const self = fn as unknown as { -readonly [K in keyof D1Sql]: D1Sql[K] };
  self.json = (v: unknown) => new Json(v);
  self.begin = (f) => f(make(db, ctx, open));
  self.savepoint = (f) => f(self as D1Sql);
  const lazy = ((first: unknown, ...rest: unknown[]) =>
    Array.isArray(first) && "raw" in first ? new Pending(first as unknown as TemplateStringsArray, rest) : fn(first, ...rest)) as unknown as Lazy;
  lazy.json = (v: unknown) => new Json(v);
  self.lazy = lazy;
  self.batch = (items) => runBatch(db, items, mode);
  self.unscoped = () => make(db, ctx, true);
  self.ctx = ctx;
  self.isD1 = true;
  dbs.set(self, db);
  return self as D1Sql;
}

function insertFrags(strings: TemplateStringsArray, values: unknown[]): Fragment[] {
  const idx = values.findIndex((v) => v instanceof Values);
  const vals = values[idx] as Values;
  const before = build(strings.slice(0, idx + 1) as unknown as TemplateStringsArray, values.slice(0, idx));
  const after = build(strings.slice(idx + 1) as unknown as TemplateStringsArray, values.slice(idx + 1));
  if (!vals.rows.length) return [];
  const per = Math.max(1, Math.floor((MAX_PARAMS - before.params.length - after.params.length) / vals.cols.length));
  const out: Fragment[] = [];
  for (let i = 0; i < vals.rows.length; i += per) {
    const chunk = vals.rows.slice(i, i + per);
    const cols = vals.cols.map((c) => `"${c}"`).join(",");
    const tuples = chunk.map(() => `(${vals.cols.map(() => "?").join(",")})`).join(",");
    out.push({
      text: `${before.text}(${cols}) values ${tuples}${after.text}`,
      params: [...before.params, ...chunk.flatMap((r) => vals.cols.map((c) => bind(r[c]))), ...after.params],
    });
  }
  return out;
}

async function insertRows(db: D1Database, strings: TemplateStringsArray, values: unknown[], mode: Mode): Promise<Rows> {
  const out = [] as unknown as Rows;
  let count = 0;
  for (const f of insertFrags(strings, values)) { // tidak atomik; pakai batch() bila harus atomik
    const r = await run(db, f, mode);
    out.push(...r);
    count += r.count;
  }
  out.count = count;
  return out;
}

async function runBatch(db: D1Database, items: unknown[], mode: Mode): Promise<Rows[]> {
  const frags: Fragment[] = [], owner: number[] = [];
  items.forEach((it, i) => {
    if (!(it instanceof Pending)) throw new Error("d1: batch() hanya menerima query lazy`...`");
    const fs = it.values.some((v) => v instanceof Values) ? insertFrags(it.strings, it.values) : [build(it.strings, it.values)];
    for (const f of fs) { const g = guard(f, mode); if (g.params.length > MAX_PARAMS) throw new Error(`d1: ${g.params.length} parameter melebihi batas ${MAX_PARAMS} per query`); frags.push(g); owner.push(i); }
  });
  const out = items.map(() => { const r = [] as unknown as Rows; r.count = 0; return r; });
  if (!frags.length) return out;
  const res = await db.batch(frags.map((f) => db.prepare(f.text).bind(...f.params))); // satu transaksi implisit
  res.forEach((r, k) => {
    const rows = (r.results ?? []) as Row[];
    parseJsonCols(rows, frags[k].text);
    const o = out[owner[k]];
    o.push(...rows);
    o.count += rows.length ? rows.length : (r.meta?.changes ?? 0);
  });
  return out;
}

export function connectD1(db: D1Database): D1Sql {
  return make(db);
}

// Pasangan withTenant() di db.ts. Tanpa RLS: ctx hanya dibawa untuk dipakai kode (filter school_id manual).
export function withTenantD1<T>(sql: D1Sql, ctx: Ctx, fn: (tx: D1Sql) => Promise<T>): Promise<T> {
  return fn(make(dbOf(sql), ctx));
}

// Untuk kode yang tx-nya bertipe postgres.js: true bila backend-nya D1.
export const isD1 = (tx: unknown): boolean => !!(tx as { isD1?: boolean }).isD1;
