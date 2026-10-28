// Portal siswa: login dengan username + PIN + kode sekolah; kerjakan ujian.
// Cookie sesi siswa terpisah (cbt_sstu) agar tidak campur dengan sesi staf.

import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { verifyPin, hashPin } from "./hash";
import {
  cookieHeader, clearCookie, readCookie, sign, verify, Session,
} from "./session";
import { sendEmail, pinNotifyEmail } from "./email";
import { checkOrLimit } from "./ratelimit";
import { SHARED_CSS } from "./ui";
import { createSession, finalizeSession } from "./scoring";

type Bindings = {
  HYPERDRIVE: Hyperdrive;
  SESSION_SECRET: string;
  APP_ORIGIN: string;
  APP_ENV: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

const STUDENT_COOKIE = "cbt_sstu";
const STUDENT_TTL = 60 * 60 * 4; // 4 jam

type StudentSession = {
  uid: string;      // students.id (dipakai di app.user_id)
  sid: string;      // schools.id
  role: "student";
  email: string;    // username@school-code untuk audit; bukan email asli
  exp: number;
};

async function requireStudent(cookie: string | null | undefined, secret: string): Promise<StudentSession | null> {
  const token = readCookie(cookie, STUDENT_COOKIE);
  if (!token) return null;
  const s = await verify(token, secret);
  if (!s) return null;
  if ((s as unknown as { role: string }).role !== "student") return null;
  return s as unknown as StudentSession;
}

export const student = new Hono<{ Bindings: Bindings }>();

// ===== HTML helpers =====

const page = (title: string, body: string) => `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · cbtgas siswa</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#14213D">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css" crossorigin="anonymous">
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js" crossorigin="anonymous" onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]})"></script>
<script>(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<style>${SHARED_CSS}
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 96px; }
  .q { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 20px 22px; margin-bottom: 14px; }
  @media (max-width: 520px) { .q { padding: 16px; border-radius: 16px; } }
  .q > p:first-of-type { margin-top: 0; }
  .q p { font-size: 16.5px; line-height: 1.6; }

  /* Opsi jawaban: bulatan LJK. Huruf dibuat dari counter, input asli tetap
     ada (aksesibel, keyboard), hanya disembunyikan secara visual. */
  .q { counter-reset: opt; }
  .opt { position: relative; display:flex; gap: 14px; align-items:center; padding: 12px 14px; margin: 8px 0;
         border: 1.5px solid var(--line); border-radius: 14px; cursor:pointer; font-weight: 500; font-size: 16px; min-height: 56px;
         transition: border-color .15s, background .15s; }
  .opt:hover { border-color: color-mix(in srgb, var(--fg) 35%, var(--line)); }
  .opt > input { position:absolute; opacity:0; width:1px; height:1px; }
  .opt::before { counter-increment: opt; content: counter(opt, upper-alpha); flex: 0 0 auto; width: 34px; height: 34px;
         border-radius: 50%; border: 2px solid var(--fg); display:grid; place-items:center; font-weight: 800; font-size: 14px;
         transition: background .12s, border-color .12s, color .12s; }
  .opt:has(> input[type=checkbox])::before { border-radius: 9px; }
  .opt:has(> input:checked) { border-color: var(--fg); background: color-mix(in srgb, var(--pencil) 10%, var(--surface)); }
  .opt:has(> input:checked)::before { background: var(--pencil); border-color: var(--pencil); color: #14213D; }
  .opt:has(> input:focus-visible) { outline: 3px solid var(--pencil); outline-offset: 2px; }
  .opt .opt-letter { display:none; }

  /* Navigasi nomor soal: deretan bulatan kecil seperti baris LJK. */
  .nav { display:grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 8px; margin: 0 0 18px; }
  .nav button { min-height: 42px; min-width: 0; padding: 0; border-radius: 50%; aspect-ratio: 1; font-size: 13px;
                font-variant-numeric: tabular-nums; border: 1.5px solid var(--line); }
  .nav button.ans { background: var(--fg); border-color: var(--fg); color: var(--surface); }
  .nav button.cur { border: 2.5px solid var(--pencil); }
  .nav button.ans.cur { box-shadow: 0 0 0 2.5px var(--pencil); }

  .timer { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 18px; letter-spacing: .02em;
           padding: 6px 14px; border-radius: 999px; background: var(--fg); color: var(--surface); }
  .timer.warn { background: var(--danger); color: #fff; }
  .exam-head { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--paper) 92%, transparent);
               backdrop-filter: blur(8px); margin: -24px -16px 18px; padding: 12px 16px; border-bottom: 1px solid var(--line);
               display:flex; align-items:center; justify-content:space-between; gap: 10px; flex-wrap: wrap; }
  .exam-head h1 { font-size: 17px; margin: 0; letter-spacing: -.01em; }
  .exam-head .tools-row { display:flex; gap:6px; align-items:center; flex-wrap: wrap; }
  .exam-head button { min-height: 40px; padding: 6px 12px; font-size: 13px; }
  .exam-foot { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: var(--surface); border-top: 1px solid var(--line);
               padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
  .exam-foot .in { max-width: 760px; margin: 0 auto; display:flex; gap: 8px; align-items:center; }
  .exam-foot .in .spacer { flex: 1; }
  .exam-foot button { min-height: 48px; }
  @media (max-width: 520px) { .exam-foot button { padding: 0 12px; } }
  .overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 24px; text-align: center;
             background: rgba(20,33,61,.9); color: #fff; }
  .panel { position: fixed; right: 16px; bottom: 84px; z-index: 50; width: min(340px, calc(100vw - 32px)); max-height: 70vh;
           display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line);
           border-radius: 18px; padding: 14px; box-shadow: 0 24px 60px rgba(20,33,61,.28); }
  .panel-head { display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; }
  .panel-head button { min-height: 36px; padding: 4px 10px; font-size: 13px; }
  .keys { display:grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .keys button { min-height: 48px; font-size: 17px; }
  .chat-box { flex: 1; overflow-y: auto; min-height: 140px; max-height: 300px; padding: 6px; border: 1.5px solid var(--line);
              border-radius: 12px; background: var(--paper); font-size: 14px; }
  .badge { margin-left: 6px; background: var(--danger); color: #fff; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
</style></head><body><main>${body}</main>
<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});</script>
</body></html>`;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]!));
}

// ===== Routes =====

student.get("/s", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.redirect("/s/login");

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const me = await tx`select s.name, c.name as class_name, s.class_id
                        from students s left join classes c on c.id = s.class_id where s.id = ${stu.uid}`;
    // Ujian yang 'open' dan diperuntukkan kelas siswa.
    const exams = await tx`
      select e.id, e.title, e.duration_minutes, e.kind,
             es.id as session_id, es.status as session_status
      from exams e
      join exam_classes ec on ec.exam_id = e.id
      left join exam_sessions es on es.exam_id = e.id and es.student_id = ${stu.uid}
      where e.status = 'open'
        and (ec.class_id = (select class_id from students where id = ${stu.uid}))
      order by e.title`;
    return { me: me[0], exams };
  });

  type Ex = { id: string; title: string; duration_minutes: number; kind: string; session_id: string|null; session_status: string|null };
  const me = data.me as { name: string; class_name: string|null; class_id: string|null } | undefined;
  const list = (data.exams as unknown as Ex[]).map((e) => {
    const action = e.session_status === "submitted"
      ? `<span class="muted">Sudah dikumpulkan</span>`
      : e.session_status === "expired"
      ? `<span class="muted">Waktu habis</span>`
      : e.session_id
        ? `<form method="post" action="/s/exams/${esc(e.id)}/start" style="margin:0"><button class="primary">Lanjutkan</button></form>`
        : `<form method="post" action="/s/exams/${esc(e.id)}/start" style="margin:0"><button class="primary">Mulai</button></form>`;
    return `<tr>
      <td><b>${esc(e.title)}</b><br><span class="muted">${esc(e.kind)} · ${e.duration_minutes} menit</span></td>
      <td style="text-align:right">${action}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="2" class="muted">Belum ada ujian yang dibuka untuk kelas Anda.</td></tr>`;

  return c.html(page("Portal Siswa", `
    <div class="card">
      <h1>Halo, ${esc(me?.name ?? "siswa")}</h1>
      <p class="sub">Kelas: ${esc(me?.class_name ?? "- (belum terdaftar di kelas)")}</p>
      <div class="row">
        <form method="post" action="/s/logout" style="margin:0"><button type="submit">Keluar</button></form>
        <a class="btn" href="/s/me">Ganti PIN</a>
      </div>
    </div>
    <div class="card">
      <h2>Ujian tersedia</h2>
      <table style="width:100%; border-collapse:collapse">
        <tbody>${list}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Riwayat & rekomendasi</h2>
      <p class="muted"><a href="/s/history">Lihat semua ujian yang pernah saya kerjakan</a></p>
      <p class="muted"><a href="/s/rekomendasi">Rekomendasi belajar untuk kategori lemah</a></p>
    </div>
  `));
});

// Riwayat ujian siswa: semua sesi yang pernah dibuka (submitted / expired / locked).
student.get("/s/history", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.redirect("/s/login");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, (tx) =>
    tx`select es.id as session_id, e.title, e.kind, es.status,
              es.started_at, es.finished_at, sc.final_score
       from exam_sessions es
       join exams e on e.id = es.exam_id
       left join scores sc on sc.session_id = es.id
       where es.student_id = ${stu.uid}
       order by es.started_at desc`,
  );
  type R = { session_id: string; title: string; kind: string; status: string;
    started_at: string; finished_at: string | null; final_score: string | null };
  const list = (rows as unknown as R[]).map((r) => {
    const reviewBtn = r.status === "submitted"
      ? `<a href="/s/history/${esc(r.session_id)}">Review</a>` : "";
    return `<tr>
      <td><b>${esc(r.title)}</b><br><span class="muted">${esc(r.kind)}</span></td>
      <td>${esc(r.status)}</td>
      <td>${r.final_score ?? "-"}</td>
      <td>${new Date(r.started_at).toLocaleString("id-ID")}</td>
      <td>${reviewBtn}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">Belum ada riwayat.</td></tr>`;
  return c.html(page("Riwayat ujian", `
    <div class="card">
      <h1>Riwayat ujian</h1>
      <p class="sub"><a href="/s">Portal</a></p>
    </div>
    <div class="card">
      <table style="width:100%; border-collapse:collapse">
        <thead><tr><th>Ujian</th><th>Status</th><th>Nilai</th><th>Mulai</th><th></th></tr></thead>
        <tbody>${list}</tbody>
      </table>
    </div>
  `));
});

// Rekomendasi review: identifikasi kategori lemah siswa, lalu tampilkan
// soal (dengan kunci) dari kategori tersebut sebagai bahan belajar.
student.get("/s/rekomendasi", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.redirect("/s/login");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const weak = await tx`
      select cat.id as cat_id, coalesce(cat.name, '(tanpa kategori)') as category,
             count(*)::int as total,
             sum(case
               when q.type = 'pg'          and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'benar_salah' and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'isian'       and exists(
                 select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                 where lower(trim(x.value)) = lower(trim(a.answer->>'text'))) then 1
               else 0 end)::int as benar
      from answers a
      join questions q on q.id = a.question_id
      join exam_sessions es on es.id = a.session_id
      left join question_keys k on k.question_id = q.id
      left join categories cat on cat.id = q.category_id
      where es.student_id = ${stu.uid} and es.status = 'submitted'
      group by cat.id, cat.name
      having count(*) >= 2 and sum(case
               when q.type = 'pg'          and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'benar_salah' and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'isian'       and exists(
                 select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                 where lower(trim(x.value)) = lower(trim(a.answer->>'text'))) then 1
               else 0 end)::numeric / count(*) < 0.7
      order by (sum(case
               when q.type = 'pg'          and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'benar_salah' and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'isian'       and exists(
                 select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                 where lower(trim(x.value)) = lower(trim(a.answer->>'text'))) then 1
               else 0 end)::numeric / count(*)) asc`;
    const weakRows = weak as unknown as Array<{ cat_id: string | null; category: string; total: number; benar: number }>;
    if (weakRows.length === 0) return { weak: [] as typeof weakRows, items: [] as Array<{ id: string; type: string; content: Record<string, unknown>; answer_key: unknown; cat_name: string | null }> };
    const catIds = weakRows.map((r) => r.cat_id).filter((x): x is string => !!x);
    const items = catIds.length
      ? await tx`
          select q.id, q.type, q.content, k.answer_key, cat.name as cat_name
          from questions q
          left join question_keys k on k.question_id = q.id
          left join categories cat on cat.id = q.category_id
          where q.category_id in ${tx(catIds)}
            and q.type in ('pg','benar_salah')
            and q.id in (
              select distinct a.question_id from answers a
              join exam_sessions es on es.id = a.session_id
              where es.student_id = ${stu.uid} and es.status = 'submitted'
            )
          limit 20`
      : [];
    return { weak: weakRows, items };
  });
  type I = { id: string; type: string; content: { text: string; options?: string[] };
    answer_key: { index: number } | null; cat_name: string | null };
  const weakList = (data.weak).map((r) => {
    const pct = Math.round((r.benar / r.total) * 100);
    return `<li>${esc(r.category)}: <b>${pct}%</b> benar (${r.benar}/${r.total})</li>`;
  }).join("");
  const items = (data.items as unknown as I[]).map((q, idx) => {
    const key = q.answer_key?.index;
    const opts = (q.content.options ?? []).map((o, k) => {
      const isKey = k === key;
      return `<li ${isKey ? "style=\"color:var(--ok);font-weight:600\"" : ""}>${String.fromCharCode(65 + k)}. ${esc(o)}${isKey ? " ✓" : ""}</li>`;
    }).join("");
    return `<div class="q">
      <p><b>Soal belajar ${idx + 1}</b> <span class="muted">· ${esc(q.cat_name ?? "")}</span></p>
      <p>${esc(q.content.text)}</p>
      <ol type="A" style="margin:4px 0 0 20px">${opts}</ol>
    </div>`;
  }).join("");
  return c.html(page("Rekomendasi review", `
    <div class="card">
      <h1>Rekomendasi belajar</h1>
      <p class="sub">Berdasar jawaban Anda di ujian-ujian sebelumnya. <a href="/s">Portal</a></p>
      ${data.weak.length === 0
        ? `<p class="muted">Belum ada kategori lemah terdeteksi (atau belum cukup data).</p>`
        : `<p>Kategori yang perlu diperkuat:</p><ul style="margin:4px 0 0 20px">${weakList}</ul>`}
    </div>
    ${items ? `<div class="card"><h2>Soal untuk latihan ulang</h2>
      <p class="muted">Soal berikut berasal dari kategori lemah di atas; kunci jawaban ditampilkan.</p>
      ${items}
    </div>` : ""}
  `));
});

// Review satu sesi: lihat soal + jawaban sendiri + kunci (hanya untuk soal
// auto-grade; uraian tetap tanpa kunci). Hanya setelah submit.
student.get("/s/history/:sid", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.redirect("/s/login");
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const sess = await tx`
      select es.id, es.status, e.title, sc.final_score
      from exam_sessions es join exams e on e.id = es.exam_id
      left join scores sc on sc.session_id = es.id
      where es.id = ${sessionId} and es.student_id = ${stu.uid}`;
    if (sess.length === 0) return null;
    const row = sess[0] as { status: string; title: string; final_score: string | null };
    if (row.status !== "submitted") return { title: row.title, locked: true };
    const items = await tx`
      select q.id, q.type, q.content, q.points, k.answer_key, a.answer
      from exam_questions eq
      join questions q on q.id = eq.question_id
      left join question_keys k on k.question_id = q.id
      left join answers a on a.session_id = ${sessionId} and a.question_id = q.id
      where eq.exam_id = (select exam_id from exam_sessions where id = ${sessionId})
      order by eq.position`;
    return { title: row.title, final: row.final_score, items };
  });
  if (!data) return c.notFound();
  if ("locked" in data) {
    return c.html(page(data.title!, `<div class="card"><h1>${esc(data.title!)}</h1>
      <p class="muted">Sesi belum selesai; review belum tersedia.</p>
      <a class="btn" href="/s/history">Riwayat</a></div>`));
  }
  type Item = {
    id: string; type: string; points: string;
    content: { text: string; options?: string[]; image?: string };
    answer_key: { index?: number; accepted?: string[]; manual?: boolean } | null;
    answer: { index?: number; text?: string; manual_score?: number } | null;
  };
  const items = (data.items as unknown as Item[]).map((q, i) => {
    let body = `<p><b>Soal ${i + 1}</b> <span class="muted">(${q.points} pts, ${q.type})</span></p><p>${esc(q.content.text)}</p>`;
    if (q.content.image) body += `<img src="${esc(q.content.image)}" style="max-width:100%; max-height:260px; border-radius:8px; border:1px solid var(--bd); margin:8px 0">`;
    if (q.type === "pg" || q.type === "benar_salah") {
      const correct = q.answer_key?.index;
      const picked = q.answer?.index;
      body += (q.content.options ?? []).map((o, k) => {
        const isCorrect = k === correct, isPicked = k === picked;
        const style = isCorrect ? "background:#16a34a1a;border-color:#16a34a"
          : isPicked ? "background:#ef44441a;border-color:#ef4444" : "";
        const mark = isCorrect ? " ✓" : isPicked ? " ✗" : "";
        return `<div class="opt" style="${style}">${esc(o)}${mark}</div>`;
      }).join("");
    } else if (q.type === "isian") {
      const my = q.answer?.text ?? "(kosong)";
      const acc = (q.answer_key?.accepted ?? []).join(" | ");
      const correct = (q.answer_key?.accepted ?? []).some((a) => a.toLowerCase().trim() === my.toLowerCase().trim());
      body += `<p>Jawaban Anda: <b style="color:${correct ? "var(--ok)" : "var(--danger)"}">${esc(my)}</b></p>`;
      body += `<p class="muted">Jawaban diterima: ${esc(acc)}</p>`;
    } else if (q.type === "uraian") {
      body += `<p>Jawaban Anda:</p><blockquote style="margin:4px 0; padding:10px; border-left:3px solid var(--bd); background:var(--bg)">${esc(q.answer?.text ?? "(kosong)")}</blockquote>`;
      if (typeof q.answer?.manual_score === "number") {
        body += `<p class="muted">Nilai guru: <b>${q.answer.manual_score} / ${q.points}</b></p>`;
      } else {
        body += `<p class="muted">Menunggu penilaian guru.</p>`;
      }
    }
    return `<div class="card">${body}</div>`;
  }).join("");
  return c.html(page("Review", `
    <div class="card">
      <h1>${esc(data.title!)}</h1>
      <p class="sub">Nilai akhir: <b>${data.final ?? "-"}</b> · <a href="/s/history">Riwayat</a></p>
    </div>
    ${items}
  `));
});

student.get("/s/login", (c) => c.html(page("Masuk siswa", `
  <div class="card">
    <h1>Masuk sebagai siswa</h1>
    <p class="sub">Pakai kode sekolah, username, dan PIN dari guru.</p>
    <form id="f">
      <label>Kode sekolah</label><input name="code" required placeholder="demo-sma">
      <label>Username</label><input name="username" required placeholder="andi.saputra">
      <label>PIN</label><input name="pin" type="password" required pattern="\\d{4,8}" placeholder="PIN 4–8 digit">
      <div class="row"><button class="primary" type="submit">Masuk</button>
        <a class="btn" href="/s/forgot">Lupa PIN?</a></div>
      <p class="err" id="err" hidden></p>
    </form>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('err'); err.hidden = true;
      const d = Object.fromEntries(new FormData(e.target));
      const r = await fetch('/s/login', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (r.ok) { location.href = '/s'; return; }
      const j = await r.json().catch(() => ({})); err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false;
    });
  </script>
`)));

student.post("/s/login", async (c) => {
  const rl = await checkOrLimit(c.env, c.req.raw.headers, "s_login", 10);
  if (rl) return rl;
  const body = await c.req.json().catch(() => null) as null | { code: string; username: string; pin: string };
  if (!body?.code || !body?.username || !body?.pin) return c.json({ error: "data kurang" }, 400);

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  // resolve_school adalah SECURITY DEFINER tidak butuh konteks RLS.
  const sch = await sql`select id from resolve_school(${body.code})`;
  if (sch.length === 0) return c.json({ error: "kode sekolah tidak dikenal" }, 404);
  const sid = (sch[0] as { id: string }).id;

  // Set konteks role 'student' tanpa user_id dulu, lalu cari siswa.
  const stu = await withTenant(sql, { schoolId: sid, role: "student" }, (tx) =>
    tx`select id, name, pin_hash, locked_until, pin_failed_count
       from students where username = ${body.username} and active`,
  );
  if (stu.length === 0) return c.json({ error: "username/PIN salah" }, 401);
  const u = stu[0] as { id: string; name: string; pin_hash: string; locked_until: string | null; pin_failed_count: number };

  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    return c.json({ error: "akun terkunci; hubungi guru" }, 423);
  }

  const ok = await verifyPin(body.pin, u.pin_hash);
  if (!ok) {
    const nextCount = u.pin_failed_count + 1;
    const lock = nextCount >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await withTenant(sql, { schoolId: sid, role: "student", userId: u.id }, (tx) =>
      tx`update students set pin_failed_count = ${nextCount}, locked_until = ${lock}
         where id = ${u.id}`,
    );
    return c.json({ error: "username/PIN salah" }, 401);
  }
  // Reset counter + catat login
  await withTenant(sql, { schoolId: sid, role: "student", userId: u.id }, (tx) =>
    tx`update students set pin_failed_count = 0, locked_until = null where id = ${u.id}`,
  );

  const session: StudentSession = {
    uid: u.id, sid, role: "student",
    email: `${body.username}@${body.code}`,
    exp: Math.floor(Date.now() / 1000) + STUDENT_TTL,
  };
  const cookie = await sign(session as unknown as Session, c.env.SESSION_SECRET);
  const h = new Headers({ "Content-Type": "application/json" });
  h.append("Set-Cookie", cookieHeader(STUDENT_COOKIE, cookie, { maxAge: STUDENT_TTL }));
  return new Response(JSON.stringify({ ok: true }), { headers: h });
});

// Lupa PIN: siswa isi kode sekolah + username, system masukkan ke antrian
// pin_resets. Guru/admin menyetujui lewat dashboard PIN 6-digit baru
// ditampilkan sekali untuk disampaikan ke siswa.
student.post("/s/forgot", async (c) => {
  const rl = await checkOrLimit(c.env, c.req.raw.headers, "s_forgot", 5);
  if (rl) return rl;
  const body = await c.req.json().catch(() => null) as null | { code: string; username: string };
  if (!body?.code || !body?.username) return c.json({ error: "data kurang" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const sch = await sql`select id from resolve_school(${body.code})`;
  if (sch.length === 0) return c.json({ error: "kode sekolah tidak dikenal" }, 404);
  const sid = (sch[0] as { id: string }).id;
  const notify = await withTenant(sql, { schoolId: sid, role: "student" }, async (tx) => {
    const stu = await tx`select id, name from students where username = ${body.username} and active`;
    if (stu.length === 0) return null;  // Diam-diam ok supaya tidak membocorkan username ada/tidak.
    const stuRow = stu[0] as { id: string; name: string };
    const existing = await tx`select id from pin_resets where student_id = ${stuRow.id} and status = 'pending'`;
    if (existing.length === 0) {
      await tx`insert into pin_resets (school_id, student_id) values (${sid}, ${stuRow.id})`;
    }
    const sch = await tx`select name from schools where id = ${sid}`;
    const admins = await tx`select email from users where role in ('admin','teacher') and active`;
    return {
      schoolName: (sch[0] as { name: string } | undefined)?.name ?? "",
      studentName: stuRow.name,
      username: body.username,
      recipients: (admins as unknown as Array<{ email: string }>).map((x) => x.email),
    };
  });
  // Kirim email ke guru/admin (best-effort). Tidak gagalkan permintaan siswa.
  if (notify && notify.recipients.length) {
    const mail = pinNotifyEmail({
      schoolName: notify.schoolName, studentName: notify.studentName,
      username: notify.username, origin: c.env.APP_ORIGIN,
    });
    for (const to of notify.recipients) {
      await sendEmail(c.env, to, mail.subject, mail.html);
    }
  }
  return c.json({ ok: true, message: "Permintaan reset diajukan. Hubungi guru untuk mendapat PIN baru." });
});

student.get("/s/forgot", (c) => c.html(page("Lupa PIN", `
  <div class="card">
    <h1>Lupa PIN</h1>
    <p class="sub">Kirim permintaan ke guru untuk reset. Guru akan memberi Anda PIN baru.</p>
    <form id="f">
      <label>Kode sekolah</label><input name="code" required placeholder="demo-sma">
      <label>Username</label><input name="username" required placeholder="andi.saputra">
      <div class="row"><button class="primary" type="submit">Ajukan reset</button>
        <a class="btn" href="/s/login">Kembali</a></div>
      <p id="msg" style="margin-top:12px"></p>
    </form>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const r = await fetch('/s/forgot', { method:'POST', credentials:'same-origin',
        headers: { 'Content-Type':'application/json' }, body: JSON.stringify(d) });
      const j = await r.json().catch(() => ({}));
      const msg = document.getElementById('msg');
      msg.className = r.ok ? 'muted' : 'err';
      msg.textContent = j.message || j.error || ('HTTP ' + r.status);
    });
  </script>
`)));

// Siswa ganti PIN sendiri setelah login. Butuh PIN lama + PIN baru.
student.post("/s/me/pin", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null) as null | { old_pin: string; new_pin: string };
  if (!body?.old_pin || !body?.new_pin) return c.json({ error: "data kurang" }, 400);
  if (!/^\d{4,8}$/.test(body.new_pin)) return c.json({ error: "pin baru harus 4–8 digit" }, 400);
  if (body.old_pin === body.new_pin) return c.json({ error: "pin baru sama dengan lama" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const r = await tx`select pin_hash from students where id = ${stu.uid}`;
    if (r.length === 0) throw new Error("siswa tidak ditemukan");
    const ok = await verifyPin(body.old_pin, (r[0] as { pin_hash: string }).pin_hash);
    if (!ok) throw new Error("pin lama salah");
    const newHash = await hashPin(body.new_pin);
    await tx`update students set pin_hash = ${newHash}, pin_failed_count = 0, locked_until = null
             where id = ${stu.uid}`;
    return { ok: true };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  return c.json(result);
});

student.get("/s/me", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.redirect("/s/login");
  return c.html(page("Akun saya", `
    <div class="card">
      <h1>Akun saya</h1>
      <p class="sub"><a href="/s">Portal</a></p>
      <h2>Ganti PIN</h2>
      <form id="f">
        <label>PIN lama</label><input name="old_pin" type="password" required pattern="\\d{4,8}">
        <label>PIN baru</label><input name="new_pin" type="password" required pattern="\\d{4,8}">
        <label>Ulangi PIN baru</label><input name="confirm" type="password" required pattern="\\d{4,8}">
        <div class="row"><button class="primary" type="submit">Simpan</button></div>
        <p id="msg" style="margin-top:12px"></p>
      </form>
    </div>
    <script>
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('msg'); msg.className = ''; msg.textContent = '';
        const d = Object.fromEntries(new FormData(e.target));
        if (d.new_pin !== d.confirm) { msg.className = 'err'; msg.textContent = 'Ulangi PIN tidak cocok.'; return; }
        delete d.confirm;
        const r = await fetch('/s/me/pin', { method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify(d) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { msg.className = 'muted'; msg.textContent = 'PIN berhasil diganti.'; e.target.reset(); }
        else { msg.className = 'err'; msg.textContent = j.error || ('HTTP '+r.status); }
      });
    </script>
  `));
});

student.post("/s/logout", (c) => {
  const h = new Headers({ Location: `${c.env.APP_ORIGIN}/s/login` });
  h.append("Set-Cookie", clearCookie(STUDENT_COOKIE));
  return new Response(null, { status: 302, headers: h });
});

// Mulai (atau lanjutkan) sesi ujian: buat exam_sessions kalau belum ada, hitung
// deadline dari starts_at atau now() + duration.
student.post("/s/exams/:id/start", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.redirect("/s/login");
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const sessionId = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    // Pastikan ujian open, dalam jendela waktu, dan menargetkan kelas siswa.
    const ok = await tx`
      select e.id from exams e
      join exam_classes ec on ec.exam_id = e.id
      where e.id = ${examId} and e.status = 'open'
        and ec.class_id = (select class_id from students where id = ${stu.uid})
        and (e.starts_at is null or e.starts_at <= now())
        and (e.ends_at   is null or e.ends_at   >  now())`;
    if (ok.length === 0) throw new Error("ujian belum/sudah tidak tersedia");
    const existing = await tx`select id, status from exam_sessions where exam_id = ${examId} and student_id = ${stu.uid}`;
    if (existing.length) {
      const row = existing[0] as { id: string; status: string };
      if (row.status === "submitted" || row.status === "expired") throw new Error("ujian ini sudah selesai untuk Anda");
      return row.id;
    }
    const sessionId = await createSession(tx, stu.sid, examId, stu.uid);
    return sessionId;
  }).catch((e) => ({ error: (e as Error).message }));
  if (typeof sessionId === "object") return c.json(sessionId, 400);
  return c.redirect(`/s/take/${sessionId}`);
});

student.get("/s/take/:sid", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.redirect("/s/login");
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const s = await tx`
      select es.id, es.status, es.deadline_at, es.question_order,
             es.violation_count, es.paused_at,
             e.title, e.anticheat_level, e.lock_after_violations
      from exam_sessions es join exams e on e.id = es.exam_id
      where es.id = ${sessionId} and es.student_id = ${stu.uid}`;
    if (s.length === 0) return null;
    const sess = s[0] as {
      id: string; status: string; deadline_at: string; question_order: string[];
      violation_count: number; title: string;
      anticheat_level: "log"|"warn"|"lock"; lock_after_violations: number | null;
    };
    if (sess.status === "submitted") return { done: true, title: sess.title };
    if (sess.status === "locked") return { locked: true, title: sess.title };
    // Backward compat: question_order dulu array string, sekarang object.
    const qoRaw = sess.question_order as unknown;
    const qo: { order: string[]; perms?: Record<string, number[]> } =
      Array.isArray(qoRaw) ? { order: qoRaw as string[], perms: {} }
      : (qoRaw as { order: string[]; perms?: Record<string, number[]> });
    const order = qo.order; const perms = qo.perms ?? {};
    // Load pertanyaan sesuai urutan (tanpa answer_key). Passage ikut dibawa.
    const qs = await tx`
      select q.id, q.type, q.content, q.passage_id, p.title as passage_title, p.body as passage_body
      from questions q left join passages p on p.id = q.passage_id
      where q.id in ${tx(order)}`;
    const map = new Map<string, { type: string; content: { text: string; options?: string[] };
                                   passage?: { id: string; title: string | null; body: string } }>();
    for (const q of qs as unknown as Array<{ id: string; type: string; content: { text: string; options?: string[] };
                                             passage_id: string | null; passage_title: string | null; passage_body: string | null }>) {
      map.set(q.id, {
        type: q.type, content: q.content,
        passage: q.passage_id && q.passage_body ? { id: q.passage_id, title: q.passage_title, body: q.passage_body } : undefined,
      });
    }
    // Terapkan permutasi opsi (jika ada) di sisi server supaya klien tidak
    // perlu tahu urutan asli — indeks yang dikirim balik ketika save sudah
    // di-remap oleh klien jadi indeks asli (lihat script).
    const questions = order.map((qid, i) => {
      const q = map.get(qid)!;
      const perm = perms[qid];
      let content = q.content;
      if (perm && q.content.options) {
        content = { ...q.content, options: perm.map((k) => q.content.options![k]) };
      }
      return { id: qid, pos: i + 1, type: q.type, content, perm: perm ?? null, passage: q.passage ?? null };
    });
    // Jawaban sebelumnya. Jika soal pakai perm, remap index asli index tampilan.
    const prev = await tx`select question_id, answer from answers where session_id = ${sessionId}`;
    const answers: Record<string, { index?: number; text?: string }> = {};
    for (const a of prev as unknown as Array<{ question_id: string; answer: { index?: number; text?: string } | null }>) {
      if (!a.answer) continue;
      const ans = { ...a.answer };
      const perm = perms[a.question_id];
      if (perm && typeof ans.index === "number") {
        const displayIdx = perm.indexOf(ans.index);
        if (displayIdx >= 0) ans.index = displayIdx;
      }
      answers[a.question_id] = ans;
    }
    return {
      title: sess.title, deadline: sess.deadline_at, questions, answers,
      anticheat: sess.anticheat_level, limit: sess.lock_after_violations,
      violations: sess.violation_count,
      paused_at: (sess as unknown as { paused_at: string | null }).paused_at,
    };
  });
  if (!data) return c.notFound();
  if ("done" in data) {
    return c.html(page(data.title!, `
      <div class="card">
        <h1>${esc(data.title!)}</h1>
        <p>Ujian ini sudah Anda kumpulkan. Terima kasih.</p>
        <div class="row"><a class="btn" href="/s">Kembali</a></div>
      </div>`));
  }
  if ("locked" in data) {
    return c.html(page(data.title!, `
      <div class="card">
        <h1>${esc(data.title!)}</h1>
        <p class="err">Sesi dikunci oleh sistem anti-contek karena pelanggaran berulang.
        Hubungi guru atau pengawas untuk membuka kembali.</p>
        <div class="row"><a class="btn" href="/s">Kembali</a></div>
      </div>`));
  }

  const payload = JSON.stringify({
    sessionId, deadline: data.deadline,
    questions: data.questions, answers: data.answers,
    anticheat: data.anticheat, limit: data.limit, violations: data.violations,
    paused_at: data.paused_at,
  });
  return c.html(page(data.title!, `
    <div id="pauseOverlay" class="overlay" hidden>
      <div>
        <h2 style="font-size:22px;margin:0 0 6px">Ujian dijeda pengawas</h2>
        <p style="margin:0;opacity:.8">Waktu berhenti. Tunggu guru melanjutkan.</p>
      </div>
    </div>
    <header class="exam-head">
      <h1>${esc(data.title!)}</h1>
      <div class="tools-row">
        <span id="qbadge" class="muted"></span>
        <button type="button" id="chatBtn">Chat pengawas<span id="chatBadge" class="badge" hidden>baru</span></button>
        <button type="button" id="calcBtn">Kalkulator</button>
        <span class="timer" id="t" aria-live="off">--:--</span>
      </div>
    </header>
    <section id="calc" class="panel" hidden aria-label="Kalkulator">
      <div class="panel-head"><b>Kalkulator</b><button type="button" id="calcClose" aria-label="Tutup kalkulator">Tutup</button></div>
      <input id="calcDisp" readonly aria-label="Tampilan kalkulator" style="font: 600 20px/1 ui-monospace, monospace; text-align:right; margin-bottom:8px">
      <div class="keys">
        <button type="button" data-k="C" class="danger">C</button>
        <button type="button" data-k="(">(</button>
        <button type="button" data-k=")">)</button>
        <button type="button" data-k="/">÷</button>
        <button type="button" data-k="7">7</button>
        <button type="button" data-k="8">8</button>
        <button type="button" data-k="9">9</button>
        <button type="button" data-k="*">×</button>
        <button type="button" data-k="4">4</button>
        <button type="button" data-k="5">5</button>
        <button type="button" data-k="6">6</button>
        <button type="button" data-k="-">−</button>
        <button type="button" data-k="1">1</button>
        <button type="button" data-k="2">2</button>
        <button type="button" data-k="3">3</button>
        <button type="button" data-k="+">+</button>
        <button type="button" data-k="0" style="grid-column: span 2">0</button>
        <button type="button" data-k=".">.</button>
        <button type="button" data-k="=" class="primary">=</button>
      </div>
    </section>
    <section id="chat" class="panel" hidden aria-label="Chat pengawas">
      <div class="panel-head"><b>Chat pengawas</b><button type="button" id="chatClose" aria-label="Tutup chat">Tutup</button></div>
      <div id="chatBox" class="chat-box"></div>
      <form id="chatForm" style="display:flex; gap:6px; margin-top:8px">
        <input id="chatInput" placeholder="Misalnya: izin ke toilet" maxlength="500" aria-label="Pesan untuk pengawas">
        <button class="primary" type="submit">Kirim</button>
      </form>
    </section>
    <div class="nav" id="nav" aria-label="Nomor soal"></div>
    <div id="qbox"></div>
    <p class="muted" style="margin-top:18px">Jawaban tersimpan otomatis setiap kali Anda memilih atau mengetik.</p>
    <div class="exam-foot"><div class="in">
      <button id="prev">Sebelumnya</button>
      <button id="next">Berikutnya</button>
      <span class="spacer"></span>
      <button class="primary" id="submit">Kumpulkan</button>
    </div></div>
    <script id="data" type="application/json">${payload.replace(/</g, "\\u003c")}</script>
    <script>
      const D = JSON.parse(document.getElementById('data').textContent);
      let isPaused = !!D.paused_at;
      const Q = D.questions; const A = D.answers || {}; let i = 0;
      let violations = D.violations || 0; const limit = D.limit || 0; const level = D.anticheat || 'log';
      const nav = document.getElementById('nav'); const qbox = document.getElementById('qbox');
      function escapeHtml(s) { return (s||'').replace(/[&<>\"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]); }
      // Markdown ringan: **bold**, *italic*, \`code\`, newline <br>.
      // Math $...$ dan $$...$$ dilewati, lalu dirender ulang oleh KaTeX.
      function mdRender(s) {
        let t = escapeHtml(s);
        t = t.replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>');
        t = t.replace(/\\*([^*]+)\\*/g, '<i>$1</i>');
        t = t.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
        t = t.replace(/\\n/g, '<br>');
        return t;
      }
      function renderMath(el) {
        if (window.renderMathInElement) renderMathInElement(el, {
          delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],
          throwOnError: false,
        });
      }
      function hasAnswer(qid) {
        const a = A[qid]; if (!a) return false;
        if (typeof a.index === 'number') return true;
        if (typeof a.text === 'string' && a.text.trim() !== '') return true;
        if (Array.isArray(a.selected) && a.selected.length > 0) return true;
        if (Array.isArray(a.pairs) && a.pairs.length > 0) return true;
        return false;
      }
      function render() {
        qbox.innerHTML = '';
        const q = Q[i];
        const el = document.createElement('div'); el.className = 'q active';
        const tag = q.type === 'uraian' ? ' <span class="muted">(uraian — dinilai guru)</span>' : '';
        let head = '';
        if (q.passage) {
          head = '<div style="padding:12px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);margin-bottom:12px">' +
            (q.passage.title ? '<p style="margin:0 0 6px"><b>' + escapeHtml(q.passage.title) + '</b></p>' : '') +
            '<p style="margin:0;white-space:pre-wrap">' + escapeHtml(q.passage.body) + '</p></div>';
        }
        el.innerHTML = head + '<p><b>Soal ' + (i+1) + ' / ' + Q.length + '</b>' + tag + '</p><p>' + mdRender(q.content.text) + '</p>';
        if (q.content.image) {
          const img = document.createElement('img');
          img.src = q.content.image;
          img.style.cssText = 'max-width:100%; max-height:300px; border-radius:8px; border:1px solid var(--bd); margin:8px 0';
          el.appendChild(img);
        }
        if (q.content.audio) {
          const au = document.createElement('audio');
          au.src = q.content.audio; au.controls = true;
          au.style.cssText = 'width:100%; margin:8px 0';
          el.appendChild(au);
        }
        if (q.type === 'pg' || q.type === 'benar_salah') {
          q.content.options.forEach((o, k) => {
            const checked = A[q.id] && A[q.id].index === k ? 'checked' : '';
            const row = document.createElement('label'); row.className = 'opt';
            const label = o;
            row.innerHTML = '<input type="radio" name="'+q.id+'" value="'+k+'" '+checked+'><span>' + escapeHtml(label) + '</span>';
            row.querySelector('input').addEventListener('change', () => save(q.id, { index: k }));
            el.appendChild(row);
          });
        } else if (q.type === 'isian') {
          const inp = document.createElement('input'); inp.type = 'text';
          inp.placeholder = 'Ketik jawaban…'; inp.value = (A[q.id] && A[q.id].text) || '';
          let t; inp.addEventListener('input', () => {
            clearTimeout(t); t = setTimeout(() => save(q.id, { text: inp.value }), 400);
          });
          el.appendChild(inp);
        } else if (q.type === 'dinamis_hitung') {
          // Nilai {a,b} sudah pre-populated di answer saat start. Render
          // template dengan substitusi, input numerik untuk jawaban.
          const vars = (A[q.id] && A[q.id].vars) || { a: '?', b: '?' };
          const tpl = (q.content.tpl || '{a} {op} {b} = ?').replace('{a}', vars.a).replace('{b}', vars.b).replace('{op}', q.content.op || '+');
          el.innerHTML = head + '<p><b>Soal ' + (i+1) + ' / ' + Q.length + '</b></p><p style="font-size:16px;background:var(--bg);padding:10px;border-radius:6px"><b>' + mdRender(q.content.text) + '</b><br>' + escapeHtml(tpl) + '</p>';
          const inp = document.createElement('input');
          inp.type = 'number'; inp.step = 'any';
          inp.placeholder = 'Jawaban (angka)'; inp.value = (A[q.id] && A[q.id].text) || '';
          let t2; inp.addEventListener('input', () => {
            clearTimeout(t2); t2 = setTimeout(() => save(q.id, { text: inp.value }), 400);
          });
          el.appendChild(inp);
        } else if (q.type === 'simulasi') {
          // Render HTML simulasi di iframe sandbox. Siswa simpan jawaban via
          // postMessage({type:'answer', text}) ke parent window.
          const wrap = document.createElement('div');
          wrap.innerHTML = '<p class="muted" style="margin:4px 0">Interaksi simulasi di bawah. Jawaban tersimpan otomatis saat Anda berinteraksi.</p>';
          const ifr = document.createElement('iframe');
          ifr.sandbox = 'allow-scripts';
          ifr.style.cssText = 'width:100%; height:360px; border:1px solid var(--bd); border-radius:8px; background:#fff';
          const prev = (A[q.id] && A[q.id].text) || '';
          const html = '<base target="_blank"><style>body{font:14px/1.4 system-ui,sans-serif;margin:12px;color:#111}</style>' +
            '<script>window.sendAnswer=(t)=>parent.postMessage({type:"answer",qid:' + JSON.stringify(q.id) + ',text:String(t)},"*")</scr' + 'ipt>' +
            q.content.html + '<script>try{window.initialAnswer=' + JSON.stringify(prev) + '}catch(_){};</scr' + 'ipt>';
          ifr.srcdoc = html;
          wrap.appendChild(ifr);
          const noteWrap = document.createElement('div');
          noteWrap.innerHTML = '<label style="margin-top:10px">Catatan tambahan (opsional)</label>';
          const ta2 = document.createElement('textarea'); ta2.rows = 3;
          ta2.style.cssText = 'width:100%;padding:8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit';
          ta2.placeholder = 'Tambahan penjelasan…'; ta2.value = (A[q.id] && A[q.id].note) || '';
          let t3; ta2.addEventListener('input', () => {
            clearTimeout(t3); t3 = setTimeout(() => save(q.id, { note: ta2.value, text: A[q.id]?.text ?? '' }), 400);
          });
          noteWrap.appendChild(ta2);
          wrap.appendChild(noteWrap);
          el.appendChild(wrap);
        } else if (q.type === 'uraian') {
          const ta = document.createElement('textarea'); ta.rows = 6;
          ta.style.cssText = 'width:100%;padding:10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;resize:vertical';
          ta.placeholder = 'Tuliskan jawaban Anda…'; ta.value = (A[q.id] && A[q.id].text) || '';
          let t; ta.addEventListener('input', () => {
            clearTimeout(t); t = setTimeout(() => save(q.id, { text: ta.value }), 500);
          });
          el.appendChild(ta);
        } else if (q.type === 'pgk_centang') {
          const sel = Array.isArray(A[q.id] && A[q.id].selected) ? A[q.id].selected.slice() : [];
          q.content.options.forEach((o, k) => {
            const row = document.createElement('label'); row.className = 'opt';
            const checked = sel.includes(k) ? 'checked' : '';
            row.innerHTML = '<input type="checkbox" value="'+k+'" '+checked+'><span>' + escapeHtml(o) + '</span>';
            row.querySelector('input').addEventListener('change', (ev) => {
              const cur = (A[q.id] && A[q.id].selected) ? A[q.id].selected.slice() : [];
              if (ev.target.checked) { if (!cur.includes(k)) cur.push(k); }
              else { const i = cur.indexOf(k); if (i >= 0) cur.splice(i, 1); }
              cur.sort((a, b) => a - b);
              save(q.id, { selected: cur });
            });
            el.appendChild(row);
          });
        } else if (q.type === 'menjodohkan') {
          // Dua kolom: label kiri + dropdown kanan.
          const pairs = Array.isArray(A[q.id] && A[q.id].pairs) ? A[q.id].pairs : [];
          const left = q.content.left || [], right = q.content.right || [];
          const grid = document.createElement('div');
          grid.style.cssText = 'display:grid; grid-template-columns: 1fr auto 1fr; gap:8px 12px; align-items:center';
          left.forEach((lText, i) => {
            const lab = document.createElement('div'); lab.innerHTML = '<b>' + (i+1) + '.</b> ' + escapeHtml(lText);
            const arrow = document.createElement('div'); arrow.className = 'muted'; arrow.textContent = '→';
            const sel = document.createElement('select');
            sel.style.cssText = 'width:100%;padding:8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit';
            sel.innerHTML = '<option value="">— pilih —</option>' + right.map((rText, k) =>
              '<option value="'+k+'">' + String.fromCharCode(65+k) + '. ' + escapeHtml(rText) + '</option>').join('');
            const existing = pairs.find((p) => p[0] === i);
            if (existing) sel.value = String(existing[1]);
            sel.addEventListener('change', () => {
              const cur = (A[q.id] && A[q.id].pairs) ? A[q.id].pairs.filter((p) => p[0] !== i) : [];
              if (sel.value !== '') cur.push([i, +sel.value]);
              cur.sort((a, b) => a[0] - b[0]);
              save(q.id, { pairs: cur });
            });
            grid.appendChild(lab); grid.appendChild(arrow); grid.appendChild(sel);
          });
          el.appendChild(grid);
        }
        // Tombol hint umum (semua tipe). Pakai hint kurangi 50% poin soal ini.
        if (q.content.hint) {
          const hintUsed = A[q.id] && A[q.id].hint_used;
          const hintBtn = document.createElement('button');
          hintBtn.type = 'button';
          hintBtn.textContent = hintUsed ? 'Petunjuk sudah dipakai' : 'Lihat petunjuk (poin soal ini jadi setengah)';
          hintBtn.disabled = !!hintUsed;
          hintBtn.style.cssText = 'margin-top:10px';
          hintBtn.onclick = () => {
            if (!confirm('Menggunakan hint mengurangi 50% poin soal ini. Lanjut?')) return;
            alert('Hint: ' + q.content.hint);
            save(q.id, { hint_used: true });
          };
          el.appendChild(hintBtn);
        }
        qbox.appendChild(el);
        renderMath(el);
        nav.innerHTML = '';
        Q.forEach((qq, k) => {
          const b = document.createElement('button'); b.textContent = k+1;
          if (hasAnswer(qq.id)) b.className = 'ans';
          if (k === i) b.className = (b.className + ' cur').trim();
          b.addEventListener('click', () => { i = k; render(); });
          nav.appendChild(b);
        });
      }
      // Antrian jawaban offline di localStorage. Setiap jawaban paling baru
      // menimpa yang lama untuk question_id yang sama (idempoten).
      const QKEY = 'cbtgas_pending_' + D.sessionId;
      function queueGet() {
        try { return JSON.parse(localStorage.getItem(QKEY) || '{}'); } catch(_) { return {}; }
      }
      function queueSet(m) {
        try { localStorage.setItem(QKEY, JSON.stringify(m)); } catch(_) {}
      }
      async function flushQueue() {
        const m = queueGet();
        for (const [qid, payload] of Object.entries(m)) {
          try {
            const r = await fetch('/s/take/' + D.sessionId + '/answer', {
              method:'POST', credentials:'same-origin',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            if (r.ok) { const cur = queueGet(); delete cur[qid]; queueSet(cur); }
          } catch (_) { return; } // berhenti saat gagal, coba lagi nanti
        }
        updateBadge();
      }
      function updateBadge() {
        const n = Object.keys(queueGet()).length;
        const b = document.getElementById('qbadge'); if (!b) return;
        b.textContent = n ? (n + ' jawaban belum terkirim') : '';
      }
      async function save(qid, payload) {
        A[qid] = Object.assign({}, A[qid] || {}, payload); render();
        const q = Q.find((x) => x.id === qid);
        let outPayload = Object.assign({ question_id: qid }, payload);
        if (q && q.perm && typeof payload.index === 'number') outPayload.index = q.perm[payload.index];
        // Branching: jika soal punya content.branches dan pilihan ini punya
        // target, loncat ke soal target (jika ada dalam urutan sesi).
        if (q && q.content.branches && typeof payload.index === 'number') {
          const target = q.content.branches[String(payload.index)];
          if (target) {
            const nextIdx = Q.findIndex((x) => x.id === target);
            if (nextIdx >= 0 && nextIdx !== i) { i = nextIdx; setTimeout(render, 150); }
          }
        }
        try {
          const r = await fetch('/s/take/' + D.sessionId + '/answer', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outPayload),
          });
          if (!r.ok) throw new Error('http ' + r.status);
        } catch (_) {
          // Simpan ke antrian untuk retry nanti.
          const cur = queueGet(); cur[qid] = outPayload; queueSet(cur); updateBadge();
        }
      }
      window.addEventListener('online', flushQueue);
      updateBadge(); if (navigator.onLine) flushQueue();
      document.getElementById('prev').onclick = () => { if (i > 0) { i--; render(); } };
      document.getElementById('next').onclick = () => { if (i < Q.length-1) { i++; render(); } };
      document.getElementById('submit').onclick = async () => {
        if (!confirm('Kumpulkan ujian sekarang?')) return;
        const r = await fetch('/s/take/' + D.sessionId + '/submit', { method:'POST', credentials:'same-origin' });
        if (r.ok) location.href = '/s'; else alert('Gagal: ' + r.status);
      };
      // Timer
      let dl = new Date(D.deadline).getTime();
      const t = document.getElementById('t');
      function tick() {
        if (isPaused) { t.textContent = 'Dijeda'; setTimeout(tick, 1000); return; }
        const left = Math.max(0, Math.floor((dl - Date.now()) / 1000));
        const m = String(Math.floor(left/60)).padStart(2,'0'); const s = String(left%60).padStart(2,'0');
        t.textContent = m + ':' + s;
        if (left < 300) t.classList.add('warn');
        if (left === 0) { document.getElementById('submit').click(); return; }
        setTimeout(tick, 1000);
      }
      tick(); render();

      // Anti-cheat: lapor peristiwa mencurigakan ke server.
      let lastReport = 0;
      async function report(kind) {
        if (Date.now() - lastReport < 1500) return; // throttle burst
        lastReport = Date.now();
        const r = await fetch('/s/take/' + D.sessionId + '/violation', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }),
        });
        const j = await r.json().catch(() => ({}));
        violations = j.count || violations + 1;
        if (j.locked) { alert('Sesi terkunci karena pelanggaran berulang.'); location.reload(); return; }
        if (level !== 'log') {
          const remain = limit ? Math.max(0, limit - violations) : null;
          alert('Peringatan ('+kind+'). Pelanggaran: '+violations + (remain!==null?', sisa toleransi: '+remain:''));
        }
      }
      // Kalkulator sederhana (parser dua stack, bukan eval).
      const calc = document.getElementById('calc');
      const calcDisp = document.getElementById('calcDisp');
      document.getElementById('calcBtn').onclick = () => { calc.hidden = !calc.hidden; };
      document.getElementById('calcClose').onclick = () => { calc.hidden = true; };
      function compute(expr) {
        // Shunting-yard infix postfix lalu evaluasi.
        const tokens = expr.match(/\\d+(?:\\.\\d+)?|[+\\-*/()]/g); if (!tokens) return '0';
        const prec = { '+':1,'-':1,'*':2,'/':2 };
        const out = []; const ops = [];
        for (const t of tokens) {
          if (/\\d/.test(t)) out.push(parseFloat(t));
          else if (t === '(') ops.push(t);
          else if (t === ')') { while (ops.length && ops[ops.length-1] !== '(') out.push(ops.pop()); ops.pop(); }
          else { while (ops.length && ops[ops.length-1] !== '(' && prec[ops[ops.length-1]] >= prec[t]) out.push(ops.pop()); ops.push(t); }
        }
        while (ops.length) out.push(ops.pop());
        const st = [];
        for (const t of out) {
          if (typeof t === 'number') st.push(t);
          else { const b = st.pop(), a = st.pop(); st.push(t==='+'?a+b:t==='-'?a-b:t==='*'?a*b:b===0?NaN:a/b); }
        }
        const r = st[0]; return isFinite(r) ? +r.toFixed(4) + '' : 'ERR';
      }
      calc.addEventListener('click', (e) => {
        const k = e.target.dataset.k; if (!k) return;
        if (k === 'C') { calcDisp.value = ''; return; }
        if (k === '=') { calcDisp.value = compute(calcDisp.value); return; }
        calcDisp.value += k;
      });

      // Simulasi: terima postMessage dari iframe sandbox dan simpan sebagai
      // text (digabung dengan note bila ada).
      window.addEventListener('message', (ev) => {
        const d = ev.data; if (!d || d.type !== 'answer' || !d.qid) return;
        const q = Q.find((x) => x.id === d.qid); if (!q || q.type !== 'simulasi') return;
        save(q.id, { text: String(d.text || ''), note: A[q.id]?.note ?? '' });
      });

      // Chat sederhana (polling 5 dtk).
      const chatBox = document.getElementById('chatBox');
      const chatInput = document.getElementById('chatInput');
      const chatBtn = document.getElementById('chatBtn');
      const chatBadge = document.getElementById('chatBadge');
      let lastSeenCount = 0, lastSeenFrom = 'student';
      document.getElementById('chatBtn').onclick = () => {
        const cp = document.getElementById('chat');
        cp.hidden = !cp.hidden;
        if (!cp.hidden) { chatBadge.hidden = true; lastSeenCount = chatBox.querySelectorAll('div').length; }
      };
      document.getElementById('chatClose').onclick = () => { document.getElementById('chat').hidden = true; };
      document.getElementById('chatForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = chatInput.value.trim(); if (!content) return;
        chatInput.value = '';
        await fetch('/s/take/' + D.sessionId + '/message', {
          method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ content }),
        });
        await pollChat();
      });
      async function pollChat() {
        try {
          const r = await fetch('/s/take/' + D.sessionId + '/messages', { credentials:'same-origin' });
          if (!r.ok) return;
          const msgs = await r.json();
          chatBox.innerHTML = msgs.map((m) => {
            const align = m.from_role === 'student' ? 'right' : 'left';
            const bg = m.from_role === 'student' ? '#2563eb' : 'var(--bd)';
            const fg = m.from_role === 'student' ? '#fff' : 'var(--fg)';
            return '<div style="text-align:' + align + '; margin:4px 2px"><span style="display:inline-block;padding:4px 10px;border-radius:10px;background:' + bg + ';color:' + fg + ';max-width:220px;text-align:left"><b style="font-size:11px">' + escapeHtml(m.from_name || m.from_role) + '</b><br>' + escapeHtml(m.content) + '</span></div>';
          }).join('');
          chatBox.scrollTop = chatBox.scrollHeight;
          // Badge: ada pesan staff baru yang belum dibuka?
          const n = msgs.length;
          if (document.getElementById('chat').hidden) {
            const unseen = msgs.slice(lastSeenCount).some((m) => m.from_role === 'staff');
            if (unseen) chatBadge.hidden = false;
          }
        } catch(_) {}
      }
      setInterval(pollChat, 5000); pollChat();

      // Heartbeat 15 dtk + cek status pause.
      function applyPause() {
        document.getElementById('pauseOverlay').hidden = !isPaused;
      }
      applyPause();
      async function heartbeat() {
        try {
          const r = await fetch('/s/take/' + D.sessionId + '/ping', { method:'POST', credentials:'same-origin' });
          if (r.ok) { const j = await r.json().catch(() => ({}));
            if (typeof j.paused === 'boolean' && j.paused !== isPaused) { isPaused = j.paused; applyPause(); if (!isPaused && j.deadline) { D.deadline = j.deadline; dl = new Date(D.deadline).getTime(); } }
          }
        } catch(_) {}
        setTimeout(heartbeat, 15000);
      }
      heartbeat();

      document.addEventListener('visibilitychange', () => { if (document.hidden) report('visibility_hidden'); });
      window.addEventListener('blur', () => report('tab_blur'));
      document.addEventListener('contextmenu', (e) => { e.preventDefault(); report('contextmenu'); });
      document.addEventListener('copy', () => report('copy'));
      document.addEventListener('paste', (e) => { e.preventDefault(); report('paste'); });
    </script>
  `));
});

// Simpan jawaban. Payload:
//   {question_id, index}        pg / benar_salah
//   {question_id, text}         isian / uraian
student.post("/s/take/:sid/answer", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | {
    question_id: string; index?: number; text?: string;
    selected?: number[]; pairs?: [number, number][];
    hint_used?: boolean; note?: string;
  };
  if (!body?.question_id) return c.json({ error: "bad body" }, 400);
  const ans: Record<string, unknown> = {};
  if (typeof body.index === "number") ans.index = body.index;
  if (typeof body.text === "string") ans.text = body.text;
  if (typeof body.note === "string") ans.note = body.note;
  if (Array.isArray(body.selected)) ans.selected = body.selected.filter((n) => Number.isInteger(n));
  if (Array.isArray(body.pairs)) ans.pairs = body.pairs.filter((p) => Array.isArray(p) && p.length === 2);
  if (body.hint_used === true) ans.hint_used = true;
  if (Object.keys(ans).length === 0) return c.json({ error: "jawaban kosong" }, 400);

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, (tx) =>
    tx`insert into answers (session_id, question_id, school_id, answer, updated_at)
       select ${sessionId}, ${body.question_id}, ${stu.sid},
              ${ans as unknown as string}, now()
       where exists (select 1 from exam_sessions
                     where id = ${sessionId} and student_id = ${stu.uid} and status = 'active'
                       and deadline_at > now() and paused_at is null)
       on conflict (session_id, question_id)
       do update set answer = coalesce(answers.answer, '{}'::jsonb) || ${ans as unknown as string},
                     updated_at = now()`,
  );
  return c.json({ ok: true });
});

// Chat: siswa kirim pesan ke pengawas (mis. minta izin ke toilet, lapor
// soal rusak). Guru/admin membalas lewat /api/exam-messages (admin API).
student.post("/s/take/:sid/message", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | { content: string };
  if (!body?.content || body.content.length > 500) return c.json({ error: "pesan kosong / terlalu panjang" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const owns = await tx`select 1 from exam_sessions where id = ${sessionId} and student_id = ${stu.uid}`;
    if (owns.length === 0) throw new Error("sesi bukan milik Anda");
    const name = await tx`select name from students where id = ${stu.uid}`;
    const studentName = (name[0] as { name: string } | undefined)?.name ?? "Siswa";
    await tx`insert into exam_messages (school_id, session_id, from_role, from_name, content)
             values (${stu.sid}, ${sessionId}, 'student', ${studentName}, ${body.content})`;
  });
  return c.json({ ok: true });
});

student.get("/s/take/:sid/messages", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, (tx) =>
    tx`select id, from_role, from_name, content, created_at from exam_messages
       where session_id = ${sessionId} order by created_at asc limit 100`,
  );
  return c.json(rows);
});

// Heartbeat: klien ping tiap 15 detik, server update last_seen_at supaya
// guru bisa melihat siapa yang online di /app/exams/:id/live.
student.post("/s/take/:sid/ping", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, (tx) =>
    tx`update exam_sessions set last_seen_at = now()
       where id = ${sessionId} and student_id = ${stu.uid}
       returning paused_at, deadline_at`,
  );
  if (r.length === 0) return c.json({ ok: true });
  const row = r[0] as { paused_at: string | null; deadline_at: string };
  return c.json({ ok: true, paused: !!row.paused_at, deadline: row.deadline_at });
});

// Anti-cheat: catat pelanggaran, naikkan counter, lock sesi bila mencapai
// batas (exam.lock_after_violations). Pelanggaran tetap dicatat meski sesi
// sudah locked/submitted (untuk audit).
student.post("/s/take/:sid/violation", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | { kind: string };
  if (!body?.kind) return c.json({ error: "bad body" }, 400);
  // Daftar putih singkat agar klien tidak menanam bebas.
  const allowed = new Set(["tab_blur", "visibility_hidden", "contextmenu", "copy", "paste", "fullscreen_exit"]);
  const kind = allowed.has(body.kind) ? body.kind : "other";

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const out = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const sess = await tx`
      select es.id, es.status, es.violation_count, e.anticheat_level, e.lock_after_violations
      from exam_sessions es join exams e on e.id = es.exam_id
      where es.id = ${sessionId} and es.student_id = ${stu.uid}`;
    if (sess.length === 0) throw new Error("sesi tidak ditemukan");
    const row = sess[0] as { id: string; status: string; violation_count: number;
      anticheat_level: "log"|"warn"|"lock"; lock_after_violations: number | null };

    await tx`insert into violations (school_id, session_id, kind)
             values (${stu.sid}, ${sessionId}, ${kind})`;
    const nextCount = row.violation_count + 1;
    const limit = row.lock_after_violations ?? 0;
    const shouldLock = row.anticheat_level === "lock" && limit > 0 && nextCount >= limit;
    if (shouldLock) {
      await tx`update exam_sessions set violation_count = ${nextCount}, status = 'locked'
               where id = ${sessionId}`;
    } else {
      await tx`update exam_sessions set violation_count = ${nextCount}
               where id = ${sessionId}`;
    }
    return { ok: true, count: nextCount, locked: shouldLock, level: row.anticheat_level };
  });
  return c.json(out);
});

student.post("/s/take/:sid/submit", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const s = await tx`select id, exam_id, status from exam_sessions
                        where id = ${sessionId} and student_id = ${stu.uid}`;
    if (s.length === 0) throw new Error("sesi tidak ditemukan");
    const row = s[0] as { id: string; exam_id: string; status: string };
    if (row.status === "submitted") return { ok: true, already: true };
    if (row.status !== "active") throw new Error("sesi tidak aktif");
    const r = await finalizeSession(tx, sessionId, "submitted");
    return { ok: true, ...r };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  return c.json(result);
});
