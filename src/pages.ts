// Halaman HTML sederhana untuk demo: landing, form daftar sekolah, dashboard.
// Semua inline (tanpa aset eksternal) agar Worker tetap satu file deploy.

import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { requireStaff, AuthBindings } from "./auth";

export const pages = new Hono<{ Bindings: AuthBindings & { APP_ENV: string } }>();

const base = (title: string, body: string) => `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · cbtgas</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --mut:#555; --bg:#fafafa; --card:#fff; --bd:#e5e5e5; --accent:#2563eb; --danger:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#eee; --mut:#aaa; --bg:#0b0b0c; --card:#17181b; --bd:#2a2b30; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width: 560px; margin: 48px auto; padding: 0 20px; }
  .card { background:var(--card); border:1px solid var(--bd); border-radius:12px; padding:24px; margin-bottom:16px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  p.sub { color:var(--mut); margin: 0 0 16px; }
  label { display:block; font-size:13px; color:var(--mut); margin-top:12px; margin-bottom:4px; }
  input, select { width:100%; padding:10px 12px; border:1px solid var(--bd); border-radius:8px; background:var(--bg); color:var(--fg); font: inherit; }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button, .btn { display:inline-flex; align-items:center; gap:10px; padding:10px 16px; border-radius:8px; border:1px solid var(--bd); background:var(--card); color:var(--fg); font: inherit; cursor:pointer; text-decoration:none; }
  button.primary, .btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  button:hover, .btn:hover { filter: brightness(0.97); }
  .row { display:flex; gap:8px; flex-wrap: wrap; margin-top: 16px; }
  .muted { color:var(--mut); font-size: 13px; }
  table { width:100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align:left; padding:8px 10px; border-bottom: 1px solid var(--bd); font-size: 14px; }
  th { color: var(--mut); font-weight: 500; }
  .err { color: var(--danger); font-size: 13px; margin-top: 10px; }
  .g { width:18px; height:18px; }
  footer { color:var(--mut); font-size:12px; text-align:center; margin-top:24px; }
  code { background: var(--bg); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--bd); font-size: 12px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 12px; }
  button.danger { color: var(--danger); border-color: var(--bd); background: transparent; }
  button.danger:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
  dialog { max-width: 420px; width: 92%; border: 1px solid var(--bd); border-radius: 12px; background: var(--card); color: var(--fg); padding: 20px; }
  dialog::backdrop { background: rgba(0,0,0,.5); }
  main { max-width: 820px; }
  .pill { padding: 2px 8px; border-radius: 999px; font-size: 12px; border:1px solid var(--bd); }
  .pill.open { background: #16a34a1a; border-color:#16a34a; color:#16a34a; }
  .pill.closed { background: #ef44441a; border-color:#ef4444; color:#ef4444; }
  .pill.draft { background: var(--bg); }
  .pill.scheduled { background: #eab3081a; border-color:#eab308; color:#854d0e; }
  .pick { max-height: 320px; overflow:auto; border:1px solid var(--bd); border-radius:8px; padding:8px; margin:12px 0; }
  .qpick { display:flex; gap:10px; padding:6px 4px; border-bottom: 1px solid var(--bd); align-items:flex-start; }
  .qpick:last-child { border-bottom: none; }
  .qpick input { margin-top: 3px; flex:0 0 auto; }
  .optrow { display:flex; gap:8px; align-items:center; margin: 6px 0; }
  .optrow input[type=text], .optrow input:not([type]) { flex:1; }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
</head>
<body>
<main>
${body}
<footer>cbtgas · demo multi-sekolah, Cloudflare + Neon</footer>
</main>
</body>
</html>`;

const googleBtn = (mode: "login" | "register", label: string) => `
<a class="btn primary" href="/auth/google/start?mode=${mode}">
  <svg class="g" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.9 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.5l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.1 36 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>
  ${label}
</a>`;

pages.get("/", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (sess) {
    return c.redirect("/app");
  }
  return c.html(base("Masuk / Daftar", `
    <div class="card">
      <h1>Selamat datang di cbtgas</h1>
      <p class="sub">Platform CBT multi-sekolah untuk SD, SMP, dan SMA.</p>
      <div class="row">
        ${googleBtn("login", "Masuk dengan Google")}
        ${googleBtn("register", "Daftarkan sekolah baru")}
      </div>
      <p class="muted" style="margin-top:16px">
        Masuk pakai email Google admin/guru yang sudah diundang di sekolah,
        atau daftarkan sekolah baru — email login otomatis jadi admin pertama.
      </p>
    </div>
    <div class="card">
      <h2>Lihat data demo</h2>
      <p class="muted">Sekolah <code>demo-sma</code> sudah di-seed dengan 3 siswa.</p>
      <div class="row">
        <a class="btn" href="/demo">Buka daftar siswa (read-only)</a>
        <a class="btn" href="/s/login">Masuk sebagai siswa</a>
        ${c.env.APP_ENV !== "production" ? `
          <form method="post" action="/auth/dev-login" style="margin:0">
            <button class="primary" type="submit">Masuk sebagai admin demo</button>
          </form>` : ""}
      </div>
    </div>
  `));
});

pages.get("/register", (c) => {
  // Butuh cookie pending_registration (diset oleh /auth/google/callback mode=register).
  const hasPending = (c.req.header("Cookie") ?? "").includes("pending_registration=");
  const notice = hasPending ? "" : `
    <p class="err">Belum ada sesi pendaftaran. Mulai dari tombol
    <b>Daftarkan sekolah baru</b> di halaman utama.</p>`;
  return c.html(base("Daftar sekolah", `
    <div class="card">
      <h1>Daftar sekolah baru</h1>
      <p class="sub">Email Google Anda akan menjadi admin pertama sekolah ini.</p>
      ${notice}
      <form id="f" ${hasPending ? "" : "style=\"opacity:.5;pointer-events:none\""}>
        <label>Kode sekolah <span class="muted">(huruf kecil, angka, strip; 3–32 karakter)</span></label>
        <input name="code" required pattern="[a-z0-9\\-]{3,32}" placeholder="contoh: sma-nusa-1">
        <label>Nama sekolah</label>
        <input name="name" required placeholder="SMA Nusantara 1">
        <label>Jenjang</label>
        <select name="level" required>
          <option value="SD">SD</option>
          <option value="SMP">SMP</option>
          <option value="SMA" selected>SMA</option>
          <option value="CAMPURAN">Campuran (SD-SMA)</option>
        </select>
        <label>NPSN <span class="muted">(opsional)</span></label>
        <input name="npsn" placeholder="12345678">
        <label>Nama operator</label>
        <input name="operator_name" required placeholder="Pak/Bu ...">
        <label>No. HP operator</label>
        <input name="operator_phone" required placeholder="08...">
        <div class="row">
          <button class="primary" type="submit">Daftar sekolah</button>
          <a class="btn" href="/">Batal</a>
        </div>
        <p class="err" id="err" hidden></p>
      </form>
    </div>
    <script>
      const f = document.getElementById('f'), err = document.getElementById('err');
      f?.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        const d = Object.fromEntries(new FormData(f));
        const r = await fetch('/auth/register-school', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(d), credentials: 'same-origin',
        });
        if (r.ok) { location.href = '/app'; return; }
        const j = await r.json().catch(() => ({ error: 'gagal' }));
        err.textContent = j.error || ('HTTP ' + r.status);
        err.hidden = false;
      });
    </script>
  `));
});

pages.get("/app", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.redirect("/");

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [school, classes, students] = await withTenant(
    sql,
    { schoolId: sess.sid, role: sess.role, userId: sess.uid },
    async (tx) => {
      const s = await tx`select name, code, level from schools where id = ${sess.sid}`;
      const cl = await tx`select id, name, grade, year from classes order by year desc, grade nulls last, name`;
      const st = await tx`
        select s.id, s.name, s.username, s.gender, s.nisn, s.class_id, c.name as class_name
        from students s left join classes c on c.id = s.class_id
        order by s.name limit 500`;
      return [s[0] as { name: string; code: string; level: string } | undefined, cl, st] as const;
    },
  );

  type Cls = { id: string; name: string; grade: number | null; year: string };
  type Stu = { id: string; name: string; username: string; gender: "L"|"P"|null; nisn: string|null; class_id: string|null; class_name: string|null };
  const classList = classes as unknown as Cls[];
  const studentList = students as unknown as Stu[];

  const classOpts = classList
    .map((cl) => `<option value="${esc(cl.id)}">${esc(cl.name)}${cl.grade?` (${cl.grade})`:""} · ${esc(cl.year)}</option>`)
    .join("");

  const classRows = classList
    .map((cl) => `<tr>
      <td>${esc(cl.name)}</td><td>${cl.grade ?? ""}</td><td>${esc(cl.year)}</td>
      <td style="text-align:right"><button class="danger" data-del-class="${esc(cl.id)}">Hapus</button></td>
    </tr>`).join("") || `<tr><td colspan="4" class="muted">Belum ada kelas.</td></tr>`;

  const studentRows = studentList.map((s) => `<tr data-sid="${esc(s.id)}">
      <td>${esc(s.name)}</td>
      <td>${esc(s.username)}</td>
      <td>${esc(s.class_name ?? "-")}</td>
      <td>${s.gender ?? ""}</td>
      <td>${esc(s.nisn ?? "")}</td>
      <td style="text-align:right; white-space:nowrap">
        <button data-edit-student='${esc(JSON.stringify(s))}'>Edit</button>
        <button class="danger" data-del-student="${esc(s.id)}">Hapus</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="6" class="muted">Belum ada siswa.</td></tr>`;

  return c.html(base("Dashboard", `
    <div class="card">
      <h1>${esc(school?.name ?? "Sekolah")} <span class="muted" style="font-weight:normal">· ${esc(school?.level ?? "")}</span></h1>
      <p class="sub">Masuk sebagai <b>${esc(sess.email)}</b> (${esc(sess.role)}) · kode <code>${esc(school?.code ?? "")}</code></p>
      <div class="row">
        <form method="post" action="/auth/logout" style="margin:0">
          <button type="submit">Keluar</button>
        </form>
      </div>
    </div>

    <div class="card">
      <h2>Kelas</h2>
      <form id="fcls" class="inline">
        <div class="grid">
          <div><label>Nama kelas</label><input name="name" required placeholder="X-IPA-1"></div>
          <div><label>Tingkat</label><input name="grade" type="number" min="1" max="12" placeholder="10"></div>
          <div><label>Tahun ajar</label><input name="year" required placeholder="2025/2026"></div>
        </div>
        <div class="row"><button class="primary" type="submit">Tambah kelas</button></div>
        <p class="err" id="errcls" hidden></p>
      </form>
      <table>
        <thead><tr><th>Nama</th><th>Tingkat</th><th>Tahun</th><th></th></tr></thead>
        <tbody id="tbcls">${classRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Siswa</h2>
      <form id="fstu" class="inline">
        <div class="grid">
          <div><label>Nama lengkap</label><input name="name" required placeholder="Andi Saputra"></div>
          <div><label>Username</label><input name="username" required placeholder="andi.saputra"></div>
          <div>
            <label>Kelas</label>
            <select name="class_id"><option value="">— tidak dipilih —</option>${classOpts}</select>
          </div>
          <div>
            <label>Gender</label>
            <select name="gender"><option value="">—</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>
          </div>
          <div><label>NISN</label><input name="nisn" placeholder="opsional"></div>
          <div><label>PIN awal <span class="muted">(4–8 digit)</span></label><input name="pin" required pattern="\\d{4,8}" placeholder="123456"></div>
        </div>
        <div class="row">
          <button class="primary" type="submit">Tambah siswa</button>
          <button type="button" id="btnImport">Import CSV</button>
          <input type="file" id="fileCsv" accept=".csv,text/csv" hidden>
          <a class="btn" href="/app/exams">Kelola ujian</a>
        </div>
        <p class="muted" style="margin-top:8px">
          Format CSV: header <code>name,username,class,gender,nisn,pin</code> — kolom
          <code>class</code>/<code>gender</code>/<code>nisn</code> opsional. <code>pin</code> 4–8 digit.
        </p>
        <p class="err" id="errstu" hidden></p>
      </form>
      <table>
        <thead><tr><th>Nama</th><th>Username</th><th>Kelas</th><th>G</th><th>NISN</th><th></th></tr></thead>
        <tbody id="tbstu">${studentRows}</tbody>
      </table>
    </div>

    <!-- Dialog edit siswa -->
    <dialog id="dlg">
      <form id="fedit" method="dialog">
        <h2>Edit siswa</h2>
        <input type="hidden" name="id">
        <label>Nama</label><input name="name" required>
        <label>Kelas</label>
        <select name="class_id"><option value="">— tidak dipilih —</option>${classOpts}</select>
        <label>Gender</label>
        <select name="gender"><option value="">—</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>
        <label>NISN</label><input name="nisn">
        <label>PIN baru <span class="muted">(kosongkan jika tidak diganti)</span></label>
        <input name="pin" pattern="\\d{4,8}">
        <div class="row">
          <button class="primary" value="save">Simpan</button>
          <button value="cancel">Batal</button>
        </div>
        <p class="err" id="erredit" hidden></p>
      </form>
    </dialog>

    <script>
      const $ = (q, r=document) => r.querySelector(q);
      const dlg = $('#dlg'), fedit = $('#fedit'), erredit = $('#erredit');

      async function send(url, method, body) {
        const r = await fetch(url, {
          method, credentials: 'same-origin',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (r.ok) return r.status === 204 ? null : r.json();
        const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
        throw new Error(j.error || 'HTTP ' + r.status);
      }

      $('#fcls').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#errcls'); err.hidden = true;
        const d = Object.fromEntries(new FormData(e.target));
        if (d.grade === '') d.grade = null; else d.grade = +d.grade;
        try { await send('/api/classes', 'POST', d); location.reload(); }
        catch (x) { err.textContent = x.message; err.hidden = false; }
      });

      $('#tbcls').addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-del-class'); if (!id) return;
        if (!confirm('Hapus kelas ini? Siswa yang terdaftar akan jadi tidak berkelas.')) return;
        try { await send('/api/classes/' + id, 'DELETE'); location.reload(); }
        catch (x) { alert(x.message); }
      });

      $('#fstu').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#errstu'); err.hidden = true;
        const d = Object.fromEntries(new FormData(e.target));
        for (const k of ['class_id','gender','nisn']) if (d[k] === '') d[k] = null;
        try { await send('/api/students', 'POST', d); location.reload(); }
        catch (x) { err.textContent = x.message; err.hidden = false; }
      });

      $('#tbstu').addEventListener('click', async (e) => {
        const delId = e.target.getAttribute('data-del-student');
        if (delId) {
          if (!confirm('Hapus siswa ini?')) return;
          try { await send('/api/students/' + delId, 'DELETE'); location.reload(); }
          catch (x) { alert(x.message); }
          return;
        }
        const editJson = e.target.getAttribute('data-edit-student');
        if (editJson) {
          const s = JSON.parse(editJson);
          erredit.hidden = true;
          fedit.id.value = s.id; fedit.name.value = s.name;
          fedit.class_id.value = s.class_id || ''; fedit.gender.value = s.gender || '';
          fedit.nisn.value = s.nisn || ''; fedit.pin.value = '';
          dlg.showModal();
        }
      });

      $('#btnImport').addEventListener('click', () => $('#fileCsv').click());
      $('#fileCsv').addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const text = await file.text();
        const r = await fetch('/api/students/import', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'text/csv' }, body: text,
        });
        const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
        if (!r.ok) { alert('Import gagal: ' + (j.error || r.status)); return; }
        let msg = j.ok + ' siswa diimport.';
        if (j.fail && j.fail.length) {
          msg += '\\n' + j.fail.length + ' baris gagal:\\n' +
            j.fail.slice(0, 10).map((x) => '  baris ' + x.row + ': ' + x.error).join('\\n');
        }
        alert(msg); location.reload();
      });

      fedit.addEventListener('submit', async (e) => {
        if (fedit.returnValue === 'cancel') return;
        e.preventDefault();
        erredit.hidden = true;
        const d = Object.fromEntries(new FormData(fedit));
        const id = d.id; delete d.id;
        for (const k of ['class_id','gender','nisn']) if (d[k] === '') d[k] = null;
        if (!d.pin) delete d.pin;
        try { await send('/api/students/' + id, 'PATCH', d); dlg.close(); location.reload(); }
        catch (x) { erredit.textContent = x.message; erredit.hidden = false; }
      });
    </script>
  `));
});

// ===== Pengelolaan ujian =====

pages.get("/app/exams", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const exams = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select e.id, e.title, e.kind, e.duration_minutes, e.status,
              (select count(*) from exam_questions where exam_id = e.id) as qc,
              (select count(*) from exam_classes where exam_id = e.id) as cc
       from exams e order by e.created_at desc`,
  );
  type Ex = { id: string; title: string; kind: string; duration_minutes: number; status: string; qc: number; cc: number };
  const list = (exams as unknown as Ex[]).map((e) => `<tr>
    <td><a href="/app/exams/${esc(e.id)}">${esc(e.title)}</a></td>
    <td>${esc(e.kind)}</td>
    <td>${e.duration_minutes} mnt</td>
    <td>${e.qc} soal</td>
    <td>${e.cc} kelas</td>
    <td><span class="pill ${esc(e.status)}">${esc(e.status)}</span></td>
  </tr>`).join("") || `<tr><td colspan="6" class="muted">Belum ada ujian.</td></tr>`;

  return c.html(base("Ujian", `
    <div class="card">
      <h1>Ujian</h1>
      <p class="sub"><a href="/app">← Dashboard</a> · <a href="/app/questions">Bank soal</a></p>
      <form id="fex">
        <div class="grid">
          <div><label>Judul</label><input name="title" required></div>
          <div><label>Jenis</label>
            <select name="kind"><option value="harian">Harian</option><option value="pts_pas">PTS/PAS</option><option value="sumatif">Sumatif</option><option value="tryout">Tryout</option></select>
          </div>
          <div><label>Durasi (menit)</label><input name="duration_minutes" type="number" min="5" value="60" required></div>
        </div>
        <div class="row"><button class="primary" type="submit">Buat ujian</button></div>
        <p class="err" id="errex" hidden></p>
      </form>
    </div>
    <div class="card">
      <h2>Daftar ujian</h2>
      <table>
        <thead><tr><th>Judul</th><th>Jenis</th><th>Durasi</th><th>Soal</th><th>Kelas</th><th>Status</th></tr></thead>
        <tbody>${list}</tbody>
      </table>
    </div>
    <script>
      document.getElementById('fex').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('errex'); err.hidden = true;
        const d = Object.fromEntries(new FormData(e.target));
        d.duration_minutes = +d.duration_minutes;
        const r = await fetch('/api/exams', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { location.href = '/app/exams/' + j.id; return; }
        err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false;
      });
    </script>
  `));
});

pages.get("/app/exams/:id", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.redirect("/");
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const ex = await tx`select id, title, kind, duration_minutes, status from exams where id = ${examId}`;
    if (ex.length === 0) return null;
    const bank = await tx`select id, content from questions where type = 'pg' order by created_at desc limit 500`;
    const picked = await tx`select question_id from exam_questions where exam_id = ${examId}`;
    const classes = await tx`select id, name from classes order by year desc, name`;
    const pickedClasses = await tx`select class_id from exam_classes where exam_id = ${examId}`;
    const scores = await tx`
      select st.name as student_name, es.status, sc.auto_score, sc.final_score
      from exam_sessions es join students st on st.id = es.student_id
      left join scores sc on sc.session_id = es.id
      where es.exam_id = ${examId} order by st.name`;
    return { ex: ex[0], bank, picked, classes, pickedClasses, scores };
  });
  if (!data) return c.notFound();

  type Ex = { id: string; title: string; kind: string; duration_minutes: number; status: string };
  type Q = { id: string; content: { text: string; options: string[] } };
  type Cls = { id: string; name: string };
  const ex = data.ex as unknown as Ex;
  const bank = data.bank as unknown as Q[];
  const pickedSet = new Set((data.picked as unknown as Array<{ question_id: string }>).map((x) => x.question_id));
  const classes = data.classes as unknown as Cls[];
  const pickedClsSet = new Set((data.pickedClasses as unknown as Array<{ class_id: string }>).map((x) => x.class_id));
  const scores = data.scores as unknown as Array<{ student_name: string; status: string; auto_score: string | null; final_score: string | null }>;

  const bankHtml = bank.map((q) => `<label class="qpick">
    <input type="checkbox" name="qid" value="${esc(q.id)}" ${pickedSet.has(q.id) ? "checked" : ""}>
    <span>${esc(q.content?.text ?? "(tanpa teks)").slice(0, 160)}</span>
  </label>`).join("") || `<p class="muted">Bank soal kosong — tambahkan di <a href="/app/questions">bank soal</a>.</p>`;

  const classHtml = classes.map((cl) => `<label class="qpick">
    <input type="checkbox" name="cid" value="${esc(cl.id)}" ${pickedClsSet.has(cl.id) ? "checked" : ""}>
    <span>${esc(cl.name)}</span>
  </label>`).join("") || `<p class="muted">Belum ada kelas.</p>`;

  const scoreRows = scores.map((r) => `<tr>
    <td>${esc(r.student_name)}</td>
    <td>${esc(r.status)}</td>
    <td>${r.auto_score ?? "-"}</td>
    <td>${r.final_score ?? "-"}</td>
  </tr>`).join("") || `<tr><td colspan="4" class="muted">Belum ada peserta.</td></tr>`;

  return c.html(base(ex.title, `
    <div class="card">
      <h1>${esc(ex.title)} <span class="muted" style="font-weight:normal">· ${esc(ex.kind)} · ${ex.duration_minutes} mnt</span></h1>
      <p class="sub"><a href="/app/exams">← Daftar ujian</a></p>
      <div class="row">
        Status: <span class="pill ${esc(ex.status)}">${esc(ex.status)}</span>
        <button data-status="open" ${ex.status === "open" ? "disabled" : ""}>Buka</button>
        <button data-status="closed" ${ex.status === "closed" ? "disabled" : ""}>Tutup</button>
        <button data-status="draft" ${ex.status === "draft" ? "disabled" : ""}>Jadi draft</button>
      </div>
    </div>

    <div class="card">
      <h2>Soal</h2>
      <form id="fq">
        <div class="pick">${bankHtml}</div>
        <div class="row"><button class="primary" type="submit">Simpan soal yang dipilih</button>
          <a class="btn" href="/app/questions">Kelola bank soal</a></div>
      </form>
    </div>

    <div class="card">
      <h2>Kelas peserta</h2>
      <form id="fc">
        <div class="pick">${classHtml}</div>
        <div class="row"><button class="primary" type="submit">Simpan kelas</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Skor</h2>
      <table>
        <thead><tr><th>Siswa</th><th>Status</th><th>Auto</th><th>Final</th></tr></thead>
        <tbody>${scoreRows}</tbody>
      </table>
    </div>

    <script>
      const EID = ${JSON.stringify(examId)};
      document.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
        const status = b.dataset.status;
        const r = await fetch('/api/exams/' + EID, { method: 'PATCH', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
        if (r.ok) location.reload(); else alert('Gagal: ' + r.status);
      }));
      document.getElementById('fq').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ids = [...e.target.querySelectorAll('input[name=qid]:checked')].map((x) => x.value);
        const r = await fetch('/api/exams/' + EID + '/questions', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question_ids: ids }) });
        if (r.ok) alert('Tersimpan: ' + ids.length + ' soal'); else alert('Gagal: ' + r.status);
      });
      document.getElementById('fc').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ids = [...e.target.querySelectorAll('input[name=cid]:checked')].map((x) => x.value);
        const r = await fetch('/api/exams/' + EID + '/classes', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ class_ids: ids }) });
        if (r.ok) alert('Tersimpan: ' + ids.length + ' kelas'); else alert('Gagal: ' + r.status);
      });
    </script>
  `));
});

pages.get("/app/questions", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const qs = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select q.id, q.content, q.points, k.answer_key
       from questions q left join question_keys k on k.question_id = q.id
       where q.type = 'pg' order by q.created_at desc`,
  );
  type Q = { id: string; content: { text: string; options: string[] }; points: string; answer_key: { index: number } };
  const list = (qs as unknown as Q[]).map((q) => {
    const opts = q.content.options.map((o, i) =>
      `<li ${i === q.answer_key?.index ? "style=font-weight:600" : ""}>${esc(o)}</li>`).join("");
    return `<tr>
      <td>${esc(q.content.text)}<br><ol type="A" style="margin:4px 0 0 20px; color:var(--mut); font-size:13px">${opts}</ol></td>
      <td>${q.points}</td>
      <td style="text-align:right"><button class="danger" data-del="${esc(q.id)}">Hapus</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="muted">Bank soal kosong.</td></tr>`;
  return c.html(base("Bank soal", `
    <div class="card">
      <h1>Bank soal (pilihan ganda)</h1>
      <p class="sub"><a href="/app/exams">← Ujian</a></p>
      <form id="fq">
        <label>Teks soal</label>
        <textarea name="text" required rows="3" style="width:100%; padding:10px; border:1px solid var(--bd); border-radius:8px; background:var(--bg); color:var(--fg); font:inherit"></textarea>
        <div id="opts">
          <label>Pilihan (centang jawaban benar)</label>
          <div class="optrow"><input type="radio" name="correct" value="0" required><input name="opt" required placeholder="Pilihan A"></div>
          <div class="optrow"><input type="radio" name="correct" value="1"><input name="opt" required placeholder="Pilihan B"></div>
          <div class="optrow"><input type="radio" name="correct" value="2"><input name="opt" placeholder="Pilihan C (opsional)"></div>
          <div class="optrow"><input type="radio" name="correct" value="3"><input name="opt" placeholder="Pilihan D (opsional)"></div>
        </div>
        <label>Poin</label>
        <input name="points" type="number" step="0.5" min="0.5" value="1" required>
        <div class="row"><button class="primary" type="submit">Tambah soal</button></div>
        <p class="err" id="errq" hidden></p>
      </form>
    </div>
    <div class="card">
      <h2>Daftar</h2>
      <table><thead><tr><th>Soal</th><th>Poin</th><th></th></tr></thead>
        <tbody id="tb">${list}</tbody></table>
    </div>
    <script>
      document.getElementById('tb').addEventListener('click', async (e) => {
        const id = e.target.dataset.del; if (!id) return;
        if (!confirm('Hapus soal ini?')) return;
        const r = await fetch('/api/questions/' + id, { method: 'DELETE', credentials: 'same-origin' });
        if (r.ok) location.reload(); else alert('Gagal: ' + r.status);
      });
      document.getElementById('fq').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('errq'); err.hidden = true;
        const text = e.target.text.value.trim();
        const opts = [...e.target.querySelectorAll('input[name=opt]')].map((x) => x.value.trim()).filter(Boolean);
        const correctEl = e.target.querySelector('input[name=correct]:checked');
        const points = +e.target.points.value;
        if (!correctEl) { err.textContent = 'Pilih jawaban benar.'; err.hidden = false; return; }
        const correct = +correctEl.value;
        if (correct >= opts.length) { err.textContent = 'Jawaban benar di luar pilihan.'; err.hidden = false; return; }
        const r = await fetch('/api/questions', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, options: opts, correct, points }) });
        if (r.ok) location.reload();
        else { const j = await r.json().catch(() => ({})); err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false; }
      });
    </script>
  `));
});

pages.get("/demo", async (c) => {
  const schoolId = "adee329a-8b27-45ca-a0c2-9e47ea2f45a3";
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [school, students] = await withTenant(
    sql, { schoolId, role: "teacher" },
    async (tx) => {
      const s = await tx`select name, code, level from schools where id = ${schoolId}`;
      const st = await tx`select name, username from students order by name limit 100`;
      return [s[0] as { name: string; code: string; level: string } | undefined, st] as const;
    },
  );
  const rows = (students as unknown as Array<{ name: string; username: string }>)
    .map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.username)}</td></tr>`).join("");
  return c.html(base("Data demo", `
    <div class="card">
      <h1>Data demo</h1>
      <p class="sub">${esc(school?.name ?? "?")} · ${esc(school?.level ?? "")} · kode <code>${esc(school?.code ?? "")}</code></p>
      <table>
        <thead><tr><th>Nama</th><th>Username</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="row"><a class="btn" href="/">Kembali</a></div>
    </div>
  `));
});

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]!));
}
