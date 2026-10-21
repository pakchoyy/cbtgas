// Portal siswa: login dengan username + PIN + kode sekolah; kerjakan ujian.
// Cookie sesi siswa terpisah (cbt_sstu) agar tidak campur dengan sesi staf.

import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { verifyPin } from "./hash";
import {
  cookieHeader, clearCookie, readCookie, sign, verify, Session,
} from "./session";

type Bindings = {
  HYPERDRIVE: Hyperdrive;
  SESSION_SECRET: string;
  APP_ORIGIN: string;
  APP_ENV: string;
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
<style>
  :root { color-scheme: light dark; --fg:#111; --mut:#555; --bg:#fafafa; --card:#fff; --bd:#e5e5e5; --accent:#2563eb; --danger:#b91c1c; --ok:#16a34a; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --mut:#aaa; --bg:#0b0b0c; --card:#17181b; --bd:#2a2b30; } }
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
</style></head><body><main>${body}</main></body></html>`;

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
      <div class="row"><button class="primary" type="submit">Masuk</button></div>
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
    // Pastikan ujian open dan menargetkan kelas siswa
    const ok = await tx`
      select e.id, e.duration_minutes from exams e
      join exam_classes ec on ec.exam_id = e.id
      where e.id = ${examId} and e.status = 'open'
        and ec.class_id = (select class_id from students where id = ${stu.uid})`;
    if (ok.length === 0) throw new Error("ujian tidak tersedia untuk Anda");
    const dur = (ok[0] as { duration_minutes: number }).duration_minutes;

    const existing = await tx`select id, status from exam_sessions where exam_id = ${examId} and student_id = ${stu.uid}`;
    if (existing.length) {
      const row = existing[0] as { id: string; status: string };
      if (row.status === "submitted") throw new Error("sudah dikumpulkan");
      return row.id;
    }
    // Buat sesi + urutan soal (optional shuffle; untuk sekarang urutan posisi asli)
    const qs = await tx`select question_id from exam_questions where exam_id = ${examId} order by position`;
    const order = (qs as unknown as Array<{ question_id: string }>).map((x) => x.question_id);
    const deadline = new Date(Date.now() + dur * 60_000).toISOString();
    const ins = await tx`insert into exam_sessions
      (school_id, exam_id, student_id, deadline_at, question_order)
      values (${stu.sid}, ${examId}, ${stu.uid}, ${deadline}, ${order as unknown as string})
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
    const s = await tx`select es.id, es.status, es.deadline_at, es.question_order, e.title
                       from exam_sessions es join exams e on e.id = es.exam_id
                       where es.id = ${sessionId} and es.student_id = ${stu.uid}`;
    if (s.length === 0) return null;
    const sess = s[0] as { id: string; status: string; deadline_at: string; question_order: string[]; title: string };
    if (sess.status === "submitted") return { done: true, title: sess.title };
    const order = sess.question_order as unknown as string[];
    // Load pertanyaan sesuai urutan (tanpa answer_key)
    const qs = await tx`select id, content from questions where id = any(${order})`;
    const map = new Map<string, { text: string; options: string[] }>();
    for (const q of qs as unknown as Array<{ id: string; content: { text: string; options: string[] } }>) {
      map.set(q.id, q.content);
    }
    const questions = order.map((qid, i) => ({ id: qid, pos: i + 1, content: map.get(qid)! }));
    // Jawaban sebelumnya
    const prev = await tx`select question_id, answer from answers where session_id = ${sessionId}`;
    const answers: Record<string, number> = {};
    for (const a of prev as unknown as Array<{ question_id: string; answer: { index: number } | null }>) {
      if (a.answer && typeof a.answer.index === "number") answers[a.question_id] = a.answer.index;
    }
    return { title: sess.title, deadline: sess.deadline_at, questions, answers };
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

  const payload = JSON.stringify({
    sessionId, deadline: data.deadline,
    questions: data.questions, answers: data.answers,
  });
  return c.html(page(data.title!, `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div><h1 style="margin:0">${esc(data.title!)}</h1></div>
        <div><span class="timer" id="t">--:--</span></div>
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
      const Q = D.questions; const A = D.answers; let i = 0;
      const nav = document.getElementById('nav'); const qbox = document.getElementById('qbox');
      function render() {
        qbox.innerHTML = '';
        const q = Q[i];
        const el = document.createElement('div'); el.className = 'q active';
        el.innerHTML = '<p><b>Soal ' + (i+1) + ' / ' + Q.length + '</b></p><p>' + escapeHtml(q.content.text) + '</p>';
        q.content.options.forEach((o, k) => {
          const id = 'o_' + q.id + '_' + k;
          const checked = A[q.id] === k ? 'checked' : '';
          const row = document.createElement('label'); row.className = 'opt';
          row.innerHTML = '<input type="radio" name="'+q.id+'" value="'+k+'" '+checked+' id="'+id+'"><span>' + String.fromCharCode(65+k) + '. ' + escapeHtml(o) + '</span>';
          row.querySelector('input').addEventListener('change', () => save(q.id, k));
          el.appendChild(row);
        });
        qbox.appendChild(el);
        nav.innerHTML = '';
        Q.forEach((qq, k) => {
          const b = document.createElement('button');
          b.textContent = k+1;
          if (A[qq.id] !== undefined) b.className = 'ans';
          if (k === i) b.className = (b.className + ' cur').trim();
          b.addEventListener('click', () => { i = k; render(); });
          nav.appendChild(b);
        });
      }
      function escapeHtml(s) { return (s||'').replace(/[&<>\"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]); }
      async function save(qid, idx) {
        A[qid] = idx; render();
        await fetch('/s/take/' + D.sessionId + '/answer', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_id: qid, index: idx }),
        });
      }
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
        requestAnimationFrame(() => setTimeout(tick, 1000));
      }
      tick(); render();
    </script>
  `));
});

student.post("/s/take/:sid/answer", async (c) => {
  const stu = await requireStudent(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!stu) return c.json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | { question_id: string; index: number };
  if (!body?.question_id || typeof body.index !== "number") return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: stu.sid, role: "student", userId: stu.uid }, (tx) =>
    tx`insert into answers (session_id, question_id, school_id, answer, updated_at)
       select ${sessionId}, ${body.question_id}, ${stu.sid},
              ${{ index: body.index } as unknown as string}, now()
       where exists (select 1 from exam_sessions
                     where id = ${sessionId} and student_id = ${stu.uid} and status = 'active'
                       and deadline_at > now())
       on conflict (session_id, question_id)
       do update set answer = excluded.answer, updated_at = now()`,
  );
  return c.json({ ok: true });
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
    // Hitung auto-score untuk tipe pg
    const scored = await tx`
      select coalesce(sum(case when (k.answer_key->>'index')::int = (a.answer->>'index')::int
                              then q.points else 0 end), 0) as got,
             coalesce(sum(q.points), 0) as total
      from exam_questions eq
      join questions q on q.id = eq.question_id
      left join question_keys k on k.question_id = q.id
      left join answers a on a.session_id = ${sessionId} and a.question_id = q.id
      where eq.exam_id = ${row.exam_id} and q.type = 'pg'`;
    const sc = scored[0] as { got: string; total: string };
    const total = parseFloat(sc.total); const got = parseFloat(sc.got);
    const auto = total > 0 ? (got / total) * 100 : 0;
    await tx`update exam_sessions set status = 'submitted', finished_at = now() where id = ${sessionId}`;
    await tx`insert into scores (session_id, school_id, exam_id, student_id, auto_score, final_score)
             values (${sessionId}, ${stu.sid}, ${row.exam_id}, ${stu.uid}, ${auto}, ${auto})
             on conflict (session_id) do update set auto_score = excluded.auto_score, final_score = excluded.final_score`;
    return { ok: true, score: auto };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  return c.json(result);
});
