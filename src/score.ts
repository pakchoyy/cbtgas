// Rumus nilai sesi ujian dalam TypeScript: padanan fungsi Postgres score_session() (db/migrations/0017).
// Dipakai jalur D1 (writeScore di scoring.ts). Jalur Neon tetap memakai fungsi SQL-nya sampai D1 teruji.
// Aturan sengaja disalin apa adanya, termasuk keganjilannya (lihat komentar "padanan SQL").

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type Item = {
  type: string;
  points: number;   // questions.points
  weight: number;   // bobot kategori (default 1)
  penalty: number;  // scoring_config.wrong_penalty (default 0)
  key: Json;        // question_keys.answer_key atau null bila tak ada kunci
  ans: Json;        // answers.answer atau null bila belum dijawab
};
export type Score = { got: number; total: number; manual_pending: number };

// Kolom JSON kembali sebagai string dari D1, sebagai objek dari Neon.
export function parseJson(v: unknown): Json {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
}

// Padanan SQL: (x)::numeric / ::int. Null bila kosong atau bukan angka.
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};
const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);

// Kesetaraan jsonb: urutan kunci objek tidak berpengaruh, urutan array berpengaruh.
export function jsonEq(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => jsonEq(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && jsonEq(a[k], b[k]));
}

// true/false/null seperti logika tiga nilai SQL. null = tidak bisa dinilai (dianggap tidak benar).
function judge(it: Item): boolean | null {
  const { type, key, ans } = it;
  const k = isObj(key) ? key : {}, a = isObj(ans) ? ans : {};
  switch (type) {
    case "pg":
    case "benar_salah": {
      const x = num(k.index), y = num(a.index);
      return x === null || y === null ? null : x === y;
    }
    case "isian": {
      const acc = Array.isArray(k.accepted) ? k.accepted : [];
      const typed = a.text === undefined || a.text === null ? null : String(a.text).trim().toLowerCase();
      return typed !== null && acc.some((x: Json) => String(x).trim().toLowerCase() === typed);
    }
    case "menjodohkan":
      return k.pairs === undefined || a.pairs === undefined ? null : jsonEq(a.pairs, k.pairs);
    case "dinamis_hitung": {
      const va = isObj(a.vars) ? a.vars : {};
      const x = num(va.a), y = num(va.b), typed = num(a.text);
      if (x === null || y === null || typed === null) return null;
      let r: number | null;
      switch (k.formula) {
        case "+": r = x + y; break;
        case "-": r = x - y; break;
        case "*": r = x * y; break;
        case "/": r = y === 0 ? null : x / y; break;
        default: r = null;
      }
      // Postgres numeric eksak; float JS butuh toleransi (0.1+0.2).
      return r === null ? null : Math.abs(r - typed) < 1e-9;
    }
    default:
      return null;
  }
}

export function scoreItem(it: Item): number {
  const { type, points, weight, penalty, key, ans } = it;
  const pts = points * weight;
  const k = isObj(key) ? key : {}, a = isObj(ans) ? ans : {};
  const benar = judge(it);
  let v: number;
  switch (type) {
    case "pg":
    case "benar_salah":
      // Padanan SQL: salah = menjawab tanpa kunci pun kena penalti; tidak dijawab = 0.
      v = benar === true ? pts : isObj(ans) && "index" in ans ? -pts * penalty : 0;
      break;
    case "pgk_centang": {
      const correct: Json[] = Array.isArray(k.correct) ? k.correct : [];
      const sel: Json[] = Array.isArray(a.selected) ? a.selected : [];
      const cset = new Set(correct.map(num)), sset = new Set(sel.map(num));
      const hits = correct.filter((c) => sset.has(num(c))).length;
      const wrong = sel.filter((s) => !cset.has(num(s))).length;
      v = correct.length ? Math.max(0, ((hits - wrong) / correct.length) * pts) : 0;
      break;
    }
    case "pgk_kategori": {
      const vals: Json[] = Array.isArray(k.values) ? k.values : [];
      const cats: Json[] = Array.isArray(a.cats) ? a.cats : [];
      v = vals.length ? (vals.filter((x, i) => cats[i] !== undefined && jsonEq(cats[i], x)).length / vals.length) * pts : 0;
      break;
    }
    case "uraian":
    case "simulasi":
      v = num(a.manual_score) ?? 0; // tidak dikali bobot kategori (sama dengan SQL)
      break;
    default:
      v = benar === true ? pts : 0;
  }
  const hint = a.hint_used === true || a.hint_used === "true";
  return v * (hint ? 0.5 : 1);
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6; // buang debu floating point

export function scoreItems(items: Item[]): Score {
  let got = 0, total = 0, pending = 0;
  for (const it of items) {
    got += scoreItem(it);
    const pts = it.points * it.weight;
    total += pts;
    const a = isObj(it.ans) ? it.ans : {};
    if ((it.type === "uraian" || it.type === "simulasi") && (a.manual_score === undefined || a.manual_score === null)) pending += pts;
  }
  return { got: r6(got), total: r6(total), manual_pending: r6(pending) };
}

// Ambil data sesi lewat query portabel (Neon maupun D1), lalu hitung di kode.
export async function scoreSession(tx: Tx, sessionId: string): Promise<Score> {
  const s = await tx`select es.exam_id, es.question_order, e.scoring_config
                     from exam_sessions es join exams e on e.id = es.exam_id where es.id = ${sessionId}`;
  if (!s.length) return { got: 0, total: 0, manual_pending: 0 };
  const cfg = parseJson(s[0].scoring_config) ?? {};
  const qo = parseJson(s[0].question_order);
  let order: unknown = Array.isArray(qo) ? qo : isObj(qo) && Array.isArray(qo.order) ? qo.order : null;
  if (!order) {
    const eq = await tx`select question_id from exam_questions where exam_id = ${s[0].exam_id}`;
    order = (eq as Array<{ question_id: string }>).map((r) => r.question_id);
  }
  const ids = (order as string[]);
  const byId = new Map<string, Json>();
  for (let i = 0; i < ids.length; i += 90) { // D1: maks 100 parameter per query
    const chunk = ids.slice(i, i + 90);
    const rows = await tx`select q.id, q.type, q.points, q.category_id, k.answer_key, a.answer
      from questions q
      left join question_keys k on k.question_id = q.id
      left join answers a on a.session_id = ${sessionId} and a.question_id = q.id
      where q.id in ${tx(chunk)}`;
    for (const r of rows as Json[]) byId.set(r.id, r);
  }
  const weights = isObj(cfg.category_weights) ? cfg.category_weights : {};
  const penalty = num(cfg.wrong_penalty) ?? 0;
  const items: Item[] = [];
  for (const id of ids) { // soal yang sudah dihapus dilewati (sama dengan inner join di SQL)
    const r = byId.get(id);
    if (!r) continue;
    items.push({
      type: r.type, points: num(r.points) ?? 0,
      weight: (r.category_id ? num(weights[r.category_id]) : null) ?? 1,
      penalty, key: parseJson(r.answer_key), ans: parseJson(r.answer),
    });
  }
  return scoreItems(items);
}
