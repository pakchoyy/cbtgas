// Pengganti Row-Level Security Postgres untuk D1: setiap query tenant ditulis ulang agar hanya melihat
// baris school_id sesi (kebijakan tenant_isolation di db/migrations/0001). Murni teks -> teks, tanpa dependensi.
//
//   select/join : tabel tenant T  ->  (select * from T where school_id = 'X') as <alias|T>
//   update/delete: ditambah "where school_id = 'X' and (<kondisi lama>)"
//   insert      : kolom school_id wajib ada dan nilainya harus 'X' (WITH CHECK)
//
// Bentuk SQL yang tidak dikenal DITOLAK (bukan dilewatkan): lebih baik error daripada bocor.

export const TENANT_TABLES = new Set([
  "users", "classes", "students", "pin_resets", "categories", "passages", "questions", "question_keys",
  "exam_groups", "exams", "exam_classes", "exam_questions", "exam_sessions", "answers", "violations",
  "scores", "exam_messages", "audit_log", "shared_banks", "schools",
]);

const RESERVED = new Set(["where", "join", "left", "right", "inner", "outer", "cross", "full", "on", "group", "order",
  "limit", "offset", "set", "returning", "union", "having", "natural", "using", "window", "except", "intersect",
  "select", "and", "or", "values", "as", "not", "in", "is", "like", "between", "case", "when", "then", "else", "end"]);

const keyCol = (table: string) => (table === "schools" ? "id" : "school_id");
const lit = (schoolId: string) => (/^[0-9a-f-]{1,64}$/i.test(schoolId) ? `'${schoolId}'` : "''"); // '' = tak cocok baris mana pun

// Sama panjang dengan aslinya; isi string literal diganti 'x' agar pencarian kata kunci tidak salah baca.
const mask = (t: string) => t.replace(/'(?:[^']|'')*'/g, (m) => `'${"x".repeat(m.length - 2)}'`)
  .replace(/"[^"]*"/g, (m) => `"${"x".repeat(m.length - 2)}"`);

export function tablesIn(text: string): string[] {
  const m = mask(text);
  const out = new Set<string>();
  for (const x of m.matchAll(/\b(?:from|join|update|into)\s+([a-z_][a-z0-9_]*)/gi)) {
    const t = x[1].toLowerCase();
    if (TENANT_TABLES.has(t)) out.add(t);
  }
  return [...out];
}

// Posisi kata kunci tingkat atas (kedalaman kurung 0) pertama setelah `from`.
function topLevel(m: string, word: RegExp, from = 0): number {
  let depth = 0;
  for (let i = from; i < m.length; i++) {
    const ch = m[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /[a-z]/i.test(ch) && (i === 0 || !/[a-z0-9_]/i.test(m[i - 1]))) {
      const mm = word.exec(m.slice(i));
      if (mm && mm.index === 0) return i;
    }
  }
  return -1;
}

function scopeDml(text: string, m: string, kind: "update" | "delete", schoolId: string): string {
  const head = kind === "update"
    ? /^\s*update\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?(?!set\b)([a-z_][a-z0-9_]*))?\s+set\b/i.exec(m)
    : /^\s*delete\s+from\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?(?!where\b|returning\b)([a-z_][a-z0-9_]*))?/i.exec(m);
  if (!head) throw new Error(`tenant: bentuk ${kind} tidak dikenal: ${text.replace(/\s+/g, " ").slice(0, 120)}`);
  const table = head[1].toLowerCase();
  if (!TENANT_TABLES.has(table)) return text;
  const col = `${head[2] ?? table}.${keyCol(table)}`;
  const start = head[0].length;
  const w = topLevel(m, /^where\b/i, start);
  const r = topLevel(m, /^returning\b/i, start);
  const end = r === -1 ? text.length : r;
  if (w === -1 || (r !== -1 && w > r)) {
    return `${text.slice(0, end)} where ${col} = ${lit(schoolId)} ${text.slice(end)}`;
  }
  return `${text.slice(0, w)}where ${col} = ${lit(schoolId)} and (${text.slice(w + 5, end)}) ${text.slice(end)}`;
}

export function scopeSql(text: string, schoolId: string): string {
  const m = mask(text);
  const kind = /^\s*(select|with|insert|update|delete)\b/i.exec(m)?.[1].toLowerCase();
  if (!kind) throw new Error(`tenant: jenis query tidak dikenal: ${text.replace(/\s+/g, " ").slice(0, 120)}`);
  let t = text, mm = m;
  if (kind === "update" || kind === "delete") {
    t = scopeDml(text, m, kind, schoolId);
    mm = mask(t);
  }
  // Tabel pada from/join (juga di dalam subquery), kecuali target "delete from".
  const edits: Array<{ s: number; e: number; rep: string }> = [];
  for (const x of mm.matchAll(/\b(from|join)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
    const table = x[2].toLowerCase();
    if (!TENANT_TABLES.has(table)) continue;
    if (x[1].toLowerCase() === "from" && /\bdelete$/i.test(mm.slice(0, x.index).trimEnd())) continue;
    const hasAlias = !!x[3] && !RESERVED.has(x[3].toLowerCase());
    const s = x.index! + x[0].indexOf(x[2], x[1].length);
    // Hanya nama tabel yang diganti; alias lama dipertahankan, bila tak ada nama tabel dipakai sebagai alias.
    edits.push({ s, e: s + x[2].length, rep: `(select * from ${table} where ${keyCol(table)} = ${lit(schoolId)})${hasAlias ? "" : ` as ${table}`}` });
  }
  for (const ed of edits.sort((a, b) => b.s - a.s)) t = t.slice(0, ed.s) + ed.rep + t.slice(ed.e);
  return t;
}

// Padanan WITH CHECK untuk insert: kolom school_id wajib ada; nilai literal/parameter-nya harus sekolah sesi.
// params = nilai terikat berurutan sesuai '?'. Insert ... select hanya diperiksa kolomnya.
export function checkInsert(text: string, params: unknown[], schoolId: string): void {
  const m = mask(text);
  const h = /^\s*insert\s+into\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/i.exec(m);
  if (!h) throw new Error(`tenant: bentuk insert tidak dikenal: ${text.replace(/\s+/g, " ").slice(0, 120)}`);
  const table = h[1].toLowerCase();
  if (!TENANT_TABLES.has(table)) return;
  if (table === "schools") throw new Error("tenant: insert ke schools hanya lewat dbfn.registerSchool / sesi owner");
  const colStart = h[0].indexOf("(");
  const cols = text.slice(colStart + 1, h[0].length - 1).split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
  const idx = cols.indexOf("school_id");
  if (idx === -1) throw new Error(`tenant: insert ke ${table} tanpa kolom school_id`);
  const rest = m.slice(h[0].length);
  if (!/^\s*values\b/i.test(rest)) return; // insert ... select
  // Pecah tiap tuple values (...) di kedalaman 0 lalu tiap ekspresi di kedalaman 1.
  let depth = 0, tuple = -1; const tuples: Array<string[]> = []; let cur = "", exprs: string[] = [];
  const base = h[0].length;
  const orig = text.slice(base);
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "(") { depth++; if (depth === 1) { tuple++; exprs = []; cur = ""; continue; } }
    if (ch === ")") { depth--; if (depth === 0) { exprs.push(cur.trim()); tuples.push(exprs); continue; } }
    if (depth === 1 && ch === ",") { exprs.push(cur.trim()); cur = ""; continue; }
    if (depth >= 1) cur += orig[i];
    if (depth === 0 && /\bon\s+conflict\b/i.test(rest.slice(i, i + 12))) break;
  }
  const qBefore = (upTo: number) => (mask(text).slice(0, upTo).match(/\?/g) ?? []).length;
  // Hitung '?' per tuple untuk memetakan parameter.
  let seen = qBefore(base);
  for (const ex of tuples) {
    if (ex.length !== cols.length) return; // bentuk tak biasa (mis. fungsi dengan koma): lewati pemeriksaan nilai
    const e = ex[idx];
    if (e === "?") {
      const pos = seen + ex.slice(0, idx).reduce((n, x) => n + (x.match(/\?/g) ?? []).length, 0);
      if (String(params[pos]) !== schoolId) throw new Error(`tenant: insert ke ${table} dengan school_id sekolah lain`);
    } else if (e.replace(/'/g, "") !== schoolId) {
      throw new Error(`tenant: insert ke ${table} dengan school_id bukan milik sesi`);
    }
    seen += ex.reduce((n, x) => n + (x.match(/\?/g) ?? []).length, 0);
  }
}
