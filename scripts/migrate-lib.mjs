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

export function insertSql(table, rows) {
  const cols = table.cols;
  const names = cols.map((c) => c.name).join(", ");
  return rows.map((r) => `INSERT INTO ${table.name} (${names}) VALUES (${cols.map((c) => literal(r[c.name], c)).join(", ")});`);
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
  const parts = tables.map((t) => `SELECT '${t.name}' AS t, COUNT(*) AS n FROM ${t.name}`);
  parts.push("SELECT 'scores.sum_final' AS t, ROUND(COALESCE(SUM(final_score), 0), 2) AS n FROM scores");
  parts.push("SELECT 'answers.with_json' AS t, COUNT(*) AS n FROM answers WHERE answer IS NOT NULL");
  return parts.join(" UNION ALL ");
}

export function compareCounts(neon, d1) {
  const problems = [];
  for (const k of Object.keys(neon)) {
    if (!(k in d1)) problems.push(`${k}: tidak ada di D1`);
    else if (Math.abs(Number(neon[k]) - Number(d1[k])) > 0.005) problems.push(`${k}: Neon=${neon[k]} D1=${d1[k]}`);
  }
  return problems;
}
