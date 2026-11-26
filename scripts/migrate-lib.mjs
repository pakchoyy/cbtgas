// Logika murni penyalinan Neon -> D1 (tanpa I/O), supaya bisa dites. Daftar kolom/tipe DIAMBIL DARI db/d1/0001_init.sql,
// jadi tidak bisa menyimpang dari skema D1.

// Urutan aman untuk foreign key (induk dulu). rate_counters sengaja dilewati: data sementara.
export const ORDER = [
  "schools", "users", "system_owners", "classes", "students", "pin_resets", "categories", "passages", "questions",
  "question_keys", "exam_groups", "exams", "exam_classes", "exam_questions", "exam_sessions", "answers", "violations",
  "scores", "exam_messages", "audit_log", "shared_banks",
];
export const SKIP = ["rate_counters"];

// Parse "CREATE TABLE t ( ... );" -> { name, cols: [{ name, type, json, bool }] }
export function parseSchema(sql) {
  const tables = [];
  for (const m of sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
    const cols = [];
    for (const raw of m[2].split("\n")) {
      const line = raw.replace(/--.*$/, "").trim();
      const c = /^(\w+)\s+(text|integer|real)\b/.exec(line);
      if (!c || /^(UNIQUE|PRIMARY|CHECK|FOREIGN)\b/i.test(line)) continue;
      cols.push({
        name: c[1], type: c[2],
        json: new RegExp(`json_valid\\(${c[1]}\\)`).test(line),
        bool: new RegExp(`${c[1]} IN \\(0,1\\)`).test(line),
      });
    }
    tables.push({ name: m[1], cols });
  }
  return tables;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Nilai Postgres (hasil postgres.js) -> literal SQL SQLite sesuai tipe kolom D1.
export function literal(v, col) {
  if (v === null || v === undefined) return "NULL";
  if (col.json) return q(typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v));
  if (col.bool) return v === true || v === "t" || v === 1 || v === "1" ? "1" : "0";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error(`tanggal tidak valid di kolom ${col.name}`);
    return q(v.toISOString());
  }
  if (col.type === "integer" || col.type === "real") {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`angka tidak valid di kolom ${col.name}: ${v}`);
    return String(n);
  }
  if (typeof v === "object") return q(JSON.stringify(v)); // jaga-jaga: objek di kolom teks
  return q(v);
}

// D1 menolak statement > 100 KB (SQLITE_TOOBIG), mis. logo data URI. Teks panjang (bukan JSON) dimasukkan bertahap:
// INSERT dengan potongan pertama, lalu UPDATE ... SET kolom = kolom || potongan berikutnya (berdasarkan id).
export const CHUNK = 20000; // karakter; maks. 4 byte UTF-8 per karakter -> < 100 KB per statement

function chunks(str) {
  const out = [];
  for (let i = 0; i < str.length; ) {
    let end = Math.min(i + CHUNK, str.length);
    const c = str.charCodeAt(end - 1);
    if (end < str.length && c >= 0xd800 && c <= 0xdbff) end--; // jangan memotong pasangan surrogate
    out.push(str.slice(i, end)); i = end;
  }
  return out;
}

// Kunci baris untuk UPDATE bertahap (kolom yang mengidentifikasi satu baris).
const KEYS = { question_keys: ["question_id"], answers: ["session_id", "question_id"], scores: ["session_id"] };
const keyOf = (table) => (table.cols.some((c) => c.name === "id") ? ["id"] : KEYS[table.name] ?? null);

export function insertSql(table, rows) {
  const key = keyOf(table);
  const stmts = [];
  for (const r of rows) {
    // Kolom yang tidak ada di sumber (kolom baru D1, mis. answered_count) dilewati -> nilai bawaan skema dipakai.
    const cols = table.cols.filter((c) => r[c.name] !== undefined);
    const names = cols.map((c) => c.name).join(", ");
    const rest = [];
    const where = () => key.map((k) => `${k} = ${q(r[k])}`).join(" AND ");
    const vals = cols.map((c) => {
      const v = r[c.name];
      const text = c.json ? (v === null || v === undefined ? null : JSON.stringify(v)) : typeof v === "string" ? v : null;
      if (text === null || text.length <= CHUNK || (c.type !== "text")) return literal(v, c);
      if (!key) throw new Error(`nilai terlalu panjang di ${table.name}.${c.name} (tabel tanpa kunci baris)`);
      const [first, ...more] = chunks(text);
      if (!c.json) {
        // teks biasa: sambung langsung di kolomnya
        rest.push(...more.map((part) => `UPDATE ${table.name} SET ${c.name} = ${c.name} || ${q(part)} WHERE ${where()};`));
        return q(first);
      }
      // JSON: potongan tak valid sebagai JSON (CHECK json_valid), jadi dirakit di tabel penampung tanpa CHECK lalu dipindah utuh.
      const k = q(`${table.name}.${c.name}.${key.map((x) => r[x]).join("/")}`);
      rest.push(
        "CREATE TABLE IF NOT EXISTS _mig_buf (k TEXT PRIMARY KEY, v TEXT NOT NULL);",
        `INSERT INTO _mig_buf (k, v) VALUES (${k}, ${q(first)});`,
        ...more.map((part) => `UPDATE _mig_buf SET v = v || ${q(part)} WHERE k = ${k};`),
        `UPDATE ${table.name} SET ${c.name} = (SELECT v FROM _mig_buf WHERE k = ${k}) WHERE ${where()};`,
        "DROP TABLE _mig_buf;",
      );
      return "'null'"; // JSON sah sementara; diganti nilai utuh oleh UPDATE di atas
    });
    stmts.push(`INSERT INTO ${table.name} (${names}) VALUES (${vals.join(", ")});`, ...rest);
  }
  return stmts;
}

// categories punya parent_id ke dirinya sendiri: induk harus lebih dulu.
export function parentsFirst(rows) {
  const byId = new Map(rows.map((r) => [r.id, r])), out = [], seen = new Set();
  const visit = (r, depth = 0) => {
    if (seen.has(r.id) || depth > 1000) return;
    const p = r.parent_id && byId.get(r.parent_id);
    if (p) visit(p, depth + 1);
    seen.add(r.id); out.push(r);
  };
  rows.forEach((r) => visit(r));
  return out;
}

// Kueri hitung untuk dijalankan di D1 (wrangler d1 execute --json --command "...") dan di Neon: kunci & hasil harus sama.
export function countQuery(tables) {
  // D1 membatasi jumlah suku UNION ALL; VALUES banyak baris + CASE tidak terkena batas itu.
  const items = tables.map((t) => [t.name, `(SELECT COUNT(*) FROM ${t.name})`]);
  items.push(["scores.sum_final", "(SELECT ROUND(COALESCE(SUM(final_score), 0), 2) FROM scores)"]);
  items.push(["answers.with_json", "(SELECT COUNT(*) FROM answers WHERE answer IS NOT NULL)"]);
  const values = items.map(([k]) => `('${k}')`).join(", ");
  const cases = items.map(([k, q]) => `WHEN '${k}' THEN ${q}`).join(" ");
  return `WITH k(t) AS (VALUES ${values}) SELECT t, CASE t ${cases} END AS n FROM k`;
}

export function compareCounts(neon, d1) {
  const problems = [];
  for (const k of Object.keys(neon)) {
    if (!(k in d1)) problems.push(`${k}: tidak ada di D1`);
    else if (Math.abs(Number(neon[k]) - Number(d1[k])) > 0.005) problems.push(`${k}: Neon=${neon[k]} D1=${d1[k]}`);
  }
  return problems;
}
