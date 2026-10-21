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
      <div class="row"><a class="btn" href="/demo">Buka daftar siswa demo</a></div>
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
  const [school, students] = await withTenant(
    sql,
    { schoolId: sess.sid, role: sess.role, userId: sess.uid },
    async (tx) => {
      const s = await tx`select name, code, level from schools where id = ${sess.sid}`;
      const st = await tx`select id, name, username from students order by name limit 100`;
      return [s[0] as { name: string; code: string; level: string } | undefined, st] as const;
    },
  );
  const rows = (students as unknown as Array<{ name: string; username: string }>)
    .map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.username)}</td></tr>`)
    .join("") || `<tr><td colspan="2" class="muted">Belum ada siswa.</td></tr>`;

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
      <h2>Daftar siswa</h2>
      <table>
        <thead><tr><th>Nama</th><th>Username</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
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
