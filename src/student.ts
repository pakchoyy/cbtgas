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
    // Urutan soal; jika exam.shuffle_questions=true, acak per siswa.
    const qs = await tx`select question_id from exam_questions where exam_id = ${examId} order by position`;
    let order = (qs as unknown as Array<{ question_id: string }>).map((x) => x.question_id);
    const sh = await tx`select shuffle_questions from exams where id = ${examId}`;
    if ((sh[0] as { shuffle_questions: boolean })?.shuffle_questions) {
      // Fisher-Yates sederhana (seed waktu — cukup untuk anti-contek baris).
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    // Deadline = min(now + duration, exam.ends_at jika ada).
    const durMs = Date.now() + dur * 60_000;
    const examEnd = endsAt ? new Date(endsAt).getTime() : Number.POSITIVE_INFINITY;
    const deadline = new Date(Math.min(durMs, examEnd)).toISOString();
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
    const order = sess.question_order as unknown as string[];
    // Load pertanyaan sesuai urutan (tanpa answer_key).
    const qs = await tx`select id, type, content from questions where id = any(${order})`;
    const map = new Map<string, { type: string; content: { text: string; options?: string[] } }>();
    for (const q of qs as unknown as Array<{ id: string; type: string; content: { text: string; options?: string[] } }>) {
      map.set(q.id, { type: q.type, content: q.content });
    }
    const questions = order.map((qid, i) => ({ id: qid, pos: i + 1, ...map.get(qid)! }));
    // Jawaban sebelumnya.
    const prev = await tx`select question_id, answer from answers where session_id = ${sessionId}`;
    const answers: Record<string, { index?: number; text?: string }> = {};
    for (const a of prev as unknown as Array<{ question_id: string; answer: { index?: number; text?: string } | null }>) {
      if (a.answer) answers[a.question_id] = a.answer;
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
      const Q = D.questions; const A = D.answers || {}; let i = 0;
      let violations = D.violations || 0; const limit = D.limit || 0; const level = D.anticheat || 'log';
      const nav = document.getElementById('nav'); const qbox = document.getElementById('qbox');
      function escapeHtml(s) { return (s||'').replace(/[&<>\"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]); }
      function hasAnswer(qid) {
        const a = A[qid]; if (!a) return false;
        if (typeof a.index === 'number') return true;
        if (typeof a.text === 'string' && a.text.trim() !== '') return true;
        return false;
      }
      function render() {
        qbox.innerHTML = '';
        const q = Q[i];
        const el = document.createElement('div'); el.className = 'q active';
        const tag = q.type === 'uraian' ? ' <span class="muted">(uraian — dinilai guru)</span>' : '';
        el.innerHTML = '<p><b>Soal ' + (i+1) + ' / ' + Q.length + '</b>' + tag + '</p><p>' + escapeHtml(q.content.text) + '</p>';
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
        }
        qbox.appendChild(el);
        nav.innerHTML = '';
        Q.forEach((qq, k) => {
          const b = document.createElement('button'); b.textContent = k+1;
          if (hasAnswer(qq.id)) b.className = 'ans';
          if (k === i) b.className = (b.className + ' cur').trim();
          b.addEventListener('click', () => { i = k; render(); });
          nav.appendChild(b);
        });
      }
      async function save(qid, payload) {
        A[qid] = Object.assign({}, A[qid] || {}, payload); render();
        await fetch('/s/take/' + D.sessionId + '/answer', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ question_id: qid }, payload)),
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
  };
  if (!body?.question_id) return c.json({ error: "bad body" }, 400);
  const ans: Record<string, unknown> = {};
  if (typeof body.index === "number") ans.index = body.index;
  if (typeof body.text === "string") ans.text = body.text;
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
    // Hitung auto-score untuk tipe pg, benar_salah, isian. Uraian dibiarkan 0
    // dulu, menunggu nilai manual dari guru (merubah scores.final_score lewat
    // /api/sessions/:sid/manual-score).
    const scored = await tx`
      select coalesce(sum(
        case q.type
          when 'pg'          then case when (k.answer_key->>'index')::int = (a.answer->>'index')::int then q.points else 0 end
          when 'benar_salah' then case when (k.answer_key->>'index')::int = (a.answer->>'index')::int then q.points else 0 end
          when 'isian'       then case when exists(
                                    select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                                    where lower(trim(x.value)) = lower(trim(a.answer->>'text'))
                                  ) then q.points else 0 end
          else 0 end), 0) as got_auto,
             coalesce(sum(q.points), 0) as total,
             coalesce(sum(case when q.type = 'uraian' then q.points else 0 end), 0) as manual_pending
      from exam_questions eq
      join questions q on q.id = eq.question_id
      left join question_keys k on k.question_id = q.id
      left join answers a on a.session_id = ${sessionId} and a.question_id = q.id
      where eq.exam_id = ${row.exam_id}`;
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
