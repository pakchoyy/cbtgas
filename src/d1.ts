// Adapter D1 yang meniru bagian postgres.js yang dipakai aplikasi ini (langkah 2 migrasi Neon -> D1).
// Belum dipasang ke rute mana pun; db.ts/Neon tetap jalan. Dipakai dengan: connectD1(env.DB).
//
// Yang ditiru:  sql`...${v}...`, tx`...`, tx(list) untuk "in ${tx(ids)}", tx(rows, ...kolom) untuk
//               "insert into t ${tx(rows, ...)}", tx(namaTabel), tx.json(v), begin(), savepoint(), hasil
//               berupa array baris dengan properti .count.
// Terjemahan:   now() -> waktu ISO UTC; now() - interval 'N unit' -> strftime(...,'-N unit'); cast ::uuid/::text/
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

export function translateSql(text: string): string {
  let t = text;
  t = t.replace(/\bnow\(\)\s*-\s*interval\s+'(\d+)\s+(second|minute|hour|day)s?'/gi,
    (_m, n, u) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','-${n} ${u}s')`);
  t = t.replace(/\bnow\(\)\s*\+\s*interval\s+'(\d+)\s+(second|minute|hour|day)s?'/gi,
    (_m, n, u) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','+${n} ${u}s')`);
  t = t.replace(/\bnow\(\)/gi, NOW);
  t = t.replace(/::(uuid|text|jsonb|json|timestamptz|date)\b(\[\])?/gi, "");
  const bad = [
    [/::\s*(int|integer|bigint|numeric|float|real|boolean)\b/i, "cast ::tipe angka/boolean (tulis ulang pakai cast(x as ...))"],
    [/\bfor\s+update\b/i, "for update"],
    [/\bilike\b/i, "ilike (pakai lower(a) like lower(b))"],
    [/=\s*any\s*\(/i, "= any(...) (pakai in ${tx(list)})"],
    [/\binterval\b/i, "interval yang tidak dikenal"],
    [/\bjsonb_[a-z_]+\s*\(|\bto_jsonb\s*\(|\bjsonb_typeof\b/i, "fungsi jsonb_*/to_jsonb (pakai json_* SQLite)"],
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

export interface D1Sql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Rows>;
  (list: unknown[]): List;
  (rows: Row[], ...cols: string[]): Values;
  (rows: Row[], cols: string[]): Values;
  (name: string): Ident;
  json(v: unknown): Json;
  begin<T>(fn: (tx: D1Sql) => Promise<T>): Promise<T>;
  savepoint<T>(fn: (sp: D1Sql) => Promise<T>): Promise<T>;
  /** Hanya D1: jalankan beberapa query secara atomik (satu-satunya cara atomik di D1). */
  batch(queries: Promise<Rows>[]): never;
  readonly ctx?: Ctx;
  /** Penanda backend: kode bersama memakai ini untuk memilih jalur D1 vs Neon. */
  readonly isD1: true;
}

async function run(db: D1Database, f: Fragment): Promise<Rows> {
  if (f.params.length > MAX_PARAMS) throw new Error(`d1: ${f.params.length} parameter melebihi batas ${MAX_PARAMS} per query`);
  const r = await db.prepare(f.text).bind(...f.params).all<Row>();
  const rows = (r.results ?? []) as Rows;
  rows.count = rows.length ? rows.length : (r.meta?.changes ?? 0);
  return rows;
}

const dbs = new WeakMap<object, D1Database>();
const dbOf = (sql: D1Sql): D1Database => dbs.get(sql)!;

function make(db: D1Database, ctx?: Ctx): D1Sql {
  const fn = (first: unknown, ...rest: unknown[]): unknown => {
    if (Array.isArray(first) && "raw" in first) {
      const strings = first as unknown as TemplateStringsArray;
      // "insert into t ${tx(rows, ...)}" dipecah per 100 parameter, jadi ditangani terpisah.
      if (rest.some((v) => v instanceof Values)) return insertRows(db, strings, rest);
      try { return run(db, build(strings, rest)); } catch (e) { return Promise.reject(e); }
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
  self.begin = (f) => f(make(db, ctx));
  self.savepoint = (f) => f(self as D1Sql);
  self.batch = (() => { throw new Error("d1: batch() belum dipasang (langkah 3)"); }) as never;
  self.ctx = ctx;
  self.isD1 = true;
  dbs.set(self, db);
  return self as D1Sql;
}

async function insertRows(db: D1Database, strings: TemplateStringsArray, values: unknown[]): Promise<Rows> {
  const idx = values.findIndex((v) => v instanceof Values);
  const vals = values[idx] as Values;
  const before = build(strings.slice(0, idx + 1) as unknown as TemplateStringsArray, values.slice(0, idx));
  const afterStrings = strings.slice(idx + 1);
  const after = build(afterStrings as unknown as TemplateStringsArray, values.slice(idx + 1));
  if (!vals.rows.length) { const r = [] as unknown as Rows; r.count = 0; return r; }
  const per = Math.max(1, Math.floor((MAX_PARAMS - before.params.length - after.params.length) / vals.cols.length));
  const out = [] as unknown as Rows;
  let count = 0;
  for (let i = 0; i < vals.rows.length; i += per) {
    const chunk = vals.rows.slice(i, i + per);
    const cols = vals.cols.map((c) => `"${c}"`).join(",");
    const tuples = chunk.map(() => `(${vals.cols.map(() => "?").join(",")})`).join(",");
    const params = [...before.params, ...chunk.flatMap((r) => vals.cols.map((c) => bind(r[c]))), ...after.params];
    const r = await run(db, { text: `${before.text}(${cols}) values ${tuples}${after.text}`, params });
    out.push(...r);
    count += r.count;
  }
  out.count = count;
  return out;
}

export function connectD1(db: D1Database): D1Sql {
  return make(db);
}

// Pasangan withTenant() di db.ts. Tanpa RLS: ctx hanya dibawa untuk dipakai kode (filter school_id manual).
export function withTenantD1<T>(sql: D1Sql, ctx: Ctx, fn: (tx: D1Sql) => Promise<T>): Promise<T> {
  return fn(make(dbOf(sql), ctx));
}
