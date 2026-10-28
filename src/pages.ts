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
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#2563eb">
<script>
  // Terapkan tema sebelum render agar tidak flash.
  (function(){ try { var t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch(e){} })();
</script>
<style>
  :root { color-scheme: light dark; --fg:#111; --mut:#555; --bg:#fafafa; --card:#fff; --bd:#e5e5e5; --accent:#2563eb; --danger:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --fg:#eee; --mut:#aaa; --bg:#0b0b0c; --card:#17181b; --bd:#2a2b30; }
  }
  :root[data-theme="dark"] { --fg:#eee; --mut:#aaa; --bg:#0b0b0c; --card:#17181b; --bd:#2a2b30; color-scheme: dark; }
  :root[data-theme="light"] { color-scheme: light; }
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
<div id="installCard" class="card" hidden style="position:fixed; bottom:16px; right:16px; max-width:280px; margin:0; box-shadow:0 10px 30px rgba(0,0,0,.2)">
  <p style="margin:0 0 8px"><b>Pasang cbtgas sebagai aplikasi?</b></p>
  <div class="row" style="margin:0"><button class="primary" id="installBtn">Pasang</button><button id="installClose">Nanti</button></div>
</div>
</main>
<script>
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    try { if (localStorage.getItem('install_dismissed')) return; } catch(_) {}
    const card = document.getElementById('installCard'); if (card) card.hidden = false;
  });
  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (!deferred) return; deferred.prompt(); await deferred.userChoice;
    document.getElementById('installCard').hidden = true; deferred = null;
  });
  document.getElementById('installClose')?.addEventListener('click', () => {
    document.getElementById('installCard').hidden = true;
    try { localStorage.setItem('install_dismissed', '1'); } catch(_){}
  });
</script>
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
        ${sess.role === "admin" ? `<a class="btn" href="/app/users">Kelola staf</a>` : ""}
        <button type="button" id="toggleTheme" title="Ganti tema terang/gelap">🌓 Tema</button>
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
          <a class="btn" href="/api/reports/scores.csv">Rekap skor sekolah (CSV)</a>
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
      // Dark mode toggle (3 state cycle: system → light → dark → system).
      $('#toggleTheme')?.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? null : (cur === 'light' ? 'dark' : 'light');
        if (next) { document.documentElement.setAttribute('data-theme', next); localStorage.setItem('theme', next); }
        else { document.documentElement.removeAttribute('data-theme'); localStorage.removeItem('theme'); }
      });

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
          <div><label>Mulai (opsional)</label><input name="starts_at" type="datetime-local"></div>
          <div><label>Berakhir (opsional)</label><input name="ends_at" type="datetime-local"></div>
          <div>
            <label>Anti-cheat</label>
            <select name="anticheat_level">
              <option value="log">Log saja</option>
              <option value="warn" selected>Peringatan</option>
              <option value="lock">Kunci otomatis</option>
            </select>
          </div>
          <div><label>Kunci setelah N pelanggaran</label><input name="lock_after_violations" type="number" min="1" value="3"></div>
          <div><label><input type="checkbox" name="shuffle_questions"> Acak urutan soal</label></div>
          <div><label><input type="checkbox" name="shuffle_options"> Acak urutan pilihan</label></div>
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
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd);
        d.duration_minutes = +d.duration_minutes;
        d.lock_after_violations = d.lock_after_violations ? +d.lock_after_violations : null;
        d.shuffle_questions = fd.has('shuffle_questions');
        d.shuffle_options = fd.has('shuffle_options');
        for (const k of ['starts_at','ends_at']) if (!d[k]) d[k] = null; else d[k] = new Date(d[k]).toISOString();
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
      select es.id as session_id, st.name as student_name, c.name as class_name,
             es.status, es.violation_count, sc.auto_score, sc.manual_score, sc.final_score
      from exam_sessions es
      join students st on st.id = es.student_id
      left join classes c on c.id = st.class_id
      left join scores sc on sc.session_id = es.id
      where es.exam_id = ${examId} order by st.name`;
    const summary = await tx`
      select coalesce(c.name, '(tanpa kelas)') as class_name,
             count(*) as peserta, count(sc.final_score) as nilai_tersedia,
             round(avg(sc.final_score), 2) as rata_rata,
             min(sc.final_score) as terendah, max(sc.final_score) as tertinggi
      from exam_sessions es join students st on st.id = es.student_id
      left join classes c on c.id = st.class_id
      left join scores sc on sc.session_id = es.id
      where es.exam_id = ${examId} group by c.name order by c.name`;
    const needsManual = await tx`
      select count(*)::int as n from exam_questions eq
      join questions q on q.id = eq.question_id
      where eq.exam_id = ${examId} and q.type = 'uraian'`;
    return { ex: ex[0], bank, picked, classes, pickedClasses, scores, summary, needsManual };
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
  const scores = data.scores as unknown as Array<{
    session_id: string; student_name: string; class_name: string | null; status: string;
    violation_count: number; auto_score: string | null; manual_score: string | null; final_score: string | null;
  }>;
  const summary = data.summary as unknown as Array<{
    class_name: string; peserta: string; nilai_tersedia: string;
    rata_rata: string | null; terendah: string | null; tertinggi: string | null;
  }>;
  const needsManual = ((data.needsManual as unknown as Array<{ n: number }>)[0]?.n ?? 0) > 0;

  const bankHtml = bank.map((q) => `<label class="qpick">
    <input type="checkbox" name="qid" value="${esc(q.id)}" ${pickedSet.has(q.id) ? "checked" : ""}>
    <span>${esc(q.content?.text ?? "(tanpa teks)").slice(0, 160)}</span>
  </label>`).join("") || `<p class="muted">Bank soal kosong — tambahkan di <a href="/app/questions">bank soal</a>.</p>`;

  const classHtml = classes.map((cl) => `<label class="qpick">
    <input type="checkbox" name="cid" value="${esc(cl.id)}" ${pickedClsSet.has(cl.id) ? "checked" : ""}>
    <span>${esc(cl.name)}</span>
  </label>`).join("") || `<p class="muted">Belum ada kelas.</p>`;

  const scoreRows = scores.map((r) => {
    const manualBtn = needsManual && r.status === "submitted"
      ? ` · <a href="/app/sessions/${esc(r.session_id)}/grade">nilai uraian</a>`
      : "";
    const unlockBtn = r.status === "locked"
      ? ` · <a href="#" data-unlock="${esc(r.session_id)}">buka kembali</a>` : "";
    return `<tr>
      <td>${esc(r.student_name)}</td>
      <td>${esc(r.class_name ?? "-")}</td>
      <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span>${r.violation_count ? ` · ${r.violation_count} pelanggaran` : ""}${unlockBtn}</td>
      <td>${r.auto_score ?? "-"}</td>
      <td>${r.manual_score ?? "-"}</td>
      <td><b>${r.final_score ?? "-"}</b>${manualBtn}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">Belum ada peserta.</td></tr>`;

  const summaryRows = summary.map((r) => `<tr>
    <td>${esc(r.class_name)}</td><td>${r.peserta}</td><td>${r.nilai_tersedia}</td>
    <td>${r.rata_rata ?? "-"}</td><td>${r.terendah ?? "-"}</td><td>${r.tertinggi ?? "-"}</td>
  </tr>`).join("") || `<tr><td colspan="6" class="muted">Belum ada data.</td></tr>`;

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
      <h2>Ringkasan per kelas</h2>
      <table>
        <thead><tr><th>Kelas</th><th>Peserta</th><th>Nilai ada</th><th>Rata-rata</th><th>Min</th><th>Maks</th></tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Skor peserta</h2>
      <div class="row" style="margin-bottom:8px">
        <a class="btn" href="/api/exams/${esc(examId)}/scores.csv">Download CSV</a>
      </div>
      <table>
        <thead><tr><th>Siswa</th><th>Kelas</th><th>Status</th><th>Auto</th><th>Manual</th><th>Final</th></tr></thead>
        <tbody>${scoreRows}</tbody>
      </table>
    </div>

    <script>
      const EID = ${JSON.stringify(examId)};
      document.body.addEventListener('click', async (e) => {
        const sid = e.target && e.target.getAttribute && e.target.getAttribute('data-unlock');
        if (!sid) return;
        e.preventDefault();
        if (!confirm('Buka kembali sesi ini? Siswa dapat lanjut mengerjakan 15 menit.')) return;
        const r = await fetch('/api/sessions/' + sid + '/unlock', { method: 'POST', credentials: 'same-origin' });
        if (r.ok) location.reload(); else { const j = await r.json().catch(() => ({})); alert(j.error || 'HTTP ' + r.status); }
      });
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

pages.get("/app/users", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.redirect("/");
  if (sess.role !== "admin") return c.html(base("Staf", `<div class="card"><p class="err">Hanya admin yang boleh melihat halaman ini.</p><a class="btn" href="/app">← Dashboard</a></div>`));
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const users = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select id, email, name, role, active, google_sub is not null as linked
       from users order by email`,
  );
  type U = { id: string; email: string; name: string | null; role: string; active: boolean; linked: boolean };
  const list = (users as unknown as U[]).map((u) => {
    const isSelf = u.id === sess.uid;
    const linkBadge = u.linked ? `<span class="pill" style="background:#16a34a1a;border-color:#16a34a;color:#16a34a">Google</span>` : `<span class="pill muted">belum login</span>`;
    const activeBadge = u.active ? "" : `<span class="pill" style="background:#ef44441a;border-color:#ef4444;color:#ef4444">nonaktif</span>`;
    return `<tr data-uid="${esc(u.id)}">
      <td>${esc(u.email)} ${linkBadge} ${activeBadge}${isSelf ? ` <span class="muted">(Anda)</span>` : ""}</td>
      <td>
        <select data-field="role" ${isSelf ? "disabled" : ""}>
          ${["admin","teacher","proctor"].map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </td>
      <td style="text-align:right; white-space:nowrap">
        ${isSelf ? "" : `
          <button data-action="toggle">${u.active ? "Nonaktifkan" : "Aktifkan"}</button>
          <button class="danger" data-action="delete">Hapus</button>`}
      </td>
    </tr>`;
  }).join("");
  return c.html(base("Staf sekolah", `
    <div class="card">
      <h1>Staf sekolah</h1>
      <p class="sub"><a href="/app">← Dashboard</a></p>
      <form id="finv">
        <div class="grid">
          <div><label>Email staf</label><input name="email" type="email" required placeholder="guru@sekolah.id"></div>
          <div><label>Nama (opsional)</label><input name="name" placeholder="Bu Rina"></div>
          <div><label>Role</label>
            <select name="role">
              <option value="teacher">Guru</option>
              <option value="admin">Admin</option>
              <option value="proctor">Pengawas (hanya baca)</option>
            </select>
          </div>
        </div>
        <div class="row"><button class="primary" type="submit">Undang</button></div>
        <p class="muted" style="margin-top:8px">Staf masuk lewat <a href="/">tombol "Masuk dengan Google"</a> memakai email yang Anda undang di sini.</p>
        <p class="err" id="errinv" hidden></p>
      </form>
    </div>
    <div class="card">
      <h2>Daftar staf</h2>
      <table><thead><tr><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody id="tb">${list || `<tr><td colspan="3" class="muted">Belum ada staf.</td></tr>`}</tbody>
      </table>
    </div>
    <script>
      document.getElementById('finv').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('errinv'); err.hidden = true;
        const d = Object.fromEntries(new FormData(e.target));
        const r = await fetch('/api/users', { method:'POST', credentials:'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
        if (r.ok) location.reload();
        else { const j = await r.json().catch(() => ({})); err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false; }
      });
      document.getElementById('tb').addEventListener('click', async (e) => {
        const tr = e.target.closest('tr'); if (!tr) return;
        const uid = tr.dataset.uid;
        const action = e.target.dataset.action;
        if (action === 'delete') {
          if (!confirm('Hapus staf ini?')) return;
          const r = await fetch('/api/users/' + uid, { method:'DELETE', credentials:'same-origin' });
          if (r.ok) location.reload(); else { const j = await r.json().catch(() => ({})); alert(j.error || r.status); }
          return;
        }
        if (action === 'toggle') {
          const active = e.target.textContent === 'Aktifkan';
          const r = await fetch('/api/users/' + uid, { method:'PATCH', credentials:'same-origin',
            headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ active }) });
          if (r.ok) location.reload(); else { const j = await r.json().catch(() => ({})); alert(j.error || r.status); }
        }
      });
      document.getElementById('tb').addEventListener('change', async (e) => {
        const sel = e.target; if (sel.dataset.field !== 'role') return;
        const tr = sel.closest('tr'); const uid = tr.dataset.uid;
        const r = await fetch('/api/users/' + uid, { method:'PATCH', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ role: sel.value }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || r.status); location.reload(); }
      });
    </script>
  `));
});

pages.get("/app/categories", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const cats = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select c.id, c.name,
              (select count(*) from questions q where q.category_id = c.id) as qc
       from categories c order by c.name`,
  );
  type C = { id: string; name: string; qc: string };
  const list = (cats as unknown as C[]).map((cl) => `<tr>
    <td>${esc(cl.name)}</td><td>${cl.qc}</td>
    <td style="text-align:right"><button class="danger" data-del="${esc(cl.id)}">Hapus</button></td>
  </tr>`).join("") || `<tr><td colspan="3" class="muted">Belum ada kategori.</td></tr>`;
  return c.html(base("Kategori soal", `
    <div class="card">
      <h1>Kategori soal</h1>
      <p class="sub"><a href="/app/questions">← Bank soal</a></p>
      <form id="fc">
        <label>Nama kategori</label>
        <input name="name" required placeholder="Matematika / Bahasa Indonesia / ...">
        <div class="row"><button class="primary" type="submit">Tambah</button></div>
        <p class="err" id="err" hidden></p>
      </form>
    </div>
    <div class="card">
      <table><thead><tr><th>Nama</th><th>Soal</th><th></th></tr></thead>
        <tbody id="tb">${list}</tbody></table>
    </div>
    <script>
      document.getElementById('fc').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('err'); err.hidden = true;
        const d = Object.fromEntries(new FormData(e.target));
        const r = await fetch('/api/categories', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
        if (r.ok) location.reload();
        else { const j = await r.json().catch(() => ({})); err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false; }
      });
      document.getElementById('tb').addEventListener('click', async (e) => {
        const id = e.target.dataset.del; if (!id) return;
        if (!confirm('Hapus kategori? Soal yang pakai kategori ini akan jadi tanpa kategori.')) return;
        const r = await fetch('/api/categories/' + id, { method: 'DELETE', credentials: 'same-origin' });
        if (r.ok) location.reload(); else alert('Gagal: ' + r.status);
      });
    </script>
  `));
});

// Penilaian manual untuk soal uraian dalam satu sesi.
pages.get("/app/sessions/:sid/grade", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.redirect("/");
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const info = await tx`
      select es.id, es.exam_id, e.title, st.name as student_name, c.name as class_name
      from exam_sessions es join exams e on e.id = es.exam_id
      join students st on st.id = es.student_id
      left join classes c on c.id = st.class_id
      where es.id = ${sessionId}`;
    if (info.length === 0) return null;
    const rows = await tx`
      select q.id, q.content, q.points, k.rubric, a.answer
      from exam_questions eq
      join questions q on q.id = eq.question_id
      left join question_keys k on k.question_id = q.id
      left join answers a on a.session_id = ${sessionId} and a.question_id = q.id
      where eq.exam_id = (select exam_id from exam_sessions where id = ${sessionId})
        and q.type = 'uraian' order by eq.position`;
    return { info: info[0], rows };
  });
  if (!data) return c.notFound();
  const info = data.info as { exam_id: string; title: string; student_name: string; class_name: string | null };
  type R = { id: string; content: { text: string }; points: string; rubric: string | null; answer: { text?: string; manual_score?: number } | null };
  const rows = data.rows as unknown as R[];
  const items = rows.map((r) => `
    <div class="card">
      <p class="muted">Soal (${r.points} poin)</p>
      <p>${esc(r.content.text)}</p>
      ${r.rubric ? `<p class="muted"><b>Rubrik:</b> ${esc(r.rubric)}</p>` : ""}
      <p class="muted">Jawaban siswa:</p>
      <blockquote style="margin:4px 0; padding:10px; border-left:3px solid var(--bd); background:var(--bg)">${esc(r.answer?.text ?? "(kosong)")}</blockquote>
      <label>Nilai (0 – ${r.points})</label>
      <input class="score" data-qid="${esc(r.id)}" data-max="${r.points}" type="number" min="0" max="${r.points}" step="0.5" value="${r.answer?.manual_score ?? ""}">
    </div>`).join("");
  return c.html(base("Nilai uraian", `
    <div class="card">
      <h1>Nilai uraian — ${esc(info.student_name)}</h1>
      <p class="sub">Ujian: ${esc(info.title)} · Kelas: ${esc(info.class_name ?? "-")} · <a href="/app/exams/${esc(info.exam_id)}">← Kembali</a></p>
    </div>
    ${items || `<div class="card"><p class="muted">Tidak ada soal uraian di ujian ini.</p></div>`}
    <div class="card">
      <div class="row">
        <button class="primary" id="save">Simpan nilai</button>
      </div>
      <p class="err" id="err" hidden></p>
    </div>
    <script>
      document.getElementById('save').addEventListener('click', async () => {
        const err = document.getElementById('err'); err.hidden = true;
        const inputs = [...document.querySelectorAll('input.score')];
        const scores = [];
        for (const i of inputs) {
          const v = i.value.trim(); if (v === '') continue;
          const n = +v, max = +i.dataset.max;
          if (!(n >= 0 && n <= max)) { err.textContent = 'Nilai di luar jangkauan (0–'+max+').'; err.hidden = false; return; }
          scores.push({ question_id: i.dataset.qid, score: n });
        }
        const r = await fetch('/api/sessions/${esc(sessionId)}/manual-score', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scores }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { alert('Tersimpan. Nilai akhir: ' + (j.final ?? '-')); location.href = '/app/exams/${esc(info.exam_id)}'; }
        else { err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false; }
      });
    </script>
  `));
});

pages.get("/app/questions", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const catFilter = c.req.query("category") ?? "";
  const [qs, cats] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const qsRows = catFilter
      ? await tx`select q.id, q.type, q.content, q.points, q.category_id, k.answer_key, k.rubric,
                        cat.name as category_name
                 from questions q left join question_keys k on k.question_id = q.id
                 left join categories cat on cat.id = q.category_id
                 where q.category_id = ${catFilter}
                 order by q.created_at desc`
      : await tx`select q.id, q.type, q.content, q.points, q.category_id, k.answer_key, k.rubric,
                        cat.name as category_name
                 from questions q left join question_keys k on k.question_id = q.id
                 left join categories cat on cat.id = q.category_id
                 order by q.created_at desc`;
    const catsRows = await tx`select id, name from categories order by name`;
    return [qsRows, catsRows] as const;
  });
  type Q = {
    id: string; type: string; points: string;
    content: { text: string; options?: string[]; image?: string };
    answer_key: { index?: number; accepted?: string[]; manual?: boolean } | null;
    rubric: string | null; category_name: string | null;
  };
  type Cat = { id: string; name: string };
  const catList = cats as unknown as Cat[];
  const catOpts = catList.map((cl) => `<option value="${esc(cl.id)}" ${cl.id === catFilter ? "selected" : ""}>${esc(cl.name)}</option>`).join("");
  const catOptsForm = catList.map((cl) => `<option value="${esc(cl.id)}">${esc(cl.name)}</option>`).join("");
  const typeLabel: Record<string, string> = { pg: "Pil. ganda", benar_salah: "Benar/Salah", isian: "Isian", uraian: "Uraian" };
  const list = (qs as unknown as Q[]).map((q) => {
    let keyInfo = "";
    if (q.type === "pg" && q.content.options) {
      keyInfo = `<ol type="A" style="margin:4px 0 0 20px; color:var(--mut); font-size:13px">` +
        q.content.options.map((o, i) =>
          `<li ${i === q.answer_key?.index ? "style=font-weight:600" : ""}>${esc(o)}</li>`).join("") + `</ol>`;
    } else if (q.type === "benar_salah") {
      keyInfo = `<span class="muted" style="font-size:13px">Jawaban: ${q.answer_key?.index === 0 ? "Benar" : "Salah"}</span>`;
    } else if (q.type === "isian") {
      keyInfo = `<span class="muted" style="font-size:13px">Jawaban diterima: ${esc((q.answer_key?.accepted ?? []).join(" | "))}</span>`;
    } else if (q.type === "uraian") {
      keyInfo = `<span class="muted" style="font-size:13px">Rubrik: ${esc(q.rubric ?? "(—)")}</span>`;
    }
    const catTag = q.category_name ? `<span class="pill" style="background:#2563eb1a;border-color:#2563eb;color:#2563eb">${esc(q.category_name)}</span> ` : "";
    const img = q.content.image ? ` 🖼` : "";
    return `<tr>
      <td>${catTag}<span class="pill">${esc(typeLabel[q.type] ?? q.type)}</span> ${esc(q.content.text)}${img}<br>${keyInfo}</td>
      <td>${q.points}</td>
      <td style="text-align:right"><button class="danger" data-del="${esc(q.id)}">Hapus</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="muted">Bank soal kosong.</td></tr>`;
  return c.html(base("Bank soal", `
    <div class="card">
      <h1>Bank soal</h1>
      <p class="sub"><a href="/app/exams">← Ujian</a> · <a href="/app/categories">Kategori</a></p>
      <form id="fq">
        <label>Kategori <span class="muted">(opsional, kelola di /app/categories)</span></label>
        <select name="category_id"><option value="">— tanpa kategori —</option>${catOptsForm}</select>
        <label>Tipe soal</label>
        <select name="type" id="qtype">
          <option value="pg">Pilihan ganda</option>
          <option value="benar_salah">Benar / Salah</option>
          <option value="isian">Isian singkat</option>
          <option value="uraian">Uraian (dinilai guru)</option>
        </select>
        <label>Teks soal</label>
        <textarea name="text" required rows="3" style="width:100%; padding:10px; border:1px solid var(--bd); border-radius:8px; background:var(--bg); color:var(--fg); font:inherit"></textarea>

        <div id="box_pg">
          <label>Pilihan (centang jawaban benar)</label>
          <div class="optrow"><input type="radio" name="correct" value="0"><input name="opt" placeholder="Pilihan A"></div>
          <div class="optrow"><input type="radio" name="correct" value="1"><input name="opt" placeholder="Pilihan B"></div>
          <div class="optrow"><input type="radio" name="correct" value="2"><input name="opt" placeholder="Pilihan C (opsional)"></div>
          <div class="optrow"><input type="radio" name="correct" value="3"><input name="opt" placeholder="Pilihan D (opsional)"></div>
        </div>
        <div id="box_bs" hidden>
          <label>Jawaban benar</label>
          <select name="bs_correct"><option value="true">Benar</option><option value="false">Salah</option></select>
        </div>
        <div id="box_isian" hidden>
          <label>Jawaban yang diterima <span class="muted">(pisah dengan baris baru; case-insensitive)</span></label>
          <textarea name="accepted" rows="3" style="width:100%; padding:10px; border:1px solid var(--bd); border-radius:8px; background:var(--bg); color:var(--fg); font:inherit" placeholder="Contoh:&#10;jakarta&#10;dki jakarta"></textarea>
        </div>
        <div id="box_uraian" hidden>
          <label>Rubrik <span class="muted">(opsional, dilihat guru saat menilai)</span></label>
          <textarea name="rubric" rows="3" style="width:100%; padding:10px; border:1px solid var(--bd); border-radius:8px; background:var(--bg); color:var(--fg); font:inherit"></textarea>
        </div>

        <label>Gambar <span class="muted">(opsional, max 400 KB; JPG/PNG/WebP)</span></label>
        <input type="file" id="imgFile" accept="image/*">
        <div id="imgPrev" style="margin:8px 0"></div>

        <label>Poin</label>
        <input name="points" type="number" step="0.5" min="0.5" value="1" required>
        <div class="row">
          <button class="primary" type="submit">Tambah soal</button>
          <button type="button" id="btnImportQ">Import CSV</button>
          <input type="file" id="fileCsvQ" accept=".csv,text/csv" hidden>
        </div>
        <p class="muted" style="margin-top:8px">
          CSV: header <code>type,text,options,correct,accepted,rubric,points,category</code>.
          Pisah pilihan/jawaban dengan <code>|</code>. Tipe: pg, benar_salah, isian, uraian.
        </p>
        <p class="err" id="errq" hidden></p>
      </form>
    </div>
    <div class="card">
      <h2>Daftar</h2>
      <div class="row" style="margin-bottom:8px">
        <select id="filterCat" style="max-width:260px">
          <option value="">Semua kategori</option>
          ${catOpts}
        </select>
      </div>
      <table><thead><tr><th>Soal</th><th>Poin</th><th></th></tr></thead>
        <tbody id="tb">${list}</tbody></table>
    </div>
    <script>
      const $$ = (q) => document.querySelector(q);
      function showBox() {
        const t = $$('#qtype').value;
        for (const name of ['pg','bs','isian','uraian']) $$('#box_'+name).hidden = (name !== (t==='benar_salah'?'bs':t));
      }
      $$('#qtype').addEventListener('change', showBox); showBox();
      document.getElementById('tb').addEventListener('click', async (e) => {
        const id = e.target.dataset.del; if (!id) return;
        if (!confirm('Hapus soal ini?')) return;
        const r = await fetch('/api/questions/' + id, { method: 'DELETE', credentials: 'same-origin' });
        if (r.ok) location.reload(); else alert('Gagal: ' + r.status);
      });
      // Image: convert ke data URI, preview, simpan di state.
      let imageData = null;
      $$('#imgFile').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) { imageData = null; $$('#imgPrev').innerHTML = ''; return; }
        if (f.size > 400_000) { alert('Gambar > 400 KB; kompres dulu.'); e.target.value = ''; return; }
        const buf = await f.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        imageData = 'data:' + f.type + ';base64,' + b64;
        $$('#imgPrev').innerHTML = '<img src="' + imageData + '" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid var(--bd)">';
      });
      // Filter kategori → navigasi
      $$('#filterCat').addEventListener('change', (e) => {
        const v = e.target.value;
        location.href = '/app/questions' + (v ? '?category=' + v : '');
      });
      // CSV import
      $$('#btnImportQ').addEventListener('click', () => $$('#fileCsvQ').click());
      $$('#fileCsvQ').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const text = await f.text();
        const r = await fetch('/api/questions/import', { method:'POST', credentials:'same-origin',
          headers: { 'Content-Type': 'text/csv' }, body: text });
        const j = await r.json().catch(() => ({ error: 'HTTP '+r.status }));
        if (!r.ok) { alert('Import gagal: ' + (j.error || r.status)); return; }
        let msg = j.ok + ' soal diimport.';
        if (j.fail?.length) msg += '\\n' + j.fail.length + ' gagal:\\n' + j.fail.slice(0,10).map(x => '  baris ' + x.row + ': ' + x.error).join('\\n');
        alert(msg); location.reload();
      });

      document.getElementById('fq').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('errq'); err.hidden = true;
        const text = e.target.text.value.trim();
        const type = $$('#qtype').value;
        const points = +e.target.points.value;
        const category_id = e.target.category_id.value || null;
        const payload = { type, text, points, category_id };
        if (imageData) payload.image = imageData;
        if (type === 'pg') {
          const opts = [...e.target.querySelectorAll('input[name=opt]')].map((x) => x.value.trim()).filter(Boolean);
          const correctEl = e.target.querySelector('input[name=correct]:checked');
          if (!correctEl) { err.textContent = 'Pilih jawaban benar.'; err.hidden = false; return; }
          payload.options = opts; payload.correct = +correctEl.value;
        } else if (type === 'benar_salah') {
          payload.correct = e.target.bs_correct.value === 'true';
        } else if (type === 'isian') {
          payload.accepted = e.target.accepted.value.split(/\\n/).map((s) => s.trim()).filter(Boolean);
          if (!payload.accepted.length) { err.textContent = 'Isi minimal satu jawaban yang diterima.'; err.hidden = false; return; }
        } else if (type === 'uraian') {
          payload.rubric = e.target.rubric.value.trim() || null;
        }
        const r = await fetch('/api/questions', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
