// Portal siswa: login dengan username + PIN + kode sekolah; kerjakan ujian.
// Cookie sesi siswa terpisah (cbt_sstu) agar tidak campur dengan sesi staf.

import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { verifyPin } from "./hash";
import {
  cookieHeader, clearCookie, readCookie, sign, verify, Session,
} from "./session";
import { sendEmail, pinNotifyEmail } from "./email";

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
<meta name="theme-color" content="#2563eb">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css" crossorigin="anonymous">
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js" crossorigin="anonymous" onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]})"></script>
<script>(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<style>
  :root { color-scheme: light dark; --fg:#111; --mut:#555; --bg:#fafafa; --card:#fff; --bd:#e5e5e5; --accent:#2563eb; --danger:#b91c1c; --ok:#16a34a; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg:#eee; --mut:#aaa; --bg:#0b0b0c; --card:#17181b; --bd:#2a2b30; } }
  :root[data-theme="dark"] { --fg:#eee; --mut:#aaa; --bg:#0b0b0c; --card:#17181b; --bd:#2a2b30; color-scheme: dark; }
  :root[data-theme="light"] { color-scheme: light; }
  * { box-sizing: border-box; } body { margin:0; font:15px/1.5 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width: 720px; margin: 32px auto; padding: 0 16px; }
  .card { background:var(--card); border:1px solid var(--bd); border-radius:12px; padding:20px; margin-bottom:14px; }
  h1 { font-size: 22px; margin: 0 0 6px; } h2 { font-size: 16px; margin: 0 0 10px; }
  p.sub { color:var(--mut); margin: 0 0 14px; }
  label { display:block; font-size:13px; color:var(--mut); margin:12px 0 4px; }
  input, select { width:100%; padding:10px 12px; border:1px solid var(--bd); border-radius:8px; background:var(--bg); color:var(--fg); font: inherit; }
  button, .btn { display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border-radius:8px; border:1px solid var(--bd); background:var(--card); color:var(--fg); font:inherit; cursor:pointer; text-decoration:none; }
  button.primary, .btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; align-items:center; }
  .muted { color:var(--mut); font-size:13px; }
  .err { color:var(--danger); font-size:13px; margin-top:8px; }
  .q { padding: 14px; border:1px solid var(--bd); border-radius:10px; margin-bottom: 12px; background: var(--card); }
  .q.active { outline: 2px solid var(--accent); outline-offset: 1px; }
  .opt { display:flex; gap:10px; align-items:flex-start; padding:8px; border-radius:6px; cursor:pointer; }
  .opt:hover { background: var(--bg); }
  .opt input { margin-top:4px; }
  .nav { display:flex; gap:6px; flex-wrap:wrap; margin:10px 0; }
  .nav button { padding:6px 10px; min-width: 36px; border-radius: 6px; }
  .nav button.ans { background: var(--ok); color:#fff; border-color: var(--ok); }
  .nav button.cur { outline: 2px solid var(--accent); outline-offset:1px; }
  .timer { font-variant-numeric: tabular-nums; font-weight:600; color: var(--fg); background: var(--bg); border:1px solid var(--bd); border-radius: 6px; padding: 4px 10px; }
  .timer.warn { color: var(--danger); border-color: var(--danger); }
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
      </div>
    </div>
    <div class="card">
      <h2>Ujian tersedia</h2>
      <table style="width:100%; border-collapse:collapse">
        <tbody>${list}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Riwayat skor</h2>
      <p class="muted"><a href="/s/history">Lihat semua ujian yang pernah saya kerjakan →</a></p>
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
      <p class="sub"><a href="/s">← Portal</a></p>
    </div>
    <div class="card">
      <table style="width:100%; border-collapse:collapse">
        <thead><tr><th>Ujian</th><th>Status</th><th>Nilai</th><th>Mulai</th><th></th></tr></thead>
        <tbody>${list}</tbody>
      </table>
    </div>
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
      <a class="btn" href="/s/history">← Riwayat</a></div>`));
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
      <p class="sub">Nilai akhir: <b>${data.final ?? "-"}</b> · <a href="/s/history">← Riwayat</a></p>
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
  const body = await c.req.json().catch(() => null) as null | { code: string; username: string; pin: string };
  if (!body?.code || !body?.username || !body?.pin) return c.json({ error: "data kurang" }, 400);

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  // resolve_school adalah SECURITY DEFINER → tidak butuh konteks RLS.
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
// pin_resets. Guru/admin menyetujui lewat dashboard → PIN 6-digit baru
// ditampilkan sekali untuk disampaikan ke siswa.
student.post("/s/forgot", async (c) => {
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
      select e.id, e.duration_minutes, e.starts_at, e.ends_at from exams e
      join exam_classes ec on ec.exam_id = e.id
      where e.id = ${examId} and e.status = 'open'
        and ec.class_id = (select class_id from students where id = ${stu.uid})
        and (e.starts_at is null or e.starts_at <= now())
        and (e.ends_at   is null or e.ends_at   >  now())`;
    if (ok.length === 0) throw new Error("ujian belum/sudah tidak tersedia");
    const dur = (ok[0] as { duration_minutes: number; ends_at: string | null }).duration_minutes;
    const endsAt = (ok[0] as { ends_at: string | null }).ends_at;

    const existing = await tx`select id, status from exam_sessions where exam_id = ${examId} and student_id = ${stu.uid}`;
    if (existing.length) {
      const row = existing[0] as { id: string; status: string };
      if (row.status === "submitted") throw new Error("sudah dikumpulkan");
      return row.id;
    }
    // Urutan soal + (opsional) permutasi opsi, disimpan di question_order:
    //   { order: [qid, …], perms: { qid: [i₀, i₁, …] } }
    // perm memetakan posisi tampilan → indeks asli (shuffle_options).
    const qs = await tx`select question_id from exam_questions where exam_id = ${examId} order by position`;
    let order = (qs as unknown as Array<{ question_id: string }>).map((x) => x.question_id);
    const ex = await tx`select shuffle_questions, shuffle_options, questions_per_session from exams where id = ${examId}`;
    const exRow = ex[0] as { shuffle_questions: boolean; shuffle_options: boolean; questions_per_session: number };
    const fy = <T>(arr: T[]): T[] => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    // Random pool: ambil N soal acak terlebih dulu, lalu shuffle urutan bila perlu.
    const perSession = exRow?.questions_per_session ?? 0;
    if (perSession > 0 && perSession < order.length) {
      order = fy(order).slice(0, perSession);
    }
    if (exRow?.shuffle_questions) order = fy(order);
    const perms: Record<string, number[]> = {};
    if (exRow?.shuffle_options) {
      const qrows = await tx`select id, type, content from questions where id in ${tx(order)}`;
      for (const q of qrows as unknown as Array<{ id: string; type: string; content: { options?: string[] } }>) {
        if (q.type === "pg" && Array.isArray(q.content.options) && q.content.options.length > 1) {
          perms[q.id] = fy(q.content.options.map((_, k) => k));
        }
      }
    }
    const questionOrderPayload = { order, perms };
    // Deadline = min(now + duration, exam.ends_at jika ada).
    const durMs = Date.now() + dur * 60_000;
    const examEnd = endsAt ? new Date(endsAt).getTime() : Number.POSITIVE_INFINITY;
    const deadline = new Date(Math.min(durMs, examEnd)).toISOString();
    const ins = await tx`insert into exam_sessions
      (school_id, exam_id, student_id, deadline_at, question_order)
      values (${stu.sid}, ${examId}, ${stu.uid}, ${deadline},
              ${questionOrderPayload as unknown as string})
      returning id`;
    return (ins[0] as { id: string }).id;
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
             es.violation_count, e.title, e.anticheat_level, e.lock_after_violations
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
    // Jawaban sebelumnya. Jika soal pakai perm, remap index asli → index tampilan.
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
  });
  return c.html(page(data.title!, `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div><h1 style="margin:0">${esc(data.title!)}</h1></div>
        <div><span class="timer" id="t">--:--</span> <span id="qbadge" class="muted" style="font-size:11px"></span></div>
      </div>
    </div>
    <div class="card">
      <div class="nav" id="nav"></div>
      <div id="qbox"></div>
      <div class="row">
        <button id="prev">← Sebelumnya</button>
        <button id="next">Berikutnya →</button>
        <span style="flex:1"></span>
        <button class="primary" id="submit">Kumpulkan</button>
      </div>
      <p class="muted" style="margin-top:12px">Jawaban tersimpan otomatis saat Anda memilih opsi.</p>
    </div>
    <script id="data" type="application/json">${payload.replace(/</g, "\\u003c")}</script>
    <script>
      const D = JSON.parse(document.getElementById('data').textContent);
      const Q = D.questions; const A = D.answers || {}; let i = 0;
      let violations = D.violations || 0; const limit = D.limit || 0; const level = D.anticheat || 'log';
      const nav = document.getElementById('nav'); const qbox = document.getElementById('qbox');
      function escapeHtml(s) { return (s||'').replace(/[&<>\"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]); }
      // Markdown ringan: **bold**, *italic*, \`code\`, newline → <br>.
      // Math $...$ dan $$...$$ dilewati, lalu dirender ulang oleh KaTeX.
      function mdRender(s) {
        let t = escapeHtml(s);
        t = t.replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>');
        t = t.replace(/\\*([^*]+)\\*/g, '<i>$1</i>');
        t = t.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
        t = t.replace(/\\n/g, '<br>');
        return t;
      }
      function katex(el) {
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
        if (q.type === 'pg' || q.type === 'benar_salah') {
          q.content.options.forEach((o, k) => {
            const checked = A[q.id] && A[q.id].index === k ? 'checked' : '';
            const row = document.createElement('label'); row.className = 'opt';
            const label = q.type === 'benar_salah' ? o : String.fromCharCode(65+k) + '. ' + o;
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
            row.innerHTML = '<input type="checkbox" value="'+k+'" '+checked+'><span>' + String.fromCharCode(65+k) + '. ' + escapeHtml(o) + '</span>';
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
        qbox.appendChild(el);
        katex(el);
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
        b.textContent = n ? ('📶 ' + n + ' jawaban menunggu kirim') : '';
      }
      async function save(qid, payload) {
        A[qid] = Object.assign({}, A[qid] || {}, payload); render();
        const q = Q.find((x) => x.id === qid);
        let outPayload = Object.assign({ question_id: qid }, payload);
        if (q && q.perm && typeof payload.index === 'number') outPayload.index = q.perm[payload.index];
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
      const dl = new Date(D.deadline).getTime();
      const t = document.getElementById('t');
      function tick() {
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
      // Heartbeat 15 dtk untuk live monitoring guru.
      async function heartbeat() {
        try { await fetch('/s/take/' + D.sessionId + '/ping', { method:'POST', credentials:'same-origin' }); } catch(_) {}
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
//   {question_id, index}        → pg / benar_salah
//   {question_id, text}         → isian / uraian
student.post("/s/take/:sid/answer", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | {
    question_id: string; index?: number; text?: string;
    selected?: number[]; pairs?: [number, number][];
  };
  if (!body?.question_id) return c.json({ error: "bad body" }, 400);
  const ans: Record<string, unknown> = {};
  if (typeof body.index === "number") ans.index = body.index;
  if (typeof body.text === "string") ans.text = body.text;
  if (Array.isArray(body.selected)) ans.selected = body.selected.filter((n) => Number.isInteger(n));
  if (Array.isArray(body.pairs)) ans.pairs = body.pairs.filter((p) => Array.isArray(p) && p.length === 2);
  if (Object.keys(ans).length === 0) return c.json({ error: "jawaban kosong" }, 400);

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, (tx) =>
    tx`insert into answers (session_id, question_id, school_id, answer, updated_at)
       select ${sessionId}, ${body.question_id}, ${stu.sid},
              ${ans as unknown as string}, now()
       where exists (select 1 from exam_sessions
                     where id = ${sessionId} and student_id = ${stu.uid} and status = 'active'
                       and deadline_at > now())
       on conflict (session_id, question_id)
       do update set answer = coalesce(answers.answer, '{}'::jsonb) || ${ans as unknown as string},
                     updated_at = now()`,
  );
  return c.json({ ok: true });
});

// Heartbeat: klien ping tiap 15 detik, server update last_seen_at supaya
// guru bisa melihat siapa yang online di /app/exams/:id/live.
student.post("/s/take/:sid/ping", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, (tx) =>
    tx`update exam_sessions set last_seen_at = now()
       where id = ${sessionId} and student_id = ${stu.uid}`,
  );
  return c.json({ ok: true });
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
    // Hitung auto-score hanya untuk soal yang masuk sesi ini (dukung pool
    // random). Uraian 0 dulu, menunggu nilai manual dari guru.
    const scored = await tx`
      select coalesce(sum(
        case q.type
          when 'pg'          then case when (k.answer_key->>'index')::int = (a.answer->>'index')::int then q.points else 0 end
          when 'benar_salah' then case when (k.answer_key->>'index')::int = (a.answer->>'index')::int then q.points else 0 end
          when 'isian'       then case when exists(
                                    select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                                    where lower(trim(x.value)) = lower(trim(a.answer->>'text'))
                                  ) then q.points else 0 end
          when 'pgk_centang' then greatest(0::numeric, (
            (select count(*) from jsonb_array_elements_text(k.answer_key->'correct') kx
               where kx::int in (select x::int from jsonb_array_elements_text(coalesce(a.answer->'selected','[]'::jsonb)) x))
            -
            (select count(*) from jsonb_array_elements_text(coalesce(a.answer->'selected','[]'::jsonb)) ax
               where ax::int not in (select x::int from jsonb_array_elements_text(k.answer_key->'correct') x))
          )::numeric / nullif(jsonb_array_length(k.answer_key->'correct'), 0) * q.points)
          when 'menjodohkan' then case when a.answer->'pairs' = k.answer_key->'pairs' then q.points else 0 end
          else 0 end), 0) as got_auto,
             coalesce(sum(q.points), 0) as total,
             coalesce(sum(case when q.type = 'uraian' then q.points else 0 end), 0) as manual_pending
      from jsonb_array_elements_text(coalesce(
        (select case
                  when jsonb_typeof(question_order) = 'object' then question_order->'order'
                  when jsonb_typeof(question_order) = 'array'  then question_order
                  else null end
         from exam_sessions where id = ${sessionId}),
        (select to_jsonb(array_agg(question_id)) from exam_questions where exam_id = ${row.exam_id})
      )) as qid
      join questions q on q.id = qid.value::uuid
      left join question_keys k on k.question_id = q.id
      left join answers a on a.session_id = ${sessionId} and a.question_id = q.id`;
    const sc = scored[0] as { got_auto: string; total: string; manual_pending: string };
    const total = parseFloat(sc.total); const gotAuto = parseFloat(sc.got_auto);
    const manualPending = parseFloat(sc.manual_pending);
    const auto = total > 0 ? (gotAuto / total) * 100 : 0;
    // Final sementara = auto; akan ditimpa guru untuk uraian.
    await tx`update exam_sessions set status = 'submitted', finished_at = now() where id = ${sessionId}`;
    await tx`insert into scores (session_id, school_id, exam_id, student_id, auto_score, final_score)
             values (${sessionId}, ${stu.sid}, ${row.exam_id}, ${stu.uid}, ${auto}, ${auto})
             on conflict (session_id) do update set auto_score = excluded.auto_score,
                final_score = coalesce(scores.manual_score, excluded.auto_score)`;
    return { ok: true, score: auto, needs_manual: manualPending > 0 };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  return c.json(result);
});
