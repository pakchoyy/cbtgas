// Portal siswa: login dengan username + PIN; kerjakan ujian.
// Cookie sesi siswa terpisah (cbt_sstu) agar tidak campur dengan sesi staf.

import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { verifyPin, hashPin } from "./hash";
import {
  cookieHeader, clearCookie, readCookie, sign, verify, Session,
} from "./session";
import { sendEmail, pinNotifyEmail } from "./email";
import { checkOrLimit } from "./ratelimit";
import { SHARED_CSS, LOGO, kindLabel, FEEDBACK_WA, UI_JS } from "./ui";
import { createSession, finalizeSession } from "./scoring";

type Bindings = {
  HYPERDRIVE: Hyperdrive;
  SESSION_SECRET: string;
  APP_ORIGIN: string;
  APP_ENV: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  DEMO_LOGIN?: string;
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
<title>${title} · CBT Yuk</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#F5F7FB">
<link rel="icon" href="/icon-192.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" media="print" onload="this.media='all'">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css" crossorigin="anonymous" media="print" onload="this.media='all'">
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js" crossorigin="anonymous" onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]})"></script>
<script>(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<style>${SHARED_CSS}
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 96px; }
  .q { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 20px 22px; margin-bottom: 14px; box-shadow: var(--shadow); }
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
         border-radius: 50%; border: 2px solid color-mix(in srgb, var(--fg) 55%, var(--line)); display:grid; place-items:center; font-weight: 800; font-size: 14px;
         transition: background .12s, border-color .12s, color .12s; }
  .opt:has(> input[type=checkbox])::before { border-radius: 9px; }
  .opt:has(> input:checked) { border-color: var(--brand); background: var(--soft); }
  .opt:has(> input:checked)::before { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
  .opt:has(> input:focus-visible) { outline: 3px solid var(--pencil); outline-offset: 2px; }
  .opt .opt-letter { display:none; }

  /* Navigasi nomor soal: deretan bulatan kecil seperti baris LJK. */
  .nav { display:grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 8px; margin: 0 0 18px; }
  .nav button { min-height: 42px; min-width: 0; padding: 0; border-radius: 50%; aspect-ratio: 1; font-size: 13px;
                font-variant-numeric: tabular-nums; border: 1.5px solid var(--line); }
  .nav button.ans { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
  .nav button.cur { border: 2.5px solid var(--fg); }
  .nav button.ans.cur { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--brand); }

  .timer { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 18px; letter-spacing: .02em; flex: 0 0 auto;
           padding: 6px 14px; border-radius: 999px; background: #fff; color: var(--brand); }
  .timer.warn { background: #FEE2E2; color: #B91C1C; }
  /* Kepala ujian: pita warna merek, isi putih. Melebar penuh di layar kecil. */
  .exam-head { position: sticky; top: 0; z-index: 30; margin: -24px -16px 18px; padding: 12px 16px 0; color: #fff;
               background: linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 70%, #0F172A)); border-radius: 0 0 20px 20px;
               box-shadow: 0 8px 24px color-mix(in srgb, var(--brand) 25%, transparent); }
  .eh-row { display:flex; align-items:center; justify-content:space-between; gap: 10px; margin-bottom: 10px; }
  .exam-head h1 { font-size: 16.5px; margin: 0; letter-spacing: -.01em; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .eh-btn { min-height: 40px; padding: 6px 12px; font-size: 13.5px; gap: 8px; color: #fff; background: rgba(255,255,255,.14);
            border: 1px solid rgba(255,255,255,.22); box-shadow: none; }
  .eh-btn:hover { background: rgba(255,255,255,.22); border-color: rgba(255,255,255,.3); }
  .eh-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linejoin: round; }
  .eh-btn b { background: #fff; color: var(--brand); border-radius: 999px; padding: 1px 8px; font-size: 12.5px; }
  .eh-note { font-size: 12px; opacity: .85; flex: 1; text-align: center; }
  .prog { height: 4px; margin: 0 -16px; background: rgba(255,255,255,.18); border-radius: 0 0 20px 20px; overflow: hidden; }
  .prog i { display:block; height: 100%; width: 0; background: #fff; transition: width .3s; }
  dialog.qsheet { max-width: 520px; width: calc(100% - 20px); }
  .qs-head { display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px; }
  .qs-head h2 { margin: 0; } .qs-head button { min-height: 40px; min-width: 40px; padding: 0; border: none; box-shadow: none; }
  .qsheet .legend { margin: 6px 0 0; }
  .q.flagged { background: #FFFBEB; border-color: #F59E0B; box-shadow: 0 0 0 1px #F59E0B, var(--shadow); }
  .flagtag { display:inline-flex; align-items:center; gap: 6px; font-size: 12px; font-weight: 700; color: #B45309; background: #FEF3C7; padding: 3px 10px; border-radius: 999px; margin-left: 8px; vertical-align: 1px; }
  :root[data-theme="dark"] .q.flagged { background: #2A2210; }
  .exam-foot { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: var(--surface); border-top: 1px solid var(--line);
               padding: 10px 16px calc(22px + env(safe-area-inset-bottom)); }
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
  /* Pita warna merek di atas halaman siswa (portal, login, konfirmasi). */
  .band { margin: -24px -16px 0; padding: 22px 20px 64px; color: #fff; border-radius: 0 0 28px 28px;
          background: radial-gradient(500px 220px at 90% 0%, rgba(255,255,255,.18), transparent 60%),
                      linear-gradient(140deg, var(--brand), color-mix(in srgb, var(--brand) 62%, #0F172A)); }
  .band .brand, .band .brand b { color: #fff; }
  .band .brand .logo { background: #fff; border-radius: 9px; padding: 3px; } .band .brand span { color: #fff; }
  .band h1 { color: #fff; font-size: clamp(24px, 6vw, 30px); margin: 18px 0 4px; }
  .band p { color: rgba(255,255,255,.85); margin: 0; }
  .band-top { display:flex; justify-content:space-between; align-items:center; gap: 10px; }
  .chip { font-size: 12.5px; font-weight: 700; padding: 5px 12px; border-radius: 999px; background: rgba(255,255,255,.18); color: #fff; border: 1px solid rgba(255,255,255,.25); }
  a.chip, a.chip:visited { color: #fff; text-decoration: none; min-height: 36px; display: inline-flex; align-items: center; }
  .band .ghostbtn { min-height: 38px; padding: 6px 12px; font-size: 13px; color: #fff; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.25); box-shadow: none; }
  .lift { margin-top: -44px; position: relative; }
  .avatar { width: 52px; height: 52px; border-radius: 16px; background: rgba(255,255,255,.2); border: 1px solid rgba(255,255,255,.3); display:grid; place-items:center; font-weight: 800; font-size: 20px; color: #fff; flex: 0 0 auto; }
  .who { display:flex; gap: 14px; align-items:center; margin-top: 18px; }
  .who h1 { margin: 0; }
  .exam-item { display:flex; align-items:center; gap: 14px; padding: 14px 0; border-top: 1px solid var(--line); }
  .exam-item:first-of-type { border-top: none; }
  .exam-item .ei { width: 44px; height: 44px; border-radius: 12px; background: var(--soft); color: var(--brand); display:grid; place-items:center; flex: 0 0 auto; }
  .exam-item .ei svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
  .exam-item .et { flex: 1; min-width: 0; } .exam-item .et b { display:block; }
  .nav button.flag { background: #F59E0B; border-color: #F59E0B; color: #fff; }
  .legend { display:flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--mut); margin: -8px 0 16px; }
  .legend i { display:inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; border: 1.5px solid var(--line); }
  .legend i.a { background: var(--brand); border-color: var(--brand); } .legend i.f { background: #F59E0B; border-color: #F59E0B; }
  button.ragu { background: #FEF3C7; border-color: #FCD34D; color: #92400E; }
  .eh-btn.done { background: #fff; border-color: #fff; color: #0F172A; }
  .eh-row + .eh-row { justify-content: flex-start; gap: 8px; } .eh-row + .eh-row .eh-note { flex: 1; }
  @media (max-width: 480px) { #exitBtn span, #chatBtn > span:first-of-type, #gridBtn > span { display: none; } .eh-btn { padding: 6px 10px; } }
  button.ragu[aria-pressed="true"] { background: #F59E0B; border-color: #F59E0B; color: #fff; }
  .gate { position: fixed; inset: 0; z-index: 120; display:grid; place-items:center; padding: 24px; background: rgba(10,15,28,.86); }
  .gate .card { max-width: 440px; text-align:center; margin: 0; }
  .gate .card h2 { font-size: 21px; }
  .gate .warn-ic { width: 56px; height: 56px; border-radius: 50%; display:grid; place-items:center; margin: 0 auto 12px; font-size: 28px; font-weight: 800; }
  .toast { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 130; background: #B91C1C; color: #fff; padding: 10px 16px;
           border-radius: 12px; font-weight: 600; font-size: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25); max-width: calc(100% - 24px); }
  .sum { display:grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0; }
  .sum div { border: 1px solid var(--line); border-radius: 12px; padding: 10px; text-align:center; } .sum b { display:block; font-size: 22px; }
  .jump { display:flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 4px; justify-content:center; }
  .jump button { min-height: 36px; min-width: 36px; padding: 0 8px; border-radius: 50%; font-size: 13px; }
  .badge { margin-left: 6px; background: var(--danger); color: #fff; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
</style>
<link rel="stylesheet" href="/brand.css"></head><body><main>${body}</main>
${UI_JS}
</body></html>`;

// Layar "ujian terkunci": siswa memasukkan kode buka dari pengawas.
const lockedCard = (title: string, sessionId: string) => `
  <div class="card" style="max-width:440px;margin:10vh auto 0;text-align:center;padding:28px">
    <div style="width:60px;height:60px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;font-size:28px;background:#FEE2E2;color:#B91C1C">🔒</div>
    <h1 style="font-size:22px">Ujian terkunci</h1>
    <p class="sub">${esc(title)}<br>Terlalu banyak pelanggaran (keluar layar, pindah aplikasi). Minta <b>kode buka</b> ke pengawas, lalu masukkan di bawah. Jawaban Anda tetap aman.</p>
    <p class="muted" style="font-size:13px;background:#FEF3C7;color:#92400E;border-radius:12px;padding:10px 12px">Setelah dibuka, hitungan pelanggaran mulai dari 0. Jika batas tercapai <b>lagi</b>, jawaban dikumpulkan otomatis.</p>
    <form id="uf"><input id="uc" class="token" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••" aria-label="Kode buka" required
      style="font:800 26px/1 ui-monospace,Menlo,monospace;letter-spacing:.35em;text-align:center;min-height:60px">
      <button class="primary" style="width:100%;min-height:52px;margin-top:12px">Buka ujian</button></form>
    <p class="err" id="ue" hidden></p>
  </div>
  <script>
    document.getElementById('uf').addEventListener('submit', async (e) => {
      e.preventDefault(); const er = document.getElementById('ue'); er.hidden = true;
      const r = await fetch('/s/take/${sessionId}/unlock', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: document.getElementById('uc').value }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) location.href = '/s/take/${sessionId}'; else { er.textContent = j.error || 'Gagal.'; er.hidden = false; }
    });
  </script>`;

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
      ? `<span class="pill submitted">Selesai</span>`
      : e.session_status === "expired"
      ? `<span class="pill expired">Waktu habis</span>`
      : `<form method="post" action="/s/exams/${esc(e.id)}/start" style="margin:0"><button class="primary">${e.session_id ? "Lanjutkan" : "Mulai"}</button></form>`;
    return `<div class="exam-item">
      <span class="ei"><svg viewBox="0 0 24 24"><path d="M9 4h6v3H9zM6 6h12v15H6zM9 11h6M9 15h4"/></svg></span>
      <span class="et"><b>${esc(e.title)}</b><span class="muted">${esc(kindLabel(e.kind))} · ${e.duration_minutes} menit</span></span>
      ${action}
    </div>`;
  }).join("") || `<p class="muted" style="text-align:center;padding:18px 0;margin:0">Belum ada ujian yang dibuka untuk kelas Anda.</p>`;
  const initials = (me?.name ?? "S").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return c.html(page("Portal Siswa", `
    <section class="band">
      <div class="band-top"><span class="brand">${LOGO}</span>
        <div class="row" style="margin:0"><a class="btn ghostbtn" href="/s/me">Ganti PIN</a>
        <form method="post" action="/s/logout" style="margin:0"><button type="submit" class="ghostbtn">Keluar</button></form></div></div>
      <div class="who"><span class="avatar">${esc(initials)}</span>
        <div><h1>Halo, ${esc(me?.name ?? "siswa")}</h1><p>${esc(me?.class_name ? "Kelas " + me.class_name : "Belum terdaftar di kelas")}</p></div></div>
    </section>
    <div class="lift">
      ${c.req.query("selesai") ? `<div class="card" role="status" style="border-color:var(--ok);display:flex;gap:14px;align-items:center">
        <span style="width:40px;height:40px;border-radius:50%;background:var(--ok);color:#fff;display:grid;place-items:center;font-weight:800;flex:0 0 auto">✓</span>
        <span><b>Ujian berhasil dikumpulkan.</b><br><span class="muted">Lihat nilainya di <a href="/s/history">riwayat ujian</a>.</span></span></div>` : ""}
      <div class="card">
        <h2>Ujian untuk Anda</h2>
        ${list}
      </div>
      <div class="card">
        <h2>Riwayat & belajar</h2>
        <div class="row" style="margin-top:0"><a class="btn" href="/s/history">Riwayat nilai</a><a class="btn" href="/s/rekomendasi">Rekomendasi belajar</a></div>
        <p class="muted" style="margin:14px 0 0">Ada masalah atau saran? <a href="${FEEDBACK_WA}" target="_blank" rel="noopener">Kirim lewat WhatsApp</a></p>
      </div>
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
  <section class="band" style="padding-bottom:72px">
    <div class="band-top"><a class="brand" href="/">${LOGO}</a><a class="chip" href="/masuk">Masuk sebagai guru</a></div>
    <h1>Masuk siswa</h1>
    <p>Pakai username dan PIN yang diberikan guru.</p>
  </section>
  <div class="lift" style="max-width:440px;margin-left:auto;margin-right:auto">
    <div class="card" style="padding:24px">
      <form id="f">
        <label for="u">Username</label><input id="u" name="username" required autocomplete="username" autocapitalize="none" placeholder="Username atau NISN">
        <label for="p">PIN</label><input id="p" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required pattern="\\d{4,8}" placeholder="4–8 angka">
        <button class="primary" type="submit" style="width:100%;min-height:50px;margin-top:18px">Masuk</button>
        <p class="err" id="err" role="alert" hidden></p>
      </form>
      <p class="muted" style="margin:16px 0 0;text-align:center"><a href="/s/forgot">Lupa PIN?</a> · <a href="/demo">Coba demo</a></p>
    </div>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('err'); err.hidden = true;
      const btn = e.target.querySelector('button'); btn.disabled = true;
      const d = Object.fromEntries(new FormData(e.target));
      const r = await fetch('/s/login', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (r.ok) { location.href = '/s'; return; }
      btn.disabled = false;
      const j = await r.json().catch(() => ({})); err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false;
    });
  </script>
`)));

student.post("/s/login", async (c) => {
  const rl = await checkOrLimit(c.env, c.req.raw.headers, "s_login", 10);
  if (rl) return rl;
  const body = await c.req.json().catch(() => null) as null | { username: string; pin: string };
  if (!body?.username || !body?.pin) return c.json({ error: "Isi username dan PIN." }, 400);

  // Tanpa kode sekolah: cari username di semua sekolah aktif, cocokkan PIN.
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  type Cand = { id: string; school_id: string; name: string; pin_hash: string; locked_until: string | null; pin_failed_count: number };
  const cands = await sql`select * from find_students_by_username(${body.username})` as unknown as Cand[];
  if (cands.length === 0) return c.json({ error: "Username atau PIN salah." }, 401);
  let u: Cand | null = null;
  for (const x of cands) {
    if (x.locked_until && new Date(x.locked_until).getTime() > Date.now()) continue;
    if (await verifyPin(body.pin, x.pin_hash)) { u = x; break; }
  }
  if (!u) {
    // Hitung gagal hanya bila username unik (tidak tahu sekolah mana yang dimaksud kalau ganda).
    if (cands.length === 1) {
      const x = cands[0];
      if (x.locked_until && new Date(x.locked_until).getTime() > Date.now()) {
        return c.json({ error: "Akun terkunci 15 menit karena PIN salah berkali-kali. Hubungi guru." }, 423);
      }
      const next = x.pin_failed_count + 1;
      const lock = next >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      await withTenant(sql, { schoolId: x.school_id, role: "student", userId: x.id }, (tx) =>
        tx`update students set pin_failed_count = ${next}, locked_until = ${lock} where id = ${x.id}`);
    }
    return c.json({ error: "Username atau PIN salah." }, 401);
  }
  const sid = u.school_id, uid = u.id;
  await withTenant(sql, { schoolId: sid, role: "student", userId: uid }, (tx) =>
    tx`update students set pin_failed_count = 0, locked_until = null where id = ${uid}`);

  const session: StudentSession = {
    uid, sid, role: "student",
    email: `${body.username}@siswa`,
    exp: Math.floor(Date.now() / 1000) + STUDENT_TTL,
  };
  const cookie = await sign(session as unknown as Session, c.env.SESSION_SECRET);
  const h = new Headers({ "Content-Type": "application/json" });
  h.append("Set-Cookie", cookieHeader(STUDENT_COOKIE, cookie, { maxAge: STUDENT_TTL }));
  return new Response(JSON.stringify({ ok: true }), { headers: h });
});


// Lupa PIN: siswa isi username, system masukkan ke antrian
// pin_resets. Guru/admin menyetujui lewat dashboard PIN 6-digit baru
// ditampilkan sekali untuk disampaikan ke siswa.
student.post("/s/forgot", async (c) => {
  const rl = await checkOrLimit(c.env, c.req.raw.headers, "s_forgot", 5);
  if (rl) return rl;
  const body = await c.req.json().catch(() => null) as null | { username: string };
  if (!body?.username) return c.json({ error: "Isi username." }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const found = await sql`select school_id from find_students_by_username(${body.username})`;
  const contacts: Array<{ school: string; name: string; wa: string }> = [];
  // Username yang sama bisa ada di beberapa sekolah: ajukan ke semuanya.
  for (const { school_id: sid } of found as unknown as Array<{ school_id: string }>) {
    const notify = await withTenant(sql, { schoolId: sid, role: "student" }, async (tx) => {
      const stu = await tx`select id, name from students where lower(username) = lower(trim(${body.username})) and active`;
      if (stu.length === 0) return null;  // Diam-diam ok supaya tidak membocorkan username ada/tidak.
      const stuRow = stu[0] as { id: string; name: string };
      const existing = await tx`select id from pin_resets where student_id = ${stuRow.id} and status = 'pending'`;
      if (existing.length === 0) {
        await tx`insert into pin_resets (school_id, student_id) values (${sid}, ${stuRow.id})`;
      }
      const [sch, admins] = await Promise.all([
        tx`select name, operator_name, operator_phone from schools where id = ${sid}`,
        tx`select email from users where role in ('admin','teacher') and active`,
      ]);
      const sc = sch[0] as { name: string; operator_name: string | null; operator_phone: string | null } | undefined;
      const ph = (sc?.operator_phone ?? "").replace(/\D/g, "").replace(/^0/, "62");
      if (ph.length >= 9) contacts.push({ school: sc!.name, name: sc!.operator_name ?? "operator", wa: ph });
      return {
        schoolName: sc?.name ?? "",
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
  }
  return c.json({ ok: true, contacts, message: "Permintaan terkirim ke sekolah. Hubungi operator untuk mendapat PIN baru." });
});

student.get("/s/forgot", (c) => c.html(page("Lupa PIN", `
  <div class="card" style="max-width:440px;margin:8vh auto 0">
    <h1>Lupa PIN</h1>
    <p class="sub">Masukkan username (atau NISN). Kami kirim permintaan ke sekolah, lalu Anda bisa langsung menghubungi operator lewat WhatsApp.</p>
    <form id="f">
      <label>Username / NISN</label><input name="username" required autocapitalize="none" autocomplete="username" placeholder="mis. 0081234567">
      <button class="primary" type="submit" style="width:100%;min-height:50px;margin-top:12px">Minta PIN baru</button>
    </form>
    <div id="res" hidden style="margin-top:16px"></div>
    <p style="text-align:center;margin:16px 0 0"><a href="/s/login">‹ Kembali ke halaman masuk</a></p>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const r = await fetch('/s/forgot', { method:'POST', credentials:'same-origin', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(d) });
      const j = await r.json().catch(() => ({}));
      const res = document.getElementById('res'); res.hidden = false; res.innerHTML = '';
      const p = document.createElement('p'); p.className = r.ok ? 'muted' : 'err'; p.textContent = j.message || j.error || 'Gagal mengirim.'; res.appendChild(p);
      (j.contacts || []).forEach((k) => {
        const a = document.createElement('a'); a.className = 'btn'; a.target = '_blank'; a.rel = 'noopener';
        a.style.cssText = 'width:100%;min-height:50px;background:#16A34A;border-color:#16A34A;color:#fff;margin-top:8px';
        a.href = 'https://wa.me/' + k.wa + '?text=' + encodeURIComponent('Halo ' + k.name + ', saya siswa ' + k.school + ' dengan username ' + d.username + '. Saya lupa PIN CBT Yuk, mohon dibantu reset.');
        a.textContent = 'Chat ' + k.name + ' (' + k.school + ') di WhatsApp'; res.appendChild(a);
      });
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
  const h = new Headers({ Location: "/s/login" });
  h.append("Set-Cookie", clearCookie(STUDENT_COOKIE));
  return new Response(null, { status: 302, headers: h });
});

// Mulai (atau lanjutkan) sesi ujian: buat exam_sessions kalau belum ada, hitung
// deadline dari starts_at atau now() + duration.

// ===== Demo siswa =====
// Tombol "Coba demo → sebagai siswa" membuat siswa tamu sekali pakai di sekolah
// demo, lalu menampilkan layar konfirmasi peserta ala TKA/ANBK dengan token
// yang sudah terisi. Siswa tamu dihapus cron setelah 6 jam.
const DEMO_EXAM = "Tryout Demo CBT Yuk";
const DEMO_NAMES = ["Rina Amelia", "Bagas Pratama", "Salsa Nabila", "Dimas Saputra", "Aulia Rahma",
  "Fajar Nugroho", "Nadia Putri", "Raka Aditya", "Citra Lestari", "Yoga Permana"];

student.post("/demo/siswa", async (c) => {
  if (c.env.DEMO_LOGIN !== "1") return c.notFound();
  const rl = await checkOrLimit(c.env, c.req.raw.headers, "demo_siswa", 20);
  if (rl) return rl;
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const sch = await sql`select id from resolve_school('demo-sma')`;
  if (sch.length === 0) return c.text("Sekolah demo belum disiapkan.", 503);
  const sid = (sch[0] as { id: string }).id;
  const rand = crypto.getRandomValues(new Uint8Array(4));
  const tag = [...rand].map((b) => b.toString(16).padStart(2, "0")).join("");
  const name = DEMO_NAMES[rand[0] % DEMO_NAMES.length];
  const uid = await withTenant(sql, { schoolId: sid, role: "admin" }, async (tx) => {
    const cls = await tx`select ec.class_id from exams e join exam_classes ec on ec.exam_id = e.id
                         where e.title = ${DEMO_EXAM} and e.status = 'open' limit 1`;
    if (cls.length === 0) return null;
    const ins = await tx`insert into students (school_id, class_id, name, username, pin_hash)
      values (${sid}, ${(cls[0] as { class_id: string }).class_id}, ${name}, ${"tamu-" + tag}, 'tamu-tanpa-pin')
      returning id`;
    return (ins[0] as { id: string }).id;
  });
  if (!uid) return c.text("Ujian demo belum disiapkan.", 503);
  const session: StudentSession = { uid, sid, role: "student", email: `tamu-${tag}@demo`,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2 };
  const cookie = await sign(session as unknown as Session, c.env.SESSION_SECRET);
  const h = new Headers({ Location: "/demo/konfirmasi" });
  h.append("Set-Cookie", cookieHeader(STUDENT_COOKIE, cookie, { maxAge: 60 * 60 * 2 }));
  return new Response(null, { status: 303, headers: h });
});

student.get("/demo/konfirmasi", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.redirect("/demo");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const d = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const [me, ex] = await Promise.all([
      tx`select s.name, s.username, c.name as class_name, sc.name as school
                        from students s left join classes c on c.id = s.class_id join schools sc on sc.id = s.school_id
                        where s.id = ${stu.uid}`,
      tx`select e.id, e.title, e.duration_minutes,
                          (select count(*) from exam_questions where exam_id = e.id)::int as n
                        from exams e where e.title = ${DEMO_EXAM} and e.status = 'open' limit 1`,
    ]);
    return { me: me[0], ex: ex[0] };
  });
  const me = d.me as { name: string; username: string; class_name: string | null; school: string } | undefined;
  const ex = d.ex as { id: string; title: string; duration_minutes: number; n: number } | undefined;
  if (!me || !ex) return c.redirect("/demo");
  const token = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 24]).join("");
  return c.html(page("Konfirmasi peserta", `
    <style>
      .tka-top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 18px; }
      .tka-top .brand { font-size: 17px; }
      .tka-tag { font-size: 12px; font-weight: 700; color: var(--brand); background: var(--soft); padding: 4px 10px; border-radius: 999px; }
      .tka-grid { display:grid; grid-template-columns: 1.2fr 1fr; gap: 16px; align-items:start; }
      @media (max-width: 680px) { .tka-grid { grid-template-columns: 1fr; } }
      .tka-row { display:grid; grid-template-columns: 130px 1fr; gap: 6px 12px; padding: 11px 0; border-top: 1px solid var(--line); }
      .tka-row:first-of-type { border-top: none; }
      .tka-row dt { color: var(--mut); font-size: 13.5px; } .tka-row dd { margin: 0; font-weight: 700; }
      .token { font: 800 26px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .3em; text-align:center; text-transform: uppercase; min-height: 60px; }
      .steps-mini { margin: 0; padding-left: 18px; color: var(--mut); font-size: 14px; } .steps-mini li { margin: 6px 0; }
    </style>
    <section class="band">
      <div class="band-top"><span class="brand">${LOGO}</span><span class="chip">Mode demo</span></div>
      <div class="who"><span class="avatar">${esc(me.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>
        <div><h1>Konfirmasi data peserta</h1><p>Periksa data Anda, lalu tekan <b>Mulai ujian</b>.</p></div></div>
    </section>
    <div class="tka-grid lift">
      <div class="card">
        <dl style="margin:0">
          <div class="tka-row"><dt>No. peserta</dt><dd>${esc(me.username.toUpperCase())}</dd></div>
          <div class="tka-row"><dt>Nama peserta</dt><dd>${esc(me.name)}</dd></div>
          <div class="tka-row"><dt>Kelas</dt><dd>${esc(me.class_name ?? "-")}</dd></div>
          <div class="tka-row"><dt>Sekolah</dt><dd>${esc(me.school)}</dd></div>
          <div class="tka-row"><dt>Mata ujian</dt><dd>${esc(ex.title)}</dd></div>
          <div class="tka-row"><dt>Waktu</dt><dd>${ex.duration_minutes} menit · ${ex.n} soal</dd></div>
        </dl>
      </div>
      <form class="card" method="post" action="/s/exams/${esc(ex.id)}/start">
        <label for="tok" style="margin-top:0">Token ujian</label>
        <input id="tok" class="token" value="${token}" readonly aria-describedby="tokHint">
        <p class="muted" id="tokHint" style="margin:8px 0 0">Untuk demo, token sudah terisi otomatis.</p>
        <button class="primary" type="submit" style="width:100%; min-height:52px; margin-top:16px; font-size:16px">Mulai ujian</button>
        <h3 style="margin:22px 0 8px">Yang akan Anda coba</h3>
        <ol class="steps-mini">
          <li>Soal pilihan ganda, benar/salah, pilihan kompleks, menjodohkan, isian, dan uraian.</li>
          <li>Mode layar penuh, tombol ragu-ragu, daftar nomor soal, timer, dan chat ke pengawas.</li>
          <li>Jawaban tersimpan otomatis. Nilai keluar setelah dikumpulkan.</li>
        </ol>
      </form>
    </div>
    <p class="muted" style="text-align:center;margin-top:8px"><a href="/demo">Kembali ke pilihan demo</a></p>
  `));
});

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
             es.violation_count, es.paused_at, es.lock_count,
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
    const prev = await tx`select question_id, answer, flagged from answers where session_id = ${sessionId}`;
    const answers: Record<string, { index?: number; text?: string }> = {};
    const flags: string[] = [];
    for (const a of prev as unknown as Array<{ question_id: string; answer: { index?: number; text?: string } | null; flagged: boolean }>) {
      if (a.flagged) flags.push(a.question_id);
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
      title: sess.title, deadline: sess.deadline_at, questions, answers, flags,
      anticheat: sess.anticheat_level, limit: sess.lock_after_violations || 3,
      violations: sess.violation_count, locks: (sess as unknown as { lock_count: number }).lock_count,
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
  if ("locked" in data) return c.html(page(data.title!, lockedCard(data.title!, sessionId)));

  const payload = JSON.stringify({
    sessionId, deadline: data.deadline,
    questions: data.questions, answers: data.answers, flags: data.flags,
    anticheat: data.anticheat, limit: data.limit, violations: data.violations, locks: data.locks,
    paused_at: data.paused_at,
  });
  return c.html(page(data.title!, `
    <div id="pauseOverlay" class="overlay" hidden>
      <div>
        <h2 style="font-size:22px;margin:0 0 6px">Ujian dijeda pengawas</h2>
        <p style="margin:0;opacity:.8">Waktu berhenti. Tunggu guru melanjutkan.</p>
      </div>
    </div>
    <div id="gate" class="gate" hidden>
      <div class="card">
        <div class="warn-ic" id="gateIc" style="background:var(--soft);color:var(--brand)">⛶</div>
        <h2 id="gateTitle">Ujian berjalan dalam layar penuh</h2>
        <p class="sub" id="gateText">Selama ujian, jangan keluar dari layar penuh, berpindah aplikasi, atau menekan tombol kembali. Setiap pelanggaran dicatat dan terlihat oleh pengawas.</p>
        <button class="primary" type="button" id="gateBtn" style="width:100%;min-height:52px">Masuk layar penuh &amp; mulai</button>
      </div>
    </div>
    <div id="toast" class="toast" role="alert" hidden></div>
    <dialog id="finish">
      <h2 style="margin:0 0 4px">Selesai mengerjakan?</h2>
      <p class="muted" id="finNote" style="margin:0"></p>
      <div class="sum"><div><b id="finA">0</b><span class="muted">Dijawab</span></div><div><b id="finF">0</b><span class="muted">Ragu-ragu</span></div><div><b id="finU">0</b><span class="muted">Belum</span></div></div>
      <div id="finJump"></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" id="finBack">Periksa lagi</button>
        <button type="button" class="primary" id="finGo">Kumpulkan</button>
      </div>
    </dialog>
    <header class="exam-head">
      <div class="eh-row">
        <h1>${esc(data.title!)}</h1>
        <span class="timer" id="t" aria-live="off">--:--</span>
      </div>
      <div class="eh-row">
        <button type="button" id="gridBtn" class="eh-btn" aria-haspopup="dialog">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>
          <span>Daftar soal</span><b id="progTxt">0/0</b>
        </button>
        <span id="qbadge" class="eh-note"></span>
        <button type="button" id="chatBtn" class="eh-btn">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg><span>Pengawas</span><span id="chatBadge" class="badge" hidden>baru</span>
        </button>
        <button type="button" id="exitBtn" class="eh-btn" title="Simpan dan keluar sementara">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg><span>Keluar</span>
        </button>
        <button type="button" id="doneBtn" class="eh-btn done">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Kumpulkan</span>
        </button>
      </div>
      <div class="prog" aria-hidden="true"><i id="progBar"></i></div>
    </header>
    <dialog id="grid" class="qsheet" aria-labelledby="gridH">
      <div class="qs-head"><h2 id="gridH">Daftar soal</h2><button type="button" id="gridX" aria-label="Tutup">✕</button></div>
      <div class="nav" id="nav" aria-label="Nomor soal"></div>
      <div class="legend" aria-hidden="true"><span><i class="a"></i>Dijawab</span><span><i class="f"></i>Ragu-ragu</span><span><i></i>Belum dijawab</span></div>
    </dialog>
    <section id="chat" class="panel" hidden aria-label="Chat pengawas">
      <div class="panel-head"><b>Chat pengawas</b><button type="button" id="chatClose" aria-label="Tutup chat">Tutup</button></div>
      <div id="chatBox" class="chat-box"></div>
      <form id="chatForm" style="display:flex; gap:6px; margin-top:8px">
        <input id="chatInput" placeholder="Misalnya: izin ke toilet" maxlength="500" aria-label="Pesan untuk pengawas">
        <button class="primary" type="submit">Kirim</button>
      </form>
    </section>

    <div id="qbox"></div>
    <p class="muted" style="margin-top:18px">Jawaban tersimpan otomatis setiap kali Anda memilih atau mengetik.</p>
    <div class="exam-foot"><div class="in">
      <button id="prev" aria-label="Soal sebelumnya">‹ Sebelumnya</button>
      <span class="spacer"></span>
      <button id="ragu" class="ragu" aria-pressed="false">Ragu-ragu</button>
      <span class="spacer"></span>
      <button id="next" class="primary">Berikutnya ›</button>
    </div></div>
    <script id="data" type="application/json">${payload.replace(/</g, "\\u003c")}</script>
    <script>
      const D = JSON.parse(document.getElementById('data').textContent);
      let isPaused = !!D.paused_at;
      const Q = D.questions; const A = D.answers || {}; let i = 0;
      const F = new Set(D.flags || []); let submitting = false;
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
        if (F.has(q.id)) el.classList.add('flagged');
        el.innerHTML = head + '<p><b>Soal ' + (i+1) + ' / ' + Q.length + '</b>' + tag + (F.has(q.id) ? '<span class="flagtag">Ragu-ragu</span>' : '') + '</p><p>' + mdRender(q.content.text) + '</p>';
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
          hintBtn.onclick = async () => {
            if (!(await ask('Menggunakan hint mengurangi 50% poin soal ini. Lanjut?'))) return;
            alert('Hint: ' + q.content.hint);
            save(q.id, { hint_used: true });
          };
          el.appendChild(hintBtn);
        }
        qbox.appendChild(el);
        renderMath(el);
        const nAns = Q.filter((qq) => hasAnswer(qq.id)).length;
        document.getElementById('progTxt').textContent = nAns + '/' + Q.length;
        document.getElementById('progBar').style.width = (nAns / Q.length * 100) + '%';
        const rg = document.getElementById('ragu'); rg.setAttribute('aria-pressed', String(F.has(q.id)));
        document.getElementById('prev').disabled = i === 0;
        document.getElementById('next').textContent = i === Q.length - 1 ? 'Selesai' : 'Berikutnya ›';
        nav.innerHTML = '';
        Q.forEach((qq, k) => {
          const b = document.createElement('button'); b.textContent = k+1;
          if (F.has(qq.id)) b.className = 'flag'; else if (hasAnswer(qq.id)) b.className = 'ans';
          if (k === i) b.className = (b.className + ' cur').trim();
          b.addEventListener('click', () => { i = k; document.getElementById('grid').close(); render(); window.scrollTo(0, 0); });
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
      document.getElementById('gridBtn').onclick = () => document.getElementById('grid').showModal();
      document.getElementById('gridX').onclick = () => document.getElementById('grid').close();
      document.getElementById('prev').onclick = () => { if (i > 0) { i--; render(); window.scrollTo(0, 0); } };
      document.getElementById('next').onclick = () => {
        if (i < Q.length - 1) { i++; render(); window.scrollTo(0, 0); } else openFinish();
      };
      document.getElementById('ragu').onclick = async () => {
        const q = Q[i]; const on = !F.has(q.id);
        on ? F.add(q.id) : F.delete(q.id); render();
        fetch('/s/take/' + D.sessionId + '/flag', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question_id: q.id, flagged: on }) }).catch(() => {});
      };
      // Soal dianggap selesai bila dijawab lengkap (menjodohkan: semua pasangan terisi).
      const done = (q) => q.type === 'menjodohkan'
        ? Array.isArray(A[q.id]?.pairs) && A[q.id].pairs.length >= (q.content.left || []).length
        : hasAnswer(q.id);
      const finish = document.getElementById('finish');
      function openFinish() {
        const unans = Q.map((q, k) => [q, k]).filter(([q]) => !done(q));
        const rag = Q.map((q, k) => [q, k]).filter(([q]) => F.has(q.id));
        document.getElementById('finA').textContent = Q.length - unans.length;
        document.getElementById('finF').textContent = rag.length;
        document.getElementById('finU').textContent = unans.length;
        const go = document.getElementById('finGo'); go.disabled = unans.length > 0;
        document.getElementById('finNote').textContent = unans.length
          ? 'Masih ada soal yang belum dijawab. Ujian bisa dikumpulkan setelah semua soal terjawab.'
          : rag.length ? 'Semua soal sudah dijawab, tapi masih ada yang ragu-ragu. Periksa lagi atau kumpulkan sekarang.'
          : 'Semua soal sudah dijawab. Setelah dikumpulkan, jawaban tidak bisa diubah.';
        const list = unans.length ? unans : rag;
        document.getElementById('finJump').innerHTML = list.length
          ? '<p class="muted" style="margin:4px 0 0;text-align:center">' + (unans.length ? 'Belum dijawab' : 'Ragu-ragu') + ' — ketuk untuk membuka:</p><div class="jump">' + list.map(([q, k]) => '<button type="button" data-k="' + k + '">' + (k + 1) + '</button>').join('') + '</div>' : '';
        finish.showModal();
      }
      document.getElementById('finJump').addEventListener('click', (e) => {
        const k = e.target.dataset.k; if (k === undefined) return; finish.close(); i = +k; render(); window.scrollTo(0, 0);
      });
      document.getElementById('finBack').onclick = () => finish.close();
      document.getElementById('finGo').onclick = () => submitExam(false);
      document.getElementById('doneBtn').onclick = () => openFinish();
      document.getElementById('exitBtn').onclick = async () => {
        if (!(await ask('Keluar sementara? Jawaban sudah tersimpan, tapi waktu ujian tetap berjalan. Masuk lagi untuk melanjutkan. Untuk menyelesaikan ujian, pakai tombol Kumpulkan.', 'Ya, keluar'))) return;
        submitting = true; try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {}
        location.href = '/s';
      };
      async function submitExam(auto) {
        if (submitting) return; submitting = true;
        try { await flushQueue(); } catch (_) {}
        if (auto) showGate('⏱', 'Waktu habis', 'Jawaban Anda sedang dikumpulkan otomatis…', null);
        const r = await fetch('/s/take/' + D.sessionId + '/submit', { method:'POST', credentials:'same-origin' }).catch(() => null);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        if (r && r.ok) { location.href = '/s?selesai=1'; return; }
        submitting = false;
        showGate('!', 'Gagal mengumpulkan', 'Periksa koneksi internet, lalu coba lagi. Jawaban Anda tetap tersimpan.', ['Coba lagi', () => submitExam(auto)]);
      }
      // Timer
      let dl = new Date(D.deadline).getTime();
      const t = document.getElementById('t');
      function tick() {
        if (isPaused) { t.textContent = 'Dijeda'; setTimeout(tick, 1000); return; }
        const left = Math.max(0, Math.floor((dl - Date.now()) / 1000));
        const m = String(Math.floor(left/60)).padStart(2,'0'); const s = String(left%60).padStart(2,'0');
        t.textContent = m + ':' + s;
        if (left < 300) t.classList.add('warn');
        if (left === 0) { submitExam(true); return; }
        setTimeout(tick, 1000);
      }
      tick(); render();

      function warnBig(t, m) {
        const d = document.createElement('dialog'); d.className = 'yk-ask';
        d.innerHTML = '<div class="ai dg">!</div><p style="font-weight:800;color:var(--fg);margin-bottom:4px"></p><p></p><div class="ab"><button type="button" class="primary">Saya mengerti</button></div>';
        d.querySelectorAll('p')[0].textContent = t; d.querySelectorAll('p')[1].textContent = m;
        d.querySelector('button').onclick = () => { d.close(); d.remove(); };
        document.body.appendChild(d); d.showModal();
      }
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
        if (j.locked || j.submitted) { submitting = true; location.reload(); return; }
        if (level !== 'log') {
          const remain = limit ? Math.max(0, limit - violations) : null;
          const next = (D.locks || 0) >= 1 ? 'jawaban Anda dikumpulkan otomatis' : 'ujian dikunci dan Anda harus minta kode ke pengawas';
          if (remain === 1) warnBig('Peringatan terakhir', 'Satu kali lagi keluar dari halaman ujian, ' + next + '.');
          else toast('Pelanggaran: ' + (KIND[kind] || kind) + ' (' + violations + ' dari ' + limit + '). Jika mencapai ' + limit + ', ' + next + '.', 'err');
        }
      }
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

      // ===== Mode ujian: layar penuh, tombol kembali, keluar halaman =====
      const KIND = { tab_blur: 'meninggalkan halaman ujian', visibility_hidden: 'berpindah aplikasi/tab', contextmenu: 'klik kanan',
        copy: 'menyalin', paste: 'menempel', fullscreen_exit: 'keluar dari layar penuh' };
      let toastT;
      function toast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 5000); }
      const gate = document.getElementById('gate');
      let gateAction = null;
      function showGate(ic, title, text, action) {
        document.getElementById('gateIc').textContent = ic;
        document.getElementById('gateTitle').textContent = title;
        document.getElementById('gateText').textContent = text;
        const b = document.getElementById('gateBtn'); b.hidden = !action;
        if (action) { b.textContent = action[0]; gateAction = action[1]; }
        gate.hidden = false;
      }
      document.getElementById('gateBtn').onclick = () => { if (gateAction) gateAction(); };
      const canFs = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
      const enterFs = () => document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => { gate.hidden = true; }).catch(() => { gate.hidden = true; });
      if (canFs && !isPaused) {
        showGate('⛶', 'Ujian berjalan dalam layar penuh', 'Selama ujian, jangan keluar dari layar penuh, berpindah aplikasi, atau menekan tombol kembali. Setiap pelanggaran dicatat dan terlihat oleh pengawas.', ['Masuk layar penuh & mulai', enterFs]);
      }
      document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement || submitting) return;
        report('fullscreen_exit');
        showGate('!', 'Anda keluar dari layar penuh', 'Ini tercatat sebagai pelanggaran. Kembali ke layar penuh untuk melanjutkan ujian.', ['Kembali ke layar penuh', enterFs]);
        document.getElementById('gateIc').style.cssText = 'background:#FEE2E2;color:#B91C1C';
      });
      // Tombol kembali (HP/peramban): tahan di halaman ujian dan beri peringatan.
      history.pushState({ exam: 1 }, '', location.href);
      window.addEventListener('popstate', () => {
        if (submitting) return;
        history.pushState({ exam: 1 }, '', location.href);
        showGate('!', 'Tombol kembali dinonaktifkan', 'Anda sedang mengerjakan ujian. Selesaikan dulu lewat tombol Selesai di soal terakhir.',
          ['Lanjutkan ujian', () => canFs && !document.fullscreenElement ? enterFs() : (gate.hidden = true)]);
        document.getElementById('gateIc').style.cssText = 'background:#FEF3C7;color:#B45309';
      });
      window.addEventListener('beforeunload', (e) => { if (!submitting) { e.preventDefault(); e.returnValue = ''; } });

      document.addEventListener('visibilitychange', () => { if (document.hidden) report('visibility_hidden'); });
      window.addEventListener('blur', () => report('tab_blur'));
      document.addEventListener('contextmenu', (e) => { e.preventDefault(); report('contextmenu'); });
      document.addEventListener('copy', () => report('copy'));
      document.addEventListener('paste', (e) => { e.preventDefault(); report('paste'); });
    </script>
  `));
});

// Tandai / lepas "ragu-ragu" pada satu soal.
student.post("/s/take/:sid/flag", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | { question_id: string; flagged: boolean };
  if (!body?.question_id || typeof body.flagged !== "boolean") return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, (tx) =>
    tx`insert into answers (session_id, question_id, school_id, flagged, updated_at)
       select ${sessionId}, ${body.question_id}, ${stu.sid}, ${body.flagged}, now()
       where exists (select 1 from exam_sessions
                     where id = ${sessionId} and student_id = ${stu.uid} and status = 'active')
       on conflict (session_id, question_id) do update set flagged = excluded.flagged`,
  );
  return c.json({ ok: true });
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
      select es.id, es.status, es.violation_count, es.lock_count, e.anticheat_level, e.lock_after_violations
      from exam_sessions es join exams e on e.id = es.exam_id
      where es.id = ${sessionId} and es.student_id = ${stu.uid}`;
    if (sess.length === 0) throw new Error("sesi tidak ditemukan");
    const row = sess[0] as { id: string; status: string; violation_count: number; lock_count: number;
      anticheat_level: "log"|"warn"|"lock"; lock_after_violations: number | null };

    await tx`insert into violations (school_id, session_id, kind)
             values (${stu.sid}, ${sessionId}, ${kind})`;
    const nextCount = row.violation_count + 1;
    const limit = row.lock_after_violations || 3; // kosong di ujian lama → bawaan 3
    // "Peringatan" dan "Kunci" sama-sama mengunci setelah batas tercapai; "Catat saja" tidak.
    const shouldLock = row.anticheat_level !== "log" && limit > 0 && nextCount >= limit && row.status === "active";
    // Sudah pernah dikunci lalu dibuka pengawas → batas tercapai lagi = dikumpulkan otomatis.
    if (shouldLock && row.lock_count >= 1) {
      await tx`update exam_sessions set violation_count = ${nextCount}, lock_count = lock_count + 1 where id = ${sessionId}`;
      await finalizeSession(tx, sessionId, "submitted");
      return { ok: true, count: nextCount, locked: false, submitted: true, level: row.anticheat_level };
    }
    if (shouldLock) {
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      await tx`update exam_sessions set violation_count = ${nextCount}, status = 'locked', unlock_code = ${code}, unlock_tries = 0, lock_count = lock_count + 1
               where id = ${sessionId}`;
    } else {
      await tx`update exam_sessions set violation_count = ${nextCount}
               where id = ${sessionId}`;
    }
    return { ok: true, count: nextCount, locked: shouldLock, level: row.anticheat_level, locks: row.lock_count };
  });
  return c.json(out);
});

// Siswa memasukkan kode buka dari pengawas. Benar → lanjut, pelanggaran mulai dari 0.
student.post("/s/take/:sid/unlock", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | { code: string };
  const code = String(body?.code ?? "").replace(/\D/g, "");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const out = await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, async (tx) => {
    const r = await tx`select status, unlock_code, unlock_tries from exam_sessions where id = ${sessionId} and student_id = ${stu.uid}`;
    const row = r[0] as { status: string; unlock_code: string | null; unlock_tries: number } | undefined;
    if (!row || row.status !== "locked") return { error: "Sesi tidak sedang terkunci.", status: 400 as const };
    if (row.unlock_tries >= 5) return { error: "Terlalu banyak percobaan. Minta pengawas membuka dari layar pantau.", status: 429 as const };
    if (!row.unlock_code || code !== row.unlock_code) {
      await tx`update exam_sessions set unlock_tries = unlock_tries + 1 where id = ${sessionId}`;
      return { error: "Kode salah. Tanyakan kode yang benar ke pengawas.", status: 400 as const };
    }
    await tx`update exam_sessions set status = 'active', violation_count = 0, unlock_code = null, unlock_tries = 0
             where id = ${sessionId}`;
    return { ok: true };
  });
  if ("error" in out) return c.json({ error: out.error }, out.status);
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
