// Varian D1 untuk query statistik yang di Neon memakai jsonb_*, array_agg, ntile, dll.
// Hasilnya dihitung di TypeScript dengan bentuk baris yang sama seperti query SQL aslinya.
// Neon tetap menjalankan query SQL aslinya (lihat api.ts, student.ts, analytics.ts).
import { jsonEq, num, isObj, parseJson } from "./score";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

// Padanan CASE "benar" di query statistik SQL (bukan rumus nilai!): pgk_centang benar hanya bila himpunan
// pilihan sama persis; uraian benar bila nilai manual >= 50% poin; tipe lain = salah.
// basic=true: hanya pg/benar_salah/isian (query rekomendasi belajar).
export function looseCorrect(type: string, key: Json, ans: Json, points: number, basic = false): boolean {
  const k = isObj(key) ? key : {}, a = isObj(ans) ? ans : {};
  switch (type) {
    case "pg":
    case "benar_salah": {
      const x = num(k.index), y = num(a.index);
      return x !== null && y !== null && x === y;
    }
    case "isian": {
      const acc = Array.isArray(k.accepted) ? k.accepted : [];
      if (a.text === undefined || a.text === null) return false;
      const t = String(a.text).trim().toLowerCase();
      return acc.some((x: Json) => String(x).trim().toLowerCase() === t);
    }
    case "pgk_centang": {
      if (basic) return false;
      const s = (v: Json) => (Array.isArray(v) ? v : []).map((x: Json) => num(x) ?? NaN).sort((p: number, q: number) => p - q);
      const c = s(k.correct), p = s(a.selected);
      return c.length === p.length && c.every((v: number, i: number) => v === p[i]);
    }
    case "menjodohkan":
      return !basic && k.pairs !== undefined && a.pairs !== undefined && jsonEq(a.pairs, k.pairs);
    case "uraian": {
      const m = num(a.manual_score);
      return !basic && m !== null && m >= points * 0.5;
    }
    default:
      return false;
  }
}

const NONE = "(tanpa kategori)";
const byName = (x: string | null, y: string | null) => (x === null ? 1 : y === null ? -1 : x.localeCompare(y));

type CatRow = { cat_id: string | null; cat_name: string | null; type: string; points: unknown; answer_key: unknown; answer: unknown };

async function answeredByStudent(tx: Tx, studentId: string): Promise<CatRow[]> {
  return tx`select cat.id as cat_id, cat.name as cat_name, q.type, q.points, k.answer_key, a.answer
    from answers a
    join questions q on q.id = a.question_id
    join exam_sessions es on es.id = a.session_id
    left join question_keys k on k.question_id = q.id
    left join categories cat on cat.id = q.category_id
    where es.student_id = ${studentId} and es.status = 'submitted'`;
}

// api.ts: persen benar per kategori untuk satu siswa (group by cat.name, urut nama, kosong terakhir).
export async function categoryStatsD1(tx: Tx, studentId: string) {
  const g = new Map<string | null, { total: number; benar: number }>();
  for (const r of await answeredByStudent(tx, studentId)) {
    const e = g.get(r.cat_name) ?? { total: 0, benar: 0 };
    e.total++;
    if (looseCorrect(r.type, parseJson(r.answer_key), parseJson(r.answer), num(r.points) ?? 0)) e.benar++;
    g.set(r.cat_name, e);
  }
  return [...g.entries()].sort((x, y) => byName(x[0], y[0]))
    .map(([name, v]) => ({ category: name ?? NONE, total: v.total, benar: v.benar }));
}

// student.ts: kategori lemah (>= 2 jawaban, benar < 70%), terlemah dulu.
export async function weakCategoriesD1(tx: Tx, studentId: string) {
  const g = new Map<string | null, { name: string | null; total: number; benar: number }>();
  for (const r of await answeredByStudent(tx, studentId)) {
    const e = g.get(r.cat_id) ?? { name: r.cat_name, total: 0, benar: 0 };
    e.total++;
    if (looseCorrect(r.type, parseJson(r.answer_key), parseJson(r.answer), num(r.points) ?? 0, true)) e.benar++;
    g.set(r.cat_id, e);
  }
  return [...g.entries()]
    .filter(([, v]) => v.total >= 2 && v.benar / v.total < 0.7)
    .sort((x, y) => x[1].benar / x[1].total - y[1].benar / y[1].total)
    .map(([id, v]) => ({ cat_id: id, category: v.name ?? NONE, total: v.total, benar: v.benar }));
}

// analytics.ts: distribusi pilihan per soal pg/benar_salah pada sesi yang sudah dikumpulkan.
export async function distractorD1(tx: Tx, examId: string) {
  const rows = await tx`select q.id, q.content, k.answer_key, a.answer
    from questions q
    join exam_questions eq on eq.question_id = q.id and eq.exam_id = ${examId}
    left join question_keys k on k.question_id = q.id
    join answers a on a.question_id = q.id
      and a.session_id in (select id from exam_sessions where exam_id = ${examId} and status = 'submitted')
    where q.type in ('pg','benar_salah') and a.answer is not null`;
  const g = new Map<string, { content: Json; key: Json; dist: Record<string, number>; total: number }>();
  for (const r of rows as Json[]) {
    const e = g.get(r.id) ?? { content: parseJson(r.content) ?? {}, key: parseJson(r.answer_key), dist: {}, total: 0 };
    const ans = parseJson(r.answer);
    const picked = isObj(ans) && ans.index !== undefined && ans.index !== null ? String(ans.index) : "null";
    e.dist[picked] = (e.dist[picked] ?? 0) + 1;
    e.total++;
    g.set(r.id, e);
  }
  return [...g.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([id, e]) => ({
    id,
    text: typeof e.content.text === "string" ? e.content.text.slice(0, 100) : null,
    options: e.content.options ?? null,
    correct_index: isObj(e.key) ? num(e.key.index) : null,
    total_answered: e.total,
    distribution: e.dist,
  }));
}

// PG ntile(n): n baris dibagi 4 grup berurutan; (n mod 4) grup pertama mendapat 1 baris lebih.
export function ntile4(count: number): number[] {
  const base = Math.floor(count / 4), extra = count % 4, out: number[] = [];
  for (let b = 1; b <= 4; b++) for (let i = 0; i < base + (b <= extra ? 1 : 0); i++) out.push(b);
  return out;
}

// analytics.ts: p-value dan daya pembeda (kuartil 4 − kuartil 1) per soal.
export async function itemD1(tx: Tx, examId: string) {
  const ses = (await tx`select es.id, sc.final_score from exam_sessions es
    left join scores sc on sc.session_id = es.id
    where es.exam_id = ${examId} and es.status = 'submitted'`) as Json[];
  // order by final_score asc, NULL terakhir (default Postgres)
  ses.sort((x, y) => (x.final_score === null ? (y.final_score === null ? 0 : 1) : y.final_score === null ? -1 : num(x.final_score)! - num(y.final_score)!));
  const tiles = ntile4(ses.length);
  const quartile = new Map<string, number>(ses.map((s, i) => [s.id, tiles[i]]));
  const qs = (await tx`select q.id, q.type, q.points, q.content from questions q
    join exam_questions eq on eq.question_id = q.id and eq.exam_id = ${examId}`) as Json[];
  const ans = (await tx`select a.question_id, a.session_id, a.answer, q.type, q.points, k.answer_key
    from answers a
    join exam_sessions es on es.id = a.session_id and es.exam_id = ${examId} and es.status = 'submitted'
    join questions q on q.id = a.question_id
    left join question_keys k on k.question_id = q.id`) as Json[];
  const per = new Map<string, { n: number; ok: number; top: number; bottom: number }>();
  for (const r of ans) {
    const e = per.get(r.question_id) ?? { n: 0, ok: 0, top: 0, bottom: 0 };
    e.n++;
    if (looseCorrect(r.type, parseJson(r.answer_key), parseJson(r.answer), num(r.points) ?? 0)) {
      e.ok++;
      const qt = quartile.get(r.session_id);
      if (qt === 4) e.top++;
      if (qt === 1) e.bottom++;
    }
    per.set(r.question_id, e);
  }
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const out = qs.map((q) => {
    const e = per.get(q.id) ?? { n: 0, ok: 0, top: 0, bottom: 0 };
    const c = parseJson(q.content);
    return {
      id: q.id, type: q.type, text: isObj(c) && typeof c.text === "string" ? c.text.slice(0, 120) : null,
      n: e.n, p_value: e.n ? r3(e.ok / e.n) : 0, discrimination: e.n ? r3((e.top - e.bottom) / e.n) : 0,
    };
  });
  return out.sort((x, y) => y.discrimination - x.discrimination || x.p_value - y.p_value);
}
