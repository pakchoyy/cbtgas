// Halaman HTML sederhana untuk demo: landing, form daftar sekolah, dashboard.
// Semua inline (tanpa aset eksternal) agar Worker tetap satu file deploy.

import { distractorRows, itemRows } from "./analytics";
import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { requireStaff, AuthBindings } from "./auth";
import { SHARED_CSS, LOGO, SITE_FOOTER, INSTALL_SHEET, APP_NAME, BRAND_COLORS, kindLabel, FEEDBACK_WA } from "./ui";

export const pages = new Hono<{ Bindings: AuthBindings & { APP_ENV: string } }>();

// Navigasi staf dikelompokkan per pekerjaan. Grup "Admin" hanya untuk admin;
// halamannya tetap menjaga hak akses sendiri.
// Navigasi staf. "Utama" = yang paling sering dipakai (juga jadi navbar bawah
// di HP); sisanya di "Lainnya". Grup admin hanya untuk admin.
const NAV_GROUPS: Array<{ title: string; admin?: boolean; items: Array<[string, string, string]> }> = [
  { title: "", items: [["/app", "Beranda", "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"], ["/app/exams", "Ujian", "M9 4h6v3H9zM6 6h12v15H6zM9 11h6M9 15h4"], ["/app/questions", "Bank soal", "M5 4h11l3 3v13H5zM9 10h6M9 14h6"], ["/app/students", "Siswa", "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 11a3 3 0 1 0 0-6M22 21v-1a5 5 0 0 0-4-4.9"]] },
  { title: "Lainnya", items: [["/app/pin-resets", "Reset PIN", "M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4"], ["/app/exam-groups", "Rangkaian", "M4 6h16M4 12h16M4 18h10"], ["/app/categories", "Kategori", "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"], ["/app/passages", "Bacaan", "M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-7"]] },
  { title: "Admin", admin: true, items: [["/app/settings", "Pengaturan", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"], ["/app/users", "Staf", "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"], ["/app/restore", "Backup & pulihkan", "M4 12a8 8 0 1 0 3-6.2M4 4v4h4"], ["/app/audit", "Audit log", "M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"], ["/app/bulk", "Operasi massal", "M4 7h16M4 12h16M4 17h16"], ["/app/shared-banks", "Bank publik", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"]] },
];
const icon = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const sidebar = (role: string) => `
<header class="mbar">
  <a class="brand" href="/app">${LOGO}</a>
  <button type="button" class="ghost" id="navOpen" aria-label="Buka menu" aria-controls="side" aria-expanded="false">${icon("M4 7h16M4 12h16M4 17h16")}</button>
</header>
<nav class="bnav" aria-label="Menu cepat">
  ${NAV_GROUPS[0].items.map(([href, label, d]) => `<a href="${href}">${icon(d)}<span>${label}</span></a>`).join("")}
  <button type="button" id="navMore">${icon("M5 12h.01M12 12h.01M19 12h.01")}<span>Lainnya</span></button>
</nav>
<aside class="side" id="side">
  <a class="brand" href="/app" aria-label="CBT Yuk, beranda">${LOGO}</a>
  <nav class="nav" aria-label="Utama">
    ${NAV_GROUPS.filter((g) => !g.admin || role === "admin").map((g, gi) => `<div class="${gi === 0 ? "nav-main" : "nav-g"}">
      ${g.title ? `<p class="nav-h">${g.title}</p>` : ""}
      ${g.items.map(([href, label, d]) => `<a href="${href}">${icon(d)}<span data-i18n-src="${label}">${label}</span></a>`).join("")}
    </div>`).join("")}
  </nav>
  <div class="side-foot">
    <a class="ghost fb" href="${FEEDBACK_WA}" target="_blank" rel="noopener">${icon("M4 5h16v11H8l-4 4zM8 9h8M8 12h5")}<span>Kritik &amp; saran</span></a>
    <button type="button" class="ghost" id="toggleTheme">${icon("M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z")}<span>Tema</span></button>
    <button type="button" class="ghost" id="toggleLang">${icon("M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18")}<span>ID / EN</span></button>
    <form method="post" action="/auth/logout"><button type="submit" class="ghost">${icon("M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10")}<span data-i18n-src="Keluar">Keluar</span></button></form>
  </div>
</aside>
<div class="scrim" id="scrim" hidden></div>`;

const base = (title: string, body: string, opts: { nav?: boolean; role?: string } = {}) => `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ${APP_NAME}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-192.svg">
<meta name="theme-color" content="#F5F7FB">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css" crossorigin="anonymous">
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js" crossorigin="anonymous" onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]})"></script>
<script>
  // Terapkan tema sebelum render agar tidak flash.
  (function(){ try { var t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    var l = localStorage.getItem('lang');
    if (l) document.documentElement.lang = l;
  } catch(e){} })();
  // Translation map untuk UI label dengan atribut data-i18n.
  const I18N = {
    en: {
      'Keluar':'Logout', 'Kelola staf':'Manage staff', 'Audit log':'Audit log',
      'Reset PIN siswa':'Reset student PIN', 'Beranda':'Home', 'Ujian':'Exams',
      'Rangkaian':'Series', 'Bank soal':'Question bank', 'Bacaan':'Passages',
      'Kategori':'Categories', 'Reset PIN':'PIN resets', 'Siswa & kelas':'Students & classes', 'Staf':'Staff', 'Bank publik':'Public banks', 'Operasi massal':'Bulk actions', 'Backup & pulihkan':'Backup & restore',
      'Daftar siswa':'Student list', 'Tambah siswa':'Add student',
      'Tambah kelas':'Add class', 'Kelas':'Classes', 'Siswa':'Students',
      'Download CSV':'Download CSV', 'Live monitoring':'Live monitoring',
      'Mode lab komputer':'Lab mode', 'Analisis butir soal':'Item analysis',
      'Rekap skor sekolah (CSV)':'School score recap (CSV)',
      'Backup JSON':'Backup JSON', 'Restore':'Restore',
      'Kelola ujian':'Manage exams', 'Import CSV':'Import CSV',
    },
  };
  function applyI18n(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n-src]').forEach((el) => {
      const src = el.getAttribute('data-i18n-src');
      el.textContent = (lang === 'en' && I18N.en[src]) || src;
    });
  }
</script>
<style>${SHARED_CSS}
  /* Staf app shell: sidebar kiri, konten kanan */
  body.app { padding-left: 252px; }
  main { max-width: 1060px; margin: 0 auto; padding: 32px 32px 48px; }
  body.public main { max-width: 1040px; padding: 0 20px; }
  .side { position: fixed; inset: 0 auto 0 0; width: 252px; background: var(--surface); border-right: 1px solid var(--line);
          display: flex; flex-direction: column; padding: 18px 14px; z-index: 60; overflow-y: auto; }
  .side .brand { padding: 4px 8px 20px; }
  .nav { display:flex; flex-direction:column; gap:2px; flex:1; }
  .nav-h { margin: 18px 10px 6px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--mut); }
  .nav a, .side-foot .ghost { display:flex; align-items:center; gap:12px; min-height:42px; padding: 8px 10px; border-radius: 10px;
          color: var(--mut); text-decoration:none; font-size:14px; font-weight:600; width:100%; justify-content:flex-start; }
  .nav svg, .side-foot svg, .mbar .ghost svg, .bnav svg { width:19px; height:19px; flex:0 0 auto; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .nav a:hover, .side-foot .ghost:hover { color: var(--fg); background: var(--paper); }
  .nav a[aria-current="page"] { color: var(--brand); background: var(--soft); }
  .side-foot { border-top: 1px solid var(--line); padding-top: 10px; margin-top: 16px; display:flex; flex-direction:column; gap:2px; }
  .side-foot form { margin:0; }
  .side-foot .ghost { border: none; background: transparent; box-shadow:none; }
  .side-foot a.ghost { text-decoration: none; }
  .side-foot .fb { color: #15803D; }
  .mbar, .bnav { display:none; }
  .scrim { position: fixed; inset: 0; background: rgba(15,23,42,.45); z-index: 55; }
  .app-foot { color:var(--mut); font-size:12px; text-align:center; margin-top:40px; }
  .app-foot a { color: var(--mut); }

  /* Kepala halaman + tombol tambah yang membuka formulir */
  .page-head { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; margin: 0 0 20px; }
  .page-head h1 { margin:0; }
  .page-head p { margin: 4px 0 0; color: var(--mut); }
  details.add > summary { list-style:none; display:inline-flex; }
  details.add > summary::-webkit-details-marker { display:none; }
  details.add[open] > summary { display:none; }
  details.add .card { margin-top: 0; }

  /* Panduan langkah awal */
  .steps { list-style:none; margin:0; padding:0; counter-reset: st; }
  .steps li { display:flex; align-items:center; gap:14px; padding: 14px 0; border-top: 1px solid var(--line); }
  .steps li:first-child { border-top: none; }
  .steps .dot { width:30px; height:30px; flex:0 0 auto; border-radius:50%; border: 2px solid var(--line); display:grid; place-items:center; font-weight:800; font-size:13px; color: var(--mut); }
  .steps li.done .dot { background: var(--ok); border-color: var(--ok); color:#fff; }
  .steps li.next .dot { border-color: var(--ink); color: var(--fg); box-shadow: 0 0 0 4px color-mix(in srgb, var(--pencil) 45%, transparent); }
  .steps .txt { flex:1; min-width:0; }
  .steps .txt b { display:block; }
  .steps .txt span { color: var(--mut); font-size: 13px; }
  .steps li.done .txt b { color: var(--mut); text-decoration: line-through; text-decoration-color: var(--line); }
  .progress { height: 8px; border-radius: 99px; background: var(--paper); border: 1px solid var(--line); overflow:hidden; margin-top: 8px; }
  .progress i { display:block; height:100%; background: var(--ok); }
  .live-row { display:flex; align-items:center; gap:12px; padding: 12px 0; border-top: 1px solid var(--line); }
  .live-row:first-of-type { border-top: none; }
  .live-row .txt { flex:1; min-width: 0; }
  .live-dot { width:10px; height:10px; border-radius:50%; background: var(--ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 20%, transparent); flex:0 0 auto; }
  .empty { text-align:center; padding: 28px 12px; color: var(--mut); }
  .two { display:grid; grid-template-columns: 1.15fr 1fr; gap: 16px; align-items:start; }

  @media (max-width: 900px) {
    body.app { padding-left: 0; }
    .mbar { display:flex; align-items:center; gap:6px; position: sticky; top:0; z-index: 40; background: color-mix(in srgb, var(--surface) 88%, transparent);
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); padding: 6px 10px; min-height: 58px; }
    .mbar .ghost { color: var(--fg); background:transparent; border:none; min-width:44px; min-height:44px; padding:0; box-shadow:none; }
    .mbar { justify-content: space-between; }
    .side .nav-main { display: none; }
    .side .nav-g:first-of-type .nav-h { margin-top: 4px; }
    .side { inset: 0 0 0 auto; border-right: none; border-left: 1px solid var(--line); transform: translateX(100%); transition: transform .2s; box-shadow: 0 0 40px rgba(0,0,0,.3); }
    .bnav { display:grid; grid-template-columns: repeat(5, 1fr); position: fixed; left: 0; right: 0; bottom: 0; z-index: 45;
            background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
            border-top: 1px solid var(--line); padding: 6px 4px calc(6px + env(safe-area-inset-bottom)); }
    .bnav a, .bnav button { display:flex; flex-direction:column; align-items:center; justify-content:center; gap: 3px; min-height: 52px; padding: 4px 2px;
            border: none; background: transparent; box-shadow: none; border-radius: 12px; color: var(--mut); font-size: 11.5px; font-weight: 600; text-decoration: none; white-space: nowrap; }
    .bnav svg { width: 22px; height: 22px; }
    .bnav a[aria-current="page"] { color: var(--brand); }
    .bnav a[aria-current="page"] svg { background: var(--soft); border-radius: 999px; padding: 3px 12px; width: 48px; height: 28px; box-sizing: border-box; }
    body.app main { padding-bottom: 96px; }
    body.app .install { bottom: 84px; }
    body.nav-open .side { transform: none; }
    main { padding: 20px 16px 56px; }
    body.public main { padding: 0 16px; }
    .two { grid-template-columns: 1fr; }
  }
</style>
<link rel="stylesheet" href="/brand.css">
</head>
<body class="${opts.nav === false ? "public" : "app"}">
${opts.nav === false ? "" : sidebar(opts.role ?? "")}
<main>
${body}
${opts.nav === false ? "" : `<footer class="app-foot">${APP_NAME} · <a href="/privasi">Privasi</a> · <a href="/syarat">Syarat</a></footer>`}
</main>
${opts.nav === false ? SITE_FOOTER : ""}
${INSTALL_SHEET}
<script>
  // Tandai menu aktif.
  (function () {
    const p = location.pathname;
    let best = null;
    document.querySelectorAll('.nav a, .bnav a').forEach((a) => {
      const h = a.getAttribute('href');
      if (p === h || (h !== '/app' && p.startsWith(h))) { if (!best || h.length > best.getAttribute('href').length) best = a; }
    });
    if (best) document.querySelectorAll('.nav a, .bnav a').forEach((a) => { if (a.getAttribute('href') === best.getAttribute('href')) a.setAttribute('aria-current', 'page'); });
    // Menu laci di HP.
    const openBtn = document.getElementById('navOpen'), scrim = document.getElementById('scrim');
    const setNav = (on) => { document.body.classList.toggle('nav-open', on); if (scrim) scrim.hidden = !on; openBtn?.setAttribute('aria-expanded', String(on)); };
    openBtn?.addEventListener('click', () => setNav(true));
    document.getElementById('navMore')?.addEventListener('click', () => setNav(true));
    scrim?.addEventListener('click', () => setNav(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });
  })();
  // Tema: sistem terang gelap sistem. Bahasa: id ↔ en.
  document.getElementById('toggleTheme')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? null : (cur === 'light' ? 'dark' : 'light');
    try {
      if (next) { document.documentElement.setAttribute('data-theme', next); localStorage.setItem('theme', next); }
      else { document.documentElement.removeAttribute('data-theme'); localStorage.removeItem('theme'); }
    } catch (_) {}
  });
  document.getElementById('toggleLang')?.addEventListener('click', () => {
    let cur = 'id'; try { cur = localStorage.getItem('lang') || 'id'; } catch (_) {}
    const next = cur === 'id' ? 'en' : 'id';
    try { localStorage.setItem('lang', next); } catch (_) {}
    applyI18n(next);
  });
  try { applyI18n(localStorage.getItem('lang') || 'id'); } catch (_) {}
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
</a>`.replace('class="btn primary"', 'class="btn"');

pages.get("/", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (sess) return c.redirect("/app");
  return c.html(base("Ujian sekolah online", `
    <style>
      body.public { background:
        radial-gradient(900px 500px at 85% -10%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 60%),
        radial-gradient(700px 420px at -10% 10%, color-mix(in srgb, #A78BFA 14%, transparent), transparent 60%), var(--paper); }
      .top { display:flex; align-items:center; justify-content:space-between; padding: 20px 0; }
      .top a.small { font-size: 14px; font-weight: 600; color: var(--fg); text-decoration: none; }
      .hero { display:grid; grid-template-columns: 1.05fr .95fr; gap: 48px; align-items:center; padding: 40px 0 56px; }
      .eyebrow { display:inline-flex; gap:8px; align-items:center; font-size: 13px; font-weight: 700; color: var(--brand); background: var(--soft);
                 border: 1px solid color-mix(in srgb, var(--brand) 20%, transparent); padding: 6px 12px; border-radius: 999px; }
      .hero h1 { font-size: clamp(36px, 5.4vw, 58px); line-height: 1.02; letter-spacing: -.04em; margin: 18px 0 16px; }
      .hero h1 em { font-style: normal; color: var(--brand); }
      .hero .lead { font-size: 18px; color: var(--mut); margin: 0 0 30px; max-width: 46ch; }
      .cta { display:grid; gap: 10px; max-width: 420px; }
      .cta .btn { width: 100%; min-height: 54px; font-size: 16px; border-radius: 14px; }
      .cta .btn.ghost { background: transparent; border-color: transparent; box-shadow:none; color: var(--fg); font-weight: 600; }
      .cta .btn.ghost b { color: var(--brand); }
      .stu { margin-top: 18px; font-size: 14px; color: var(--mut); }
      /* Ilustrasi layar ujian */
      .mock { position: relative; }
      .mock .win { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; box-shadow: 0 30px 80px rgba(15,23,42,.14); padding: 18px; }
      .mock .bar { display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px; font-weight: 700; font-size: 14px; }
      .mock .time { background: var(--soft); color: var(--brand); padding: 4px 12px; border-radius: 999px; font-variant-numeric: tabular-nums; }
      .mock .nums { display:flex; gap:6px; margin-bottom: 14px; flex-wrap: wrap; }
      .mock .nums i { width:28px; height:28px; border-radius:50%; border:1.5px solid var(--line); display:grid; place-items:center; font-style:normal; font-size:12px; font-weight:700; }
      .mock .nums i.a { background: var(--brand); border-color: var(--brand); color:#fff; }
      .mock .qt { font-weight: 600; margin: 0 0 12px; }
      .mock .op { display:flex; gap:12px; align-items:center; border:1.5px solid var(--line); border-radius: 12px; padding: 10px 12px; margin: 8px 0; font-size: 14px; }
      .mock .op i { width:26px; height:26px; border-radius:50%; border:2px solid #94A3B8; display:grid; place-items:center; font-style:normal; font-size:12px; font-weight:800; flex:0 0 auto; }
      .mock .op.on { border-color: var(--brand); background: var(--soft); } .mock .op.on i { background: var(--brand); border-color: var(--brand); color:#fff; }
      .mock .chip { position:absolute; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 10px 14px; box-shadow: var(--shadow); font-size: 13px; font-weight: 700; display:flex; gap:8px; align-items:center; }
      .mock { padding: 26px 0; }
      .mock .chip.c1 { left: -18px; bottom: 4px; } .mock .chip.c2 { right: -14px; top: 4px; }
      .dotg { width:9px; height:9px; border-radius:50%; background: var(--ok); }
      .lpop { position: relative; }
      .lpop summary { list-style: none; min-height: 42px; border-radius: 999px; padding: 8px 18px; gap: 8px; }
      .lpop summary::-webkit-details-marker { display:none; }
      .lpop summary svg { width: 18px; height: 18px; fill:none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .lpop-menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 20; width: 270px; background: var(--surface); border: 1px solid var(--line);
                   border-radius: 18px; padding: 8px; box-shadow: 0 20px 50px rgba(15,23,42,.18); }
      .lpop-menu a { display:flex; gap: 12px; align-items:center; padding: 10px; border-radius: 12px; text-decoration: none; color: var(--fg); }
      main .lpop-menu a { color: var(--fg); }
      .lpop-menu a:hover { background: var(--soft); }
      .lpop-menu .li { width: 40px; height: 40px; border-radius: 12px; background: var(--soft); color: var(--brand); display:grid; place-items:center; flex: 0 0 auto; }
      .lpop-menu .li svg { width: 22px; height: 22px; fill:none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .lpop-menu b { display:block; font-size: 15px; } .lpop-menu small { color: var(--mut); font-size: 13px; }
      .login { padding: 0 0 36px; }
      .login h2 { font-size: 20px; margin: 0 0 14px; }
      .roles { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .role { display:grid; grid-template-columns: 52px 1fr; grid-template-rows: auto auto; gap: 4px 14px; align-items:center;
              background: var(--surface); border: 1.5px solid var(--line); border-radius: 18px; padding: 18px 20px; text-decoration: none; color: var(--fg);
              box-shadow: var(--shadow); transition: border-color .15s, transform .15s; }
      main a.role { color: var(--fg); text-decoration: none; }
      .role:hover { border-color: var(--brand); transform: translateY(-1px); }
      .role .ri { grid-row: 1 / 3; width: 52px; height: 52px; border-radius: 14px; background: var(--soft); color: var(--brand); display:grid; place-items:center; }
      .role .ri svg { width: 28px; height: 28px; fill:none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .role .rt { display:flex; flex-direction:column; } .role .rt b { font-size: 16.5px; } .role .rt span { color: var(--mut); font-size: 14px; }
      .role .go { grid-column: 2; display:inline-flex; align-items:center; gap:8px; font-weight: 700; color: var(--brand); font-size: 14.5px; margin-top: 6px; }
      @media (max-width: 720px) { .roles { grid-template-columns: 1fr; } }
      .feats { display:grid; grid-template-columns: repeat(4, 1fr); gap: 14px; padding: 8px 0 24px; }
      .feat { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: var(--shadow); }
      .feat svg { width: 36px; height: 36px; padding: 8px; border-radius: 10px; background: var(--soft); color: var(--brand); fill:none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .feat h3 { margin: 12px 0 4px; font-size: 15px; } .feat p { margin: 0; font-size: 14px; color: var(--mut); }
      @media (max-width: 860px) { .hero { grid-template-columns: 1fr; gap: 36px; padding-top: 16px; } .feats { grid-template-columns: 1fr 1fr; } .mock .chip.c1 { left: 8px; } .mock .chip.c2 { right: 8px; } }
      @media (max-width: 480px) { .feats { grid-template-columns: 1fr; } }
    </style>
    <div class="top"><a class="brand" href="/">${LOGO}</a>
      <details class="lpop">
        <summary class="btn primary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l4 4-4 4M14 12H3"/></svg>Masuk</summary>
        <div class="lpop-menu">
          <a href="/s/login"><span class="li"><svg viewBox="0 0 24 24"><path d="M12 3L2 8l10 5 10-5zM6 10v5c0 2 3 4 6 4s6-2 6-4v-5"/></svg></span><span><b>Siswa</b><small>Username &amp; PIN dari guru</small></span></a>
          <a href="/auth/google/start?mode=login"><span class="li"><svg viewBox="0 0 24 24"><path d="M3 5h18v12H3zM8 21h8M12 17v4"/></svg></span><span><b>Guru / admin</b><small>Pakai akun Google</small></span></a>
        </div>
      </details></div>
    <section class="hero">
      <div>
        <span class="eyebrow">Gratis dicoba · tanpa instal</span>
        <h1>Ujian sekolah jadi <em>gampang</em>.</h1>
        <p class="lead">Buat soal, jadwalkan ujian, awasi siswa secara langsung, dan nilai keluar otomatis. Untuk SD, SMP, dan SMA, lancar di HP maupun komputer lab.</p>
        <div class="cta">
          <a class="btn primary" href="/demo">Coba demo gratis</a>
          <a class="btn" href="/auth/google/start?mode=register">Daftarkan sekolah</a>
        </div>
        <p class="stu">Tidak perlu instal. Demo tanpa daftar, langsung dicoba.</p>
      </div>
      <div class="mock" aria-hidden="true">
        <div class="win">
          <div class="bar"><span>Tryout Matematika</span><span class="time">58:12</span></div>
          <div class="nums"><i class="a">1</i><i class="a">2</i><i class="a">3</i><i>4</i><i>5</i><i>6</i><i>7</i><i>8</i></div>
          <p class="qt">4. Hasil dari 3/4 + 1/2 adalah …</p>
          <div class="op on"><i>A</i>1 1/4</div><div class="op"><i>B</i>1 1/2</div><div class="op"><i>C</i>5/6</div><div class="op"><i>D</i>4/6</div>
        </div>
        <div class="chip c1"><span class="dotg"></span>28 siswa sedang mengerjakan</div>
        <div class="chip c2">Nilai rata-rata 84,5</div>
      </div>
    </section>
    <section class="login" id="masuk" aria-labelledby="masukH">
      <h2 id="masukH">Sudah punya akun? Masuk sesuai peran Anda</h2>
      <div class="roles">
        <a class="role" href="/s/login">
          <span class="ri"><svg viewBox="0 0 24 24"><path d="M12 3L2 8l10 5 10-5zM6 10v5c0 2 3 4 6 4s6-2 6-4v-5"/></svg></span>
          <span class="rt"><b>Saya siswa</b><span>Masuk pakai username dan PIN dari guru.</span></span>
          <span class="go">Masuk siswa →</span>
        </a>
        <a class="role" href="/auth/google/start?mode=login">
          <span class="ri"><svg viewBox="0 0 24 24"><path d="M3 5h18v12H3zM8 21h8M12 17v4"/></svg></span>
          <span class="rt"><b>Saya guru / admin sekolah</b><span>Masuk dengan akun Google yang sudah terdaftar.</span></span>
          <span class="go"><svg class="g" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.9 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.5l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.1 36 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg> Masuk guru</span>
        </a>
      </div>
    </section>
    <section class="feats">
      <div class="feat"><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg><h3>Nilai otomatis</h3><p>Pilihan ganda, isian, menjodohkan langsung dinilai. Uraian tinggal dikoreksi.</p></div>
      <div class="feat"><svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/></svg><h3>Anti-curang</h3><p>Deteksi pindah tab, kunci otomatis, soal dan pilihan diacak.</p></div>
      <div class="feat"><svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg><h3>Pantau langsung</h3><p>Lihat siapa yang sedang mengerjakan, tambah waktu, atau kumpulkan paksa.</p></div>
      <div class="feat"><svg viewBox="0 0 24 24"><path d="M7 3h10v18H7zM11 18h2"/></svg><h3>Bisa di HP</h3><p>Pasang seperti aplikasi. Jawaban tetap aman walau sinyal putus.</p></div>
    </section>
  `, { nav: false }));
});


// ===== Halaman hukum (dibutuhkan layar persetujuan Google) =====
const CONTACT = "admin@bantuguruyuk.web.id";
const UPDATED = "28 Oktober 2026";
const legalPage = (title: string, body: string) => base(title, `
  <div style="padding:20px 0"><a class="brand" href="/">${LOGO}</a></div>
  <article class="card legal" style="max-width:760px;margin:8px auto 0;padding:32px">
    <h1>${title}</h1>
    <p class="muted">Terakhir diperbarui: ${UPDATED}</p>
    ${body}
  </article>
  <style>.legal h2{margin-top:26px}.legal li{margin:6px 0}.legal ul{padding-left:20px}</style>
`, { nav: false });

pages.get("/privasi", (c) => c.html(legalPage("Kebijakan Privasi", `
  <p>CBT Yuk adalah layanan ujian berbasis komputer (CBT) untuk sekolah. Halaman ini menjelaskan data apa yang kami simpan, untuk apa, dan hak Anda atasnya.</p>

  <h2>Data yang kami simpan</h2>
  <ul>
    <li><b>Staf sekolah (admin, guru, pengawas):</b> alamat email dan peran. Bila masuk dengan Google, kami menerima email, nama, dan pengenal akun Google Anda. Kami tidak meminta akses ke Gmail, Drive, kontak, atau data Google lain.</li>
    <li><b>Sekolah:</b> nama, jenjang, kode sekolah, serta nama dan nomor telepon operator saat pendaftaran.</li>
    <li><b>Siswa:</b> nama, username, kelas, jenis kelamin dan NISN (opsional), email wali (opsional), serta PIN yang disimpan dalam bentuk hash, bukan teks asli.</li>
    <li><b>Aktivitas ujian:</b> jawaban, nilai, waktu mulai dan selesai, pesan ke pengawas, serta catatan pelanggaran ujian (misalnya berpindah tab).</li>
    <li><b>Catatan audit:</b> tindakan penting staf, seperti membuat ujian atau mereset PIN.</li>
    <li><b>Cookie:</b> hanya cookie sesi untuk menjaga Anda tetap masuk. Kami tidak memakai cookie iklan atau pelacak.</li>
  </ul>

  <h2>Untuk apa data dipakai</h2>
  <p>Hanya untuk menjalankan layanan: mengautentikasi pengguna, menyelenggarakan dan menilai ujian, menampilkan hasil kepada guru dan siswa, serta mengirim email yang diminta sekolah (misalnya rapor ke wali). Kami tidak menjual data dan tidak memakainya untuk iklan.</p>

  <h2>Siapa yang bisa melihat</h2>
  <p>Data setiap sekolah terpisah dari sekolah lain. Staf hanya melihat data sekolahnya sendiri; siswa hanya melihat ujian dan hasilnya sendiri.</p>

  <h2>Pihak ketiga yang memproses data</h2>
  <ul>
    <li>Cloudflare, untuk menjalankan aplikasi dan jaringannya.</li>
    <li>Neon, untuk basis data.</li>
    <li>Google, hanya untuk fitur masuk dengan Google.</li>
    <li>Resend, hanya bila sekolah mengirim email (rapor atau undangan).</li>
  </ul>

  <h2>Penyimpanan dan penghapusan</h2>
  <p>Data disimpan selama sekolah memakai layanan. Admin sekolah dapat menghapus siswa, kelas, dan ujian dari dasbor. Untuk menghapus akun atau seluruh data sekolah, hubungi kami di <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>

  <h2>Anak-anak</h2>
  <p>Siswa dapat berusia di bawah 18 tahun. Akun siswa dibuat dan dikelola oleh sekolah, dan data mereka dipakai hanya untuk keperluan pendidikan di sekolah tersebut. Orang tua atau wali dapat meminta akses atau penghapusan data melalui sekolah atau kontak di bawah.</p>

  <h2>Keamanan</h2>
  <p>Koneksi memakai HTTPS, PIN di-hash, dan akses data dibatasi per sekolah di tingkat basis data. Tidak ada sistem yang sepenuhnya bebas risiko, tetapi kami berusaha menjaga data sebaik mungkin.</p>

  <h2>Kontak</h2>
  <p>Pertanyaan atau permintaan terkait data: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
`)));

pages.get("/syarat", (c) => c.html(legalPage("Syarat Layanan", `
  <p>Dengan memakai CBT Yuk, Anda menyetujui syarat berikut.</p>

  <h2>Layanan</h2>
  <p>CBT Yuk menyediakan alat untuk membuat soal, menyelenggarakan ujian daring, dan melihat hasilnya. Layanan diberikan apa adanya dan dapat berubah atau terhenti sewaktu-waktu, misalnya untuk pemeliharaan.</p>

  <h2>Akun</h2>
  <ul>
    <li>Admin sekolah bertanggung jawab atas akun staf dan siswa di sekolahnya.</li>
    <li>Jaga kerahasiaan akun Google dan PIN. Segera hubungi kami bila akun disalahgunakan.</li>
    <li>Jangan membagikan kunci jawaban atau akun kepada pihak yang tidak berhak.</li>
  </ul>

  <h2>Penggunaan yang dilarang</h2>
  <ul>
    <li>Mengakses data sekolah lain atau mencoba menembus pembatasan akses.</li>
    <li>Mengganggu layanan, misalnya dengan serangan atau permintaan berlebihan.</li>
    <li>Mengunggah konten yang melanggar hukum atau hak pihak lain.</li>
    <li>Berbuat curang dalam ujian atau membantu pihak lain berbuat curang.</li>
  </ul>

  <h2>Konten sekolah</h2>
  <p>Soal, nilai, dan data lain yang dimasukkan sekolah tetap milik sekolah. Sekolah memberi kami izin untuk menyimpan dan memprosesnya hanya demi menjalankan layanan. Soal yang sekolah terbitkan ke bank publik dapat diunduh siapa saja.</p>

  <h2>Batas tanggung jawab</h2>
  <p>Kami berupaya menjaga layanan tetap andal, tetapi tidak menjamin layanan bebas gangguan atau galat. Sekolah disarankan mengunduh cadangan data secara berkala dan menyiapkan rencana cadangan untuk ujian penting. Sejauh diizinkan hukum, kami tidak bertanggung jawab atas kerugian tidak langsung akibat penggunaan layanan.</p>

  <h2>Penghentian</h2>
  <p>Kami dapat membatasi atau menghentikan akses yang melanggar syarat ini. Sekolah dapat berhenti memakai layanan kapan saja dan meminta penghapusan data.</p>

  <h2>Perubahan</h2>
  <p>Syarat ini dapat diperbarui. Tanggal pembaruan tertera di atas halaman; pemakaian layanan setelah perubahan berarti Anda menyetujuinya.</p>

  <h2>Kontak</h2>
  <p><a href="mailto:${CONTACT}">${CONTACT}</a></p>
`)));

pages.get("/register", (c) => {
  // Butuh cookie pending_registration (diset oleh /auth/google/callback mode=register).
  const hasPending = (c.req.header("Cookie") ?? "").includes("pending_registration=");
  const notice = hasPending ? "" : `
    <p class="err">Belum ada sesi pendaftaran. Mulai dari tombol
    <b>Daftarkan sekolah baru</b> di halaman utama.</p>`;
  return c.html(base("Daftar sekolah", `
    <div style="padding:20px 0"><a class="brand" href="/">${LOGO}</a></div>
    <div class="card" style="max-width:540px;margin:16px auto 0;padding:28px">
      <h1>Daftarkan sekolah Anda</h1>
      <p class="sub">Gratis selama masa uji coba. Akun Google Anda menjadi admin pertama sekolah ini.</p>
      ${notice}
      <form id="f" ${hasPending ? "" : "style=\"opacity:.5;pointer-events:none\""}>
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
  `, { nav: false }));
});

pages.get("/app", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [school, n, live, recent] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const sc = await tx`select name, code, level from schools where id = ${sess.sid}`;
    const cnt = await tx`select
        (select count(*) from classes)::int as classes,
        (select count(*) from students where active)::int as students,
        (select count(*) from questions)::int as questions,
        (select count(*) from exams)::int as exams,
        (select count(*) from exams e where exists (select 1 from exam_classes ec where ec.exam_id = e.id)
           and e.status in ('open','scheduled','closed'))::int as published,
        (select count(*) from exam_sessions where status = 'active' and last_seen_at > now() - interval '2 minutes')::int as online,
        (select count(*) from exam_sessions where status = 'submitted' and started_at > now() - interval '7 days')::int as week_submits,
        (select coalesce(round(avg(final_score)::numeric, 1), 0) from scores) as avg_score`;
    const lv = await tx`select e.id, e.title, e.ends_at,
        (select count(*) from exam_sessions s where s.exam_id = e.id and s.status = 'active')::int as working,
        (select count(*) from exam_sessions s where s.exam_id = e.id and s.status in ('submitted','expired'))::int as done
      from exams e where e.status = 'open' order by e.ends_at nulls last, e.title limit 6`;
    const rc = await tx`select id, title, status, starts_at from exams
      where status in ('draft','scheduled') order by coalesce(starts_at, created_at) limit 4`;
    return [sc[0] as { name: string; code: string; level: string } | undefined, cnt[0], lv, rc] as const;
  });
  const k = n as { classes: number; students: number; questions: number; exams: number; published: number;
    online: number; week_submits: number; avg_score: string };
  const steps: Array<[boolean, string, string, string, string]> = [
    [k.classes > 0, "Buat kelas", "Misalnya X-IPA-1. Siswa dan ujian dikelompokkan per kelas.", "/app/students", "Buat kelas"],
    [k.students > 0, "Masukkan siswa", "Satu per satu atau sekaligus lewat file CSV. Siswa masuk pakai username + PIN.", "/app/students", "Tambah siswa"],
    [k.questions > 0, "Tulis soal", "Pilihan ganda, isian, uraian, menjodohkan, dan lainnya.", "/app/questions", "Buka bank soal"],
    [k.published > 0, "Buat & jadwalkan ujian", "Pilih soal, kelas peserta, durasi, lalu buka ujiannya.", "/app/exams/new", "Buat ujian"],
  ];
  const doneCount = steps.filter((x) => x[0]).length;
  const nextIdx = steps.findIndex((x) => !x[0]);
  const stepList = steps.map(([ok, title, desc, href, cta], i) => `
    <li class="${ok ? "done" : i === nextIdx ? "next" : ""}">
      <span class="dot">${ok ? "✓" : i + 1}</span>
      <span class="txt"><b>${title}</b><span>${desc}</span></span>
      ${ok ? "" : `<a class="btn ${i === nextIdx ? "primary" : ""}" href="${href}">${cta}</a>`}
    </li>`).join("");

  type L = { id: string; title: string; ends_at: string | null; working: number; done: number };
  const liveRows = (live as unknown as L[]).map((e) => `
    <div class="live-row">
      <span class="live-dot" aria-hidden="true"></span>
      <span class="txt"><b>${esc(e.title)}</b><br><span class="muted">${e.working} sedang mengerjakan · ${e.done} selesai${e.ends_at ? ` · tutup ${new Date(e.ends_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}` : ""}</span></span>
      <a class="btn" href="/app/exams/${esc(e.id)}/live">Pantau</a>
    </div>`).join("") || `<div class="empty">Belum ada ujian yang sedang dibuka.<br><a class="btn" style="margin-top:12px" href="/app/exams">Lihat semua ujian</a></div>`;

  type R = { id: string; title: string; status: string; starts_at: string | null };
  const upcoming = (recent as unknown as R[]).map((e) => `
    <div class="live-row"><span class="txt"><b>${esc(e.title)}</b><br><span class="muted">${e.status === "draft" ? "Draf, belum dijadwalkan" : `Dibuka ${e.starts_at ? new Date(e.starts_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : ""}`}</span></span>
    <a class="btn" href="/app/exams/${esc(e.id)}">Atur</a></div>`).join("");

  const owner = await isOwner(sql, sess.email);
  return c.html(base("Beranda", `
    ${owner ? `<a class="card" href="/owner" style="display:flex;justify-content:space-between;align-items:center;text-decoration:none;color:inherit;padding:14px 20px"><span><b>Pemantauan layanan</b> <span class="muted">· lihat semua sekolah uji coba</span></span><span>→</span></a>` : ""}
    <div class="page-head">
      <div><h1>${esc(school?.name ?? "Sekolah")}</h1>
      <p>Siswa masuk di <b>${esc(new URL(c.req.url).host)}/s/login</b> dengan username dan PIN.</p></div>
      <a class="btn primary" href="/app/exams/new">+ Buat ujian</a>
    </div>

    ${doneCount < steps.length ? `
    <div class="card">
      <h2 style="margin-bottom:2px">Mulai di sini</h2>
      <p class="muted" style="margin:0">${doneCount} dari ${steps.length} langkah selesai. Ikuti urutannya; setiap langkah tercentang otomatis.</p>
      <div class="progress"><i style="width:${(doneCount / steps.length) * 100}%"></i></div>
      <ol class="steps" style="margin-top:8px">${stepList}</ol>
    </div>` : ""}

    <div class="card stats">
      <div class="stat live"><b>${k.online}</b><span>Sedang mengerjakan</span></div>
      <div class="stat"><b>${(live as unknown as L[]).length}</b><span>Ujian dibuka</span></div>
      <div class="stat"><b>${k.week_submits}</b><span>Dikumpulkan 7 hari</span></div>
      <div class="stat"><b>${k.avg_score}</b><span>Rata-rata nilai</span></div>
      <div class="stat"><b>${k.students}</b><span>Siswa aktif</span></div>
    </div>

    <div class="two">
      <div class="card"><h2>Sedang berjalan</h2>${liveRows}</div>
      <div class="card">
        <h2>Akan datang</h2>
        ${upcoming || `<p class="muted" style="margin:0">Tidak ada draf atau ujian terjadwal.</p>`}
        <h2 style="margin-top:22px">Unduh</h2>
        <div class="row" style="margin-top:0">
          <a class="btn" href="/api/reports/scores.csv">Rekap nilai (CSV)</a>
          ${sess.role === "admin" ? `<a class="btn" href="/api/reports/backup.json">Backup data</a>` : ""}
        </div>
      </div>
    </div>
  `, { role: sess.role }));
});

pages.get("/app/students", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [school, classes, students, overview] = await withTenant(
    sql,
    { schoolId: sess.sid, role: sess.role, userId: sess.uid },
    async (tx) => {
      const s = await tx`select name, code, level from schools where id = ${sess.sid}`;
      const cl = await tx`select id, name, grade, year from classes order by year desc, grade nulls last, name`;
      const st = await tx`
        select s.id, s.name, s.username, s.gender, s.nisn, s.class_id, s.guardian_email,
               c.name as class_name
        from students s left join classes c on c.id = s.class_id
        order by s.name limit 500`;
      const ov = await tx`select
          (select count(*) from students where active) as students,
          (select count(*) from exams where status = 'open') as open_exams,
          (select count(*) from exam_sessions where status = 'active' and last_seen_at > now() - interval '2 minutes') as online,
          (select count(*) from exam_sessions where status = 'submitted' and started_at > now() - interval '7 days') as week_submits,
          (select coalesce(round(avg(final_score)::numeric, 1), 0) from scores where approved_at > now() - interval '30 days' or approved_at is null) as avg_score`;
      return [s[0] as { name: string; code: string; level: string } | undefined, cl, st, ov[0]] as const;
    },
  );

  type Cls = { id: string; name: string; grade: number | null; year: string };
  type Stu = { id: string; name: string; username: string; gender: "L"|"P"|null; nisn: string|null; class_id: string|null; guardian_email: string|null; class_name: string|null };
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
      <td><a href="/app/students/${esc(s.id)}/analytics">${esc(s.name)}</a></td>
      <td>${esc(s.username)}</td>
      <td>${esc(s.class_name ?? "-")}</td>
      <td>${s.gender ?? ""}</td>
      <td>${esc(s.nisn ?? "")}</td>
      <td style="text-align:right; white-space:nowrap">
        <button data-edit-student='${esc(JSON.stringify(s))}'>Edit</button>
        <button class="danger" data-del-student="${esc(s.id)}">Hapus</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="6" class="muted">Belum ada siswa.</td></tr>`;

  const ov = overview as { students: string; open_exams: string; online: string; week_submits: string; avg_score: string };
  return c.html(base("Siswa & kelas", `
    <div class="page-head">
      <div><h1>Siswa & kelas</h1><p>${studentList.length} siswa di ${classList.length} kelas. Buat kelas dulu, lalu masukkan siswanya.</p></div>
      <div class="row" style="margin:0">
        <button type="button" id="btnTpl">Unduh template Excel</button>
        <button type="button" class="primary" id="btnImport">Impor dari Excel</button>
        <input type="file" id="fileXls" accept=".xlsx,.xls,.csv" hidden>
      </div>
    </div>

    <div class="card">
      <div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">Kelas</h2></div>
      <details class="add" ${classList.length ? "" : "open"}>
        <summary class="btn primary">+ Tambah kelas</summary>
        <form id="fcls" class="inline">
          <div class="grid">
            <div><label>Nama kelas</label><input name="name" required placeholder="X-IPA-1"></div>
            <div><label>Tingkat</label><input name="grade" type="number" min="1" max="12" placeholder="10"></div>
            <div><label>Tahun ajar</label><input name="year" required placeholder="2025/2026"></div>
          </div>
          <div class="row"><button class="primary" type="submit">Simpan kelas</button></div>
          <p class="err" id="errcls" hidden></p>
        </form>
      </details>
      <table>
        <thead><tr><th>Nama</th><th>Tingkat</th><th>Tahun</th><th></th></tr></thead>
        <tbody id="tbcls">${classRows}</tbody>
      </table>
    </div>

    <div class="card">
      <div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">Siswa</h2></div>
      <details class="add" ${studentList.length || !classList.length ? "" : "open"}>
        <summary class="btn primary">+ Tambah siswa</summary>
        <form id="fstu" class="inline">
          <div class="grid">
            <div><label>Nama lengkap</label><input name="name" required placeholder="Andi Saputra"></div>
            <div><label>Username <span class="muted">(dipakai siswa untuk masuk)</span></label><input name="username" required placeholder="andi.saputra"></div>
            <div>
              <label>Kelas</label>
              <select name="class_id"><option value="">— tidak dipilih —</option>${classOpts}</select>
            </div>
            <div>
              <label>Gender</label>
              <select name="gender"><option value="">—</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>
            </div>
            <div><label>NISN</label><input name="nisn" placeholder="opsional"></div>
            <div><label>PIN awal <span class="muted">(4–8 angka)</span></label><input name="pin" required pattern="\\d{4,8}" inputmode="numeric" placeholder="123456"></div>
          </div>
          <div class="row"><button class="primary" type="submit">Simpan siswa</button></div>
          <p class="muted" style="margin-top:8px">
            Banyak siswa sekaligus? Unduh <b>template Excel</b> di kanan atas, isi, lalu klik <b>Impor dari Excel</b>.
          </p>
          <p class="err" id="errstu" hidden></p>
        </form>
      </details>
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
        <label>Email wali <span class="muted">(untuk rapor otomatis)</span></label>
        <input name="guardian_email" type="email">
        <label>PIN baru <span class="muted">(kosongkan jika tidak diganti)</span></label>
        <input name="pin" pattern="\\d{4,8}">
        <div class="row">
          <button class="primary" value="save">Simpan</button>
          <button type="button" id="sendReport">Kirim rapor ke wali</button>
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
          fedit.guardian_email.value = s.guardian_email || '';
          dlg.showModal();
        }
      });

      // Impor Excel: baca di browser (SheetJS), petakan judul kolom bahasa
      // Indonesia/Inggris ke format yang diterima /api/students/import.
      const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, no) => {
        const sc = document.createElement('script'); sc.src = XLSX_SRC; sc.onload = () => ok(window.XLSX); sc.onerror = () => no(new Error('Gagal memuat pembaca Excel. Periksa koneksi.'));
        document.head.appendChild(sc);
      });
      const COLS = { name: ['nama', 'nama lengkap', 'name'], username: ['username', 'user', 'nama pengguna'], class: ['kelas', 'class'],
        gender: ['jk', 'jenis kelamin', 'gender', 'l/p'], nisn: ['nisn'], pin: ['pin', 'password', 'kata sandi'] };
      $('#btnTpl').addEventListener('click', async () => {
        const X = await loadXlsx();
        const ws = X.utils.aoa_to_sheet([['Nama', 'Username', 'Kelas', 'JK', 'NISN', 'PIN'],
          ['Andi Saputra', 'andi.saputra', 'X-IPA-1', 'L', '0012345678', '123456'],
          ['Siti Aminah', 'siti.aminah', 'X-IPA-1', 'P', '', '654321']]);
        ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 5 }, { wch: 14 }, { wch: 10 }];
        const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Siswa');
        X.writeFile(wb, 'template-siswa-cbt-yuk.xlsx');
      });
      $('#btnImport').addEventListener('click', () => $('#fileXls').click());
      $('#fileXls').addEventListener('change', async (e) => {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        try {
          const X = await loadXlsx();
          const wb = X.read(await file.arrayBuffer(), { type: 'array' });
          const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
          if (rows.length < 2) throw new Error('File kosong.');
          const head = rows[0].map((h) => String(h).trim().toLowerCase());
          const idx = {}; for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex((h) => names.includes(h));
          if (idx.name < 0 || idx.username < 0 || idx.pin < 0) throw new Error('Kolom wajib: Nama, Username, PIN. Pakai template agar aman.');
          const q = (v) => '"' + String(v ?? '').trim().replace(/"/g, '""') + '"';
          const keys = Object.keys(COLS);
          const csv = [keys.join(',')].concat(rows.slice(1).filter((r) => r.some((v) => String(v).trim()))
            .map((r) => keys.map((k) => q(idx[k] >= 0 ? r[idx[k]] : '')).join(','))).join('\\n');
          const r = await fetch('/api/students/import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'text/csv' }, body: csv });
          const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
          if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
          let msg = j.ok + ' siswa berhasil diimpor.';
          if (j.fail && j.fail.length) msg += '\\n' + j.fail.length + ' baris gagal:\\n' + j.fail.slice(0, 10).map((x) => '  baris ' + x.row + ': ' + x.error).join('\\n');
          alert(msg); location.reload();
        } catch (x) { alert('Impor gagal: ' + x.message); }
      });

      fedit.addEventListener('submit', async (e) => {
        if (fedit.returnValue === 'cancel') return;
        e.preventDefault();
        erredit.hidden = true;
        const d = Object.fromEntries(new FormData(fedit));
        const id = d.id; delete d.id;
        for (const k of ['class_id','gender','nisn']) if (d[k] === '') d[k] = null;
        if (!d.pin) delete d.pin;
        const guardian = d.guardian_email || null;
        delete d.guardian_email;
        try {
          await send('/api/students/' + id, 'PATCH', d);
          await send('/api/students/' + id + '/guardian', 'PATCH', { email: guardian });
          dlg.close(); location.reload();
        } catch (x) { erredit.textContent = x.message; erredit.hidden = false; }
      });
      document.getElementById('sendReport').addEventListener('click', async () => {
        const id = fedit.id.value;
        try {
          const r = await send('/api/students/' + id + '/send-report', 'POST');
          alert(r.skipped ? 'Email ter-skip (RESEND_API_KEY belum di-set)' : 'Rapor dikirim ke ' + r.to);
        } catch (x) { erredit.textContent = x.message; erredit.hidden = false; }
      });
    </script>
  `, { role: sess.role }));
});

// ===== Pengelolaan ujian =====

// Grup / rangkaian ujian: paket beberapa ujian yang dikerjakan berurutan.
pages.get("/app/exam-groups", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [groups, exams] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const g = await tx`select g.id, g.title, g.strict_order,
                              (select count(*) from exams e where e.group_id = g.id) as exam_count
                       from exam_groups g order by g.created_at desc`;
    const e = await tx`select id, title, group_id, group_position from exams
                       where group_id is not null order by group_id, group_position`;
    return [g, e] as const;
  });
  type G = { id: string; title: string; strict_order: boolean; exam_count: string };
  type E = { id: string; title: string; group_id: string; group_position: number };
  const groupsList = groups as unknown as G[];
  const examsList = exams as unknown as E[];
  const list = groupsList.map((g) => {
    const members = examsList.filter((e) => e.group_id === g.id)
      .sort((a, b) => a.group_position - b.group_position)
      .map((e) => `<li>${e.group_position}. <a href="/app/exams/${esc(e.id)}">${esc(e.title)}</a></li>`).join("");
    return `<div class="card">
      <div class="row" style="justify-content:space-between;margin:0 0 6px">
        <div><h2 style="margin:0">${esc(g.title)}</h2>
          <p class="muted" style="margin:4px 0 0">${g.exam_count} ujian · urut ${g.strict_order ? "ketat" : "bebas"}</p></div>
        <button class="danger" data-del="${esc(g.id)}">Hapus</button>
      </div>
      ${members ? `<ol style="margin:4px 0 0 20px">${members}</ol>` : `<p class="muted">Belum ada ujian. Tambahkan dari form buat ujian atau edit ujian existing.</p>`}
    </div>`;
  }).join("") || `<div class="card"><p class="muted">Belum ada grup.</p></div>`;
  return c.html(base("Grup ujian", `
    <div class="card">
      <h1>Grup / rangkaian ujian</h1>
      <p class="sub"><a href="/app">Dashboard</a></p>
      <form id="fg">
        <div class="grid">
          <div><label>Judul grup</label><input name="title" required placeholder="Paket Persiapan UTBK"></div>
          <div><label>Deskripsi (opsional)</label><input name="description"></div>
          <div><label><input type="checkbox" name="strict_order" checked> Urut ketat (siswa harus urut)</label></div>
        </div>
        <div class="row"><button class="primary" type="submit">Buat grup</button></div>
      </form>
    </div>
    ${list}
    <script>
      document.getElementById('fg').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd);
        d.strict_order = fd.has('strict_order');
        const r = await fetch('/api/exam-groups', { method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify(d) });
        if (r.ok) location.reload(); else { const j = await r.json().catch(() => ({})); alert(j.error || r.status); }
      });
      document.body.addEventListener('click', async (e) => {
        const id = e.target.dataset.del; if (!id) return;
        if (!confirm('Hapus grup? Ujian anggotanya tetap ada (group_id = null).')) return;
        const r = await fetch('/api/exam-groups/' + id, { method:'DELETE', credentials:'same-origin' });
        if (r.ok) location.reload(); else alert('Gagal: ' + r.status);
      });
    </script>
  `, { role: sess.role }));
});

pages.get("/app/exams", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [exams, groups] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const e = await tx`select e.id, e.title, e.kind, e.duration_minutes, e.status,
              (select count(*) from exam_questions where exam_id = e.id) as qc,
              (select count(*) from exam_classes where exam_id = e.id) as cc
       from exams e order by e.created_at desc`;
    const g = await tx`select id, title from exam_groups order by title`;
    return [e, g] as const;
  });
  type Ex = { id: string; title: string; kind: string; duration_minutes: number; status: string; qc: number; cc: number };
  const list = (exams as unknown as Ex[]).map((e) => `<tr>
    <td><a href="/app/exams/${esc(e.id)}">${esc(e.title)}</a></td>
    <td>${esc(kindLabel(e.kind))}</td>
    <td>${e.duration_minutes} mnt</td>
    <td>${e.qc} soal</td>
    <td>${e.cc} kelas</td>
    <td><span class="pill ${esc(e.status)}">${esc(e.status)}</span></td>
  </tr>`).join("") || `<tr><td colspan="6" class="muted">Belum ada ujian.</td></tr>`;

  return c.html(base("Ujian", `
    <div class="page-head">
      <div><h1>Ujian</h1><p>${(exams as unknown as Ex[]).length} ujian. Buat baru lewat panduan langkah demi langkah.</p></div>
      <div class="row" style="margin:0">
        <button type="button" id="btnGen">Auto-generate dari bank soal</button>
        <a class="btn primary" href="/app/exams/new">+ Buat ujian</a>
      </div>
    </div>
    <dialog id="genDlg" style="max-width:420px; width:92%">
      <h3 style="margin:0 0 10px">Auto-generate ujian</h3>
      <form id="genForm" method="dialog">
        <label>Judul</label><input name="title" required>
        <label>Jenis</label>
        <select name="kind"><option value="tryout" selected>Tryout</option><option value="harian">Harian</option><option value="pts_pas">PTS/PAS</option><option value="sumatif">Sumatif</option></select>
        <label>Durasi (menit)</label><input name="duration_minutes" type="number" min="5" value="60" required>
        <label>Jumlah per tipe</label>
        <div class="grid">
          <div><label style="font-size:12px">Pil. ganda</label><input name="pg" type="number" min="0" value="10"></div>
          <div><label style="font-size:12px">Benar/Salah</label><input name="benar_salah" type="number" min="0" value="0"></div>
          <div><label style="font-size:12px">Isian</label><input name="isian" type="number" min="0" value="0"></div>
          <div><label style="font-size:12px">Uraian</label><input name="uraian" type="number" min="0" value="0"></div>
          <div><label style="font-size:12px">PGK centang</label><input name="pgk_centang" type="number" min="0" value="0"></div>
          <div><label style="font-size:12px">Menjodohkan</label><input name="menjodohkan" type="number" min="0" value="0"></div>
        </div>
        <div class="row">
          <button class="primary" value="go">Generate</button>
          <button value="cancel">Batal</button>
        </div>
        <p class="err" id="genErr" hidden></p>
      </form>
    </dialog>
    <div class="card">
      <h2>Daftar ujian</h2>
      <table>
        <thead><tr><th>Judul</th><th>Jenis</th><th>Durasi</th><th>Soal</th><th>Kelas</th><th>Status</th></tr></thead>
        <tbody>${list}</tbody>
      </table>
    </div>
    <script>
      const genDlg = document.getElementById('genDlg');
      document.getElementById('btnGen').addEventListener('click', () => genDlg.showModal());
      document.getElementById('genForm').addEventListener('submit', async (e) => {
        if (e.target.returnValue === 'cancel') return;
        e.preventDefault();
        const err = document.getElementById('genErr'); err.hidden = true;
        const fd = new FormData(e.target);
        const counts = {};
        for (const k of ['pg','benar_salah','isian','uraian','pgk_centang','menjodohkan']) {
          const n = +fd.get(k); if (n > 0) counts[k] = n;
        }
        if (Object.keys(counts).length === 0) { err.textContent = 'Minimal satu tipe'; err.hidden = false; return; }
        const payload = { title: fd.get('title'), kind: fd.get('kind'),
          duration_minutes: +fd.get('duration_minutes'), counts };
        const r = await fetch('/api/exams/generate', { method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { genDlg.close(); location.href = '/app/exams/' + j.exam_id; }
        else { err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false; }
      });

    </script>
  `, { role: sess.role }));
});

// Pemantauan layanan (pemilik CBT Yuk): semua sekolah, terutama yang masih uji coba.
// Hanya email di tabel system_owners.
const isOwner = async (sql: ReturnType<typeof connect>, email: string) =>
  (await sql`select 1 from system_owners where email = ${email.toLowerCase()}`).length > 0;

pages.get("/owner", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  if (!(await isOwner(sql, sess.email))) return c.notFound();
  const rows = await withTenant(sql, { schoolId: "", role: "owner" }, (tx) => tx`
    select s.id, s.name, s.level, s.plan, s.created_at, s.operator_name, s.operator_phone, s.active,
      (select email from users u where u.school_id = s.id and u.role = 'admin' order by u.created_at limit 1) as admin_email,
      (select count(*) from students x where x.school_id = s.id and x.username not like 'tamu-%')::int as students,
      (select count(*) from questions x where x.school_id = s.id)::int as questions,
      (select count(*) from exams x where x.school_id = s.id)::int as exams,
      (select count(*) from exam_sessions x where x.school_id = s.id)::int as sessions,
      greatest((select max(started_at) from exam_sessions x where x.school_id = s.id),
               (select max(created_at) from audit_log x where x.school_id = s.id)) as last_active
    from schools s order by s.created_at desc`);
  type R = { id: string; name: string; level: string; plan: string; created_at: string; operator_name: string; operator_phone: string;
    active: boolean; admin_email: string | null; students: number; questions: number; exams: number; sessions: number; last_active: string | null };
  const list = rows as unknown as R[];
  const now = Date.now(), DAY = 86_400_000;
  const days = (iso: string | null) => iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : null;
  const ago = (iso: string | null) => { const d = days(iso); return d === null ? "belum pernah" : d === 0 ? "hari ini" : `${d} hari lalu`; };
  const wa = (p: string) => { const d = p.replace(/\D/g, "").replace(/^0/, "62"); return d.length >= 9 ? `https://wa.me/${d}` : ""; };
  const stage = (r: R) => r.sessions > 0 ? (days(r.last_active)! <= 7 ? ["Aktif", "open"] : ["Diam", "closed"])
    : r.exams > 0 ? ["Siapkan ujian", "scheduled"] : r.students > 0 ? ["Isi siswa", "scheduled"] : ["Baru daftar", ""];
  const trial = list.filter((r) => r.plan === "trial");
  const newWeek = list.filter((r) => days(r.created_at)! <= 7).length;
  const activeWeek = list.filter((r) => r.last_active && days(r.last_active)! <= 7).length;
  const body = list.map((r) => {
    const [label, cls] = stage(r); const link = wa(r.operator_phone);
    return `<tr>
      <td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.level)} · ${esc(r.admin_email ?? "-")}</span></td>
      <td><span class="pill ${cls}">${label}</span>${r.plan !== "trial" ? ` <span class="pill">${esc(r.plan)}</span>` : ""}</td>
      <td>${new Date(r.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })}<br><span class="muted">${ago(r.created_at)}</span></td>
      <td style="text-align:right">${r.students}</td><td style="text-align:right">${r.questions}</td>
      <td style="text-align:right">${r.exams}</td><td style="text-align:right">${r.sessions}</td>
      <td>${ago(r.last_active)}</td>
      <td>${esc(r.operator_name)}<br>${link ? `<a href="${link}" target="_blank" rel="noopener">${esc(r.operator_phone)}</a>` : esc(r.operator_phone)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" class="muted">Belum ada sekolah.</td></tr>`;
  return c.html(base("Pemantauan", `
    <div class="page-head"><div><h1>Pemantauan layanan</h1><p>Semua sekolah yang mendaftar, urut dari yang terbaru. Hanya terlihat oleh pemilik layanan.</p></div></div>
    <div class="card stats">
      <div class="stat"><b>${list.length}</b><span>Total sekolah</span></div>
      <div class="stat"><b>${trial.length}</b><span>Masih uji coba</span></div>
      <div class="stat"><b>${newWeek}</b><span>Daftar 7 hari</span></div>
      <div class="stat live"><b>${activeWeek}</b><span>Aktif 7 hari</span></div>
      <div class="stat"><b>${list.reduce((a, r) => a + r.sessions, 0)}</b><span>Total sesi ujian</span></div>
    </div>
    <div class="card">
      <h2>Sekolah</h2>
      <p class="muted" style="margin-top:-6px">Tahap: <b>Baru daftar</b> → <b>Isi siswa</b> → <b>Siapkan ujian</b> → <b>Aktif</b> (ada ujian dikerjakan 7 hari terakhir) atau <b>Diam</b>. Klik nomor HP untuk menghubungi lewat WhatsApp.</p>
      <table>
        <thead><tr><th>Sekolah</th><th>Tahap</th><th>Daftar</th><th style="text-align:right">Siswa</th><th style="text-align:right">Soal</th><th style="text-align:right">Ujian</th><th style="text-align:right">Sesi</th><th>Terakhir aktif</th><th>Operator</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `, { role: sess.role }));
});

// Pengaturan sekolah (admin): identitas + warna merek.
pages.get("/app/settings", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  if (sess.role !== "admin") return c.redirect("/app");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select name, level, npsn, color, operator_name, operator_phone, plan, created_at from schools where id = ${sess.sid}`);
  const sc = rows[0] as { name: string; level: string; npsn: string | null; color: string; operator_name: string; operator_phone: string; plan: string; created_at: string };
  const swatches = Object.entries(BRAND_COLORS).map(([k, v]) => `
    <label class="sw"><input type="radio" name="color" value="${k}" ${sc.color === k ? "checked" : ""}>
      <span style="--c:${v.hex}"></span>${v.label}</label>`).join("");
  const lv = (v: string, t: string) => `<option value="${v}" ${sc.level === v ? "selected" : ""}>${t}</option>`;
  return c.html(base("Pengaturan", `
    <div class="page-head"><div><h1>Pengaturan sekolah</h1><p>Identitas dan tampilan yang dilihat guru dan siswa.</p></div></div>
    <form id="fs" class="two">
      <div class="card">
        <h2>Identitas</h2>
        <label>Nama sekolah</label><input name="name" required value="${esc(sc.name)}">
        <div class="grid">
          <div><label>Jenjang</label><select name="level">${lv("SD", "SD")}${lv("SMP", "SMP")}${lv("SMA", "SMA/SMK")}${lv("CAMPURAN", "Campuran")}</select></div>
          <div><label>NPSN <span class="muted">(opsional)</span></label><input name="npsn" value="${esc(sc.npsn ?? "")}"></div>
        </div>
        <div class="grid">
          <div><label>Nama operator</label><input name="operator_name" value="${esc(sc.operator_name)}"></div>
          <div><label>No. HP operator</label><input name="operator_phone" inputmode="tel" value="${esc(sc.operator_phone)}"></div>
        </div>
      </div>
      <div class="card">
        <h2>Warna merek</h2>
        <p class="muted" style="margin-top:-6px">Dipakai untuk tombol, menu, dan pilihan jawaban siswa.</p>
        <div class="sws">${swatches}</div>
        <div class="prev"><button type="button" class="primary" tabindex="-1">Tombol utama</button><span class="pill scheduled">Terjadwal</span><span class="pv-opt"><i>A</i>Jawaban terpilih</span></div>
        <p class="muted" style="margin-bottom:0">Paket: <b>${esc(sc.plan === "trial" ? "Uji coba" : sc.plan)}</b> · terdaftar ${new Date(sc.created_at).toLocaleDateString("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" })}</p>
      </div>
      <div class="row" style="grid-column:1/-1;margin:0"><button class="primary" type="submit">Simpan perubahan</button><span id="msg" class="muted" role="status"></span></div>
    </form>
    <style>
      .sws { display:grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .sw { display:flex; align-items:center; gap:10px; border:1.5px solid var(--line); border-radius: 12px; padding: 10px 12px; margin:0; cursor:pointer; font-weight:600; }
      .sw input { position:absolute; opacity:0; }
      .sw span { width:22px; height:22px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 2px rgba(255,255,255,.5); }
      .sw:has(input:checked) { border-color: var(--brand); background: var(--soft); }
      .sw:has(input:focus-visible) { outline: 3px solid color-mix(in srgb, var(--brand) 45%, transparent); }
      .prev { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin: 18px 0 14px; padding: 14px; border: 1px dashed var(--line); border-radius: 14px; }
      .pv-opt { display:inline-flex; gap:8px; align-items:center; border:1.5px solid var(--brand); background: var(--soft); border-radius: 12px; padding: 6px 10px; font-weight:600; font-size:14px; }
      .pv-opt i { width:24px; height:24px; border-radius:50%; background: var(--brand); color: var(--brand-ink); display:grid; place-items:center; font-style:normal; font-size:12px; font-weight:800; }
      @media (max-width: 520px) { .sws { grid-template-columns: 1fr 1fr; } }
    </style>
    <script>
      const HEX = ${JSON.stringify(Object.fromEntries(Object.entries(BRAND_COLORS).map(([k, v]) => [k, v.hex])))};
      const f = document.getElementById('fs'), msg = document.getElementById('msg');
      f.addEventListener('change', (e) => { if (e.target.name === 'color') document.documentElement.style.setProperty('--brand', HEX[e.target.value]); });
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); msg.className = 'muted'; msg.textContent = 'Menyimpan…';
        const d = Object.fromEntries(new FormData(f));
        const r = await fetch('/api/school', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { msg.textContent = 'Tersimpan.'; } else { msg.className = 'err'; msg.textContent = j.error || 'Gagal menyimpan.'; }
      });
    </script>
  `, { role: sess.role }));
});

// Wizard "Buat ujian": 4 langkah di satu halaman, simpan di akhir.
pages.get("/app/exams/new", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  if (sess.role === "proctor") return c.redirect("/app/exams");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [classes, questions, cats, groups] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const cl = await tx`select c.id, c.name, c.year, (select count(*) from students s where s.class_id = c.id and s.active)::int as n
                        from classes c order by c.year desc, c.name`;
    const q = await tx`select q.id, q.type, substring(q.content->>'text', 1, 140) as text, q.points, q.category_id
                       from questions q order by q.created_at desc limit 500`;
    const ct = await tx`select id, name from categories order by name`;
    const g = await tx`select id, title from exam_groups order by title`;
    return [cl, q, ct, g] as const;
  });
  const data = JSON.stringify({ classes, questions, cats, groups }).replace(/</g, "\\u003c");
  return c.html(base("Buat ujian", `
    <div class="page-head">
      <div><h1>Buat ujian</h1><p>Empat langkah singkat. Belum ada yang tersimpan sampai langkah terakhir.</p></div>
      <a class="btn" href="/app/exams">Batal</a>
    </div>
    <ol class="wz" id="wz" aria-label="Langkah">
      <li data-s="1"><i>1</i><span>Dasar</span></li><li data-s="2"><i>2</i><span>Peserta</span></li>
      <li data-s="3"><i>3</i><span>Soal</span></li><li data-s="4"><i>4</i><span>Jadwal</span></li>
    </ol>

    <form id="wf" novalidate>
      <section class="card wstep" data-s="1">
        <h2>Ujian apa ini?</h2>
        <label>Judul ujian</label><input name="title" placeholder="mis. Ulangan Harian Matematika Bab 3" required>
        <div class="grid">
          <div><label>Jenis ujian <span class="muted">(pilih atau ketik sendiri)</span></label>
            <input name="kind" list="kinds" value="Ulangan harian" maxlength="60" required>
            <datalist id="kinds"><option value="Ulangan harian"><option value="Kuis"><option value="PTS"><option value="PAS"><option value="Sumatif"><option value="Asesmen formatif"><option value="Tryout"><option value="Remedial"><option value="Ujian sekolah"></datalist></div>
          <div><label>Durasi pengerjaan <span class="muted">(menit)</span></label><input name="duration_minutes" type="number" min="5" value="60" required></div>
        </div>
      </section>

      <section class="card wstep" data-s="2" hidden>
        <h2>Siapa pesertanya?</h2>
        <p class="muted" style="margin-top:0">Hanya siswa di kelas yang dipilih yang melihat ujian ini.</p>
        <div id="clsList"></div>
      </section>

      <section class="card wstep" data-s="3" hidden>
        <h2>Pilih soal</h2>
        <div class="wbar">
          <input id="qSearch" type="search" placeholder="Cari soal…" aria-label="Cari soal">
          <select id="qCat" aria-label="Kategori"><option value="">Semua kategori</option></select>
        </div>
        <div class="row" style="margin:8px 0">
          <button type="button" id="qAll">Pilih semua yang tampil</button>
          <button type="button" id="qNone">Kosongkan</button>
          <span class="muted" id="qCount" style="margin-left:auto"></span>
        </div>
        <div class="pick" id="qList"></div>
        <p class="muted">Belum ada soalnya? <a href="/app/questions" target="_blank" rel="noopener">Tulis di bank soal</a> (tab baru), lalu muat ulang halaman ini.</p>
      </section>

      <section class="card wstep" data-s="4" hidden>
        <h2>Kapan dibuka?</h2>
        <div class="choice">
          <label class="ch"><input type="radio" name="when" value="draft" checked><span><b>Simpan sebagai draf</b><small>Belum bisa dikerjakan siswa. Bisa dibuka nanti.</small></span></label>
          <label class="ch"><input type="radio" name="when" value="now"><span><b>Buka sekarang</b><small>Siswa langsung bisa mulai mengerjakan.</small></span></label>
          <label class="ch"><input type="radio" name="when" value="sched"><span><b>Jadwalkan</b><small>Terbuka dan tertutup otomatis pada waktu yang ditentukan.</small></span></label>
        </div>
        <div class="grid" id="schedBox" hidden>
          <div><label>Mulai</label><input name="starts_at" type="datetime-local"></div>
          <div><label>Berakhir</label><input name="ends_at" type="datetime-local"></div>
        </div>
        <div class="row" style="margin-top:4px">
          <label><input type="checkbox" name="shuffle_questions"> Acak urutan soal</label>
          <label><input type="checkbox" name="shuffle_options"> Acak pilihan jawaban</label>
        </div>
        <details style="margin-top:12px"><summary>Pengaturan lanjutan</summary>
          <div class="grid">
            <div><label>Anti-curang</label>
              <select name="anticheat_level"><option value="log">Catat saja</option><option value="warn" selected>Beri peringatan</option><option value="lock">Kunci otomatis</option></select></div>
            <div><label>Kunci setelah <span class="muted">(pelanggaran)</span></label><input name="lock_after_violations" type="number" min="1" value="3"></div>
            <div><label>Soal per siswa <span class="muted">(0 = semua)</span></label><input name="questions_per_session" type="number" min="0" value="0"></div>
            <div><label>Penalti salah <span class="muted">(0–1)</span></label><input name="wrong_penalty" type="number" min="0" max="1" step="0.05" value="0"></div>
            <div><label>Rangkaian <span class="muted">(opsional)</span></label><select name="group_id"><option value="">— tanpa rangkaian —</option></select></div>
            <div><label>Urutan dalam rangkaian</label><input name="group_position" type="number" min="1"></div>
          </div>
        </details>
        <div class="review" id="review"></div>
      </section>

      <p class="err" id="wErr" role="alert" hidden></p>
      <div class="row wnav">
        <button type="button" id="wBack">Kembali</button>
        <button type="button" class="primary" id="wNext">Lanjut</button>
      </div>
    </form>

    <style>
      .wz { list-style:none; display:flex; gap:0; padding:0; margin:0 0 18px; counter-reset:x; }
      .wz li { flex:1; display:flex; align-items:center; gap:8px; color:var(--mut); font-size:13px; font-weight:600; position:relative; }
      .wz li::after { content:""; flex:1; height:2px; background:var(--line); margin:0 8px; }
      .wz li:last-child::after { display:none; }
      .wz i { font-style:normal; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; border:2px solid var(--line); font-weight:800; flex:0 0 auto; }
      .wz li.on { color:var(--fg); } .wz li.on i { border-color:var(--ink); box-shadow:0 0 0 4px color-mix(in srgb, var(--pencil) 45%, transparent); }
      .wz li.ok i { background:var(--ok); border-color:var(--ok); color:#fff; }
      .wz li.ok i { font-size:0; } .wz li.ok i::before { content:"✓"; font-size:13px; }
      @media (max-width:560px){ .wz li span{display:none} .wz li.on span{display:inline} .wz li::after{margin:0 4px} }
      .wbar { display:grid; grid-template-columns:1fr 200px; gap:8px; } @media (max-width:560px){ .wbar{grid-template-columns:1fr} }
      .ch { display:flex; gap:12px; align-items:flex-start; border:1.5px solid var(--line); border-radius:12px; padding:12px 14px; margin:8px 0; cursor:pointer; font-weight:400; }
      .ch:has(input:checked) { border-color:var(--ink); background:color-mix(in srgb, var(--pencil) 14%, transparent); }
      .ch span { display:flex; flex-direction:column; } .ch small { color:var(--mut); }
      .ch input { margin-top:3px; }
      .review { margin-top:16px; border-top:1px solid var(--line); padding-top:12px; }
      .review dl { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; margin:8px 0 0; } .review dt{color:var(--mut)} .review dd{margin:0;font-weight:600}
      .cls { display:flex; align-items:center; gap:12px; border:1.5px solid var(--line); border-radius:12px; padding:10px 14px; margin:8px 0; font-weight:500; min-height:52px; cursor:pointer; }
      .cls:has(input:checked) { border-color:var(--ink); background:color-mix(in srgb, var(--pencil) 14%, transparent); }
      .cls small { margin-left:auto; color:var(--mut); font-weight:400; }
      .wnav { justify-content:space-between; }
    </style>
    <script>
      const D = ${data};
      const f = document.getElementById('wf'), err = document.getElementById('wErr');
      const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      const TYPE = { pg:'Pilihan ganda', benar_salah:'Benar/Salah', isian:'Isian', uraian:'Uraian', pgk_centang:'PG kompleks', menjodohkan:'Menjodohkan', pgk_kategori:'Kategori', simulasi:'Simulasi', dinamis_hitung:'Hitung dinamis' };
      let step = 1;
      const pickedQ = new Set();

      // Kelas
      const cl = document.getElementById('clsList');
      cl.innerHTML = D.classes.length ? D.classes.map((c) => '<label class="cls"><input type="checkbox" name="cls" value="' + esc(c.id) + '"> ' + esc(c.name) + '<small>' + c.n + ' siswa · ' + esc(c.year) + '</small></label>').join('')
        : '<p class="muted">Belum ada kelas. <a href="/app/students">Buat kelas dulu</a>, lalu kembali ke sini.</p>';
      // Rangkaian + kategori
      D.groups.forEach((g) => f.group_id.insertAdjacentHTML('beforeend', '<option value="' + esc(g.id) + '">' + esc(g.title) + '</option>'));
      const qCat = document.getElementById('qCat');
      D.cats.forEach((g) => qCat.insertAdjacentHTML('beforeend', '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>'));

      // Soal
      const qList = document.getElementById('qList'), qSearch = document.getElementById('qSearch');
      const visible = () => { const t = qSearch.value.trim().toLowerCase(), k = qCat.value;
        return D.questions.filter((q) => (!k || q.category_id === k) && (!t || (q.text || '').toLowerCase().includes(t))); };
      function drawQ() {
        const v = visible();
        qList.innerHTML = v.map((q) => '<label class="qpick"><input type="checkbox" value="' + esc(q.id) + '"' + (pickedQ.has(q.id) ? ' checked' : '') + '><span>' + esc(q.text || '(tanpa teks)') + '<br><span class="muted">' + esc(TYPE[q.type] || q.type) + ' · ' + q.points + ' poin</span></span></label>').join('')
          || '<p class="muted" style="padding:12px">' + (D.questions.length ? 'Tidak ada soal yang cocok.' : 'Bank soal masih kosong.') + '</p>';
        document.getElementById('qCount').textContent = pickedQ.size + ' soal dipilih';
      }
      qList.addEventListener('change', (e) => { const i = e.target; i.checked ? pickedQ.add(i.value) : pickedQ.delete(i.value); drawQ(); });
      qSearch.addEventListener('input', drawQ); qCat.addEventListener('change', drawQ);
      document.getElementById('qAll').onclick = () => { visible().forEach((q) => pickedQ.add(q.id)); drawQ(); };
      document.getElementById('qNone').onclick = () => { pickedQ.clear(); drawQ(); };
      drawQ();

      // Jadwal
      const whenVal = () => f.when.value;
      f.addEventListener('change', (e) => { if (e.target.name === 'when') document.getElementById('schedBox').hidden = whenVal() !== 'sched'; });
      const chosenClasses = () => [...f.querySelectorAll('input[name=cls]:checked')].map((i) => i.value);

      function review() {
        const names = D.classes.filter((c) => chosenClasses().includes(c.id)).map((c) => c.name).join(', ') || '—';
        const w = { draft: 'Draf (belum dibuka)', now: 'Dibuka sekarang', sched: 'Terjadwal' }[whenVal()];
        document.getElementById('review').innerHTML = '<b>Ringkasan</b><dl><dt>Judul</dt><dd>' + esc(f.title.value) + '</dd><dt>Durasi</dt><dd>' + esc(f.duration_minutes.value) + ' menit</dd><dt>Peserta</dt><dd>' + esc(names) + '</dd><dt>Soal</dt><dd>' + pickedQ.size + ' soal</dd><dt>Status</dt><dd>' + w + '</dd></dl>';
      }

      function show(n) {
        step = n;
        document.querySelectorAll('.wstep').forEach((el) => el.hidden = +el.dataset.s !== n);
        document.querySelectorAll('#wz li').forEach((li) => { const s = +li.dataset.s; li.classList.toggle('on', s === n); li.classList.toggle('ok', s < n); });
        document.getElementById('wBack').style.visibility = n === 1 ? 'hidden' : 'visible';
        document.getElementById('wNext').textContent = n === 4 ? (whenVal() === 'now' ? 'Buka ujian sekarang' : whenVal() === 'sched' ? 'Jadwalkan ujian' : 'Simpan draf') : 'Lanjut';
        if (n === 4) review();
        err.hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      f.addEventListener('change', () => { if (step === 4) show(4); });
      function check() {
        if (step === 1) { if (!f.title.value.trim()) return 'Isi judul ujian.'; if (!f.kind.value.trim()) return 'Isi jenis ujian.'; if (!(+f.duration_minutes.value >= 5)) return 'Durasi minimal 5 menit.'; }
        if (step === 2 && chosenClasses().length === 0) return 'Pilih minimal satu kelas.';
        if (step === 3 && pickedQ.size === 0) return 'Pilih minimal satu soal.';
        if (step === 4 && whenVal() === 'sched') {
          if (!f.starts_at.value || !f.ends_at.value) return 'Isi waktu mulai dan berakhir.';
          if (new Date(f.ends_at.value) <= new Date(f.starts_at.value)) return 'Waktu berakhir harus setelah waktu mulai.';
        }
        return '';
      }
      async function call(url, method, body) {
        const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        return j;
      }
      async function save() {
        const next = document.getElementById('wNext'); next.disabled = true;
        try {
          const when = whenVal(), pen = parseFloat(f.wrong_penalty.value || '0');
          const iso = (v) => v ? new Date(v).toISOString() : null;
          const ex = await call('/api/exams', 'POST', {
            title: f.title.value.trim(), kind: f.kind.value.trim(), duration_minutes: +f.duration_minutes.value,
            starts_at: when === 'sched' ? iso(f.starts_at.value) : null, ends_at: when === 'sched' ? iso(f.ends_at.value) : null,
            shuffle_questions: f.shuffle_questions.checked, shuffle_options: f.shuffle_options.checked,
            anticheat_level: f.anticheat_level.value, lock_after_violations: f.lock_after_violations.value ? +f.lock_after_violations.value : null,
            questions_per_session: +f.questions_per_session.value || 0,
            scoring_config: pen > 0 ? { wrong_penalty: pen } : {},
            group_id: f.group_id.value || null, group_position: f.group_position.value ? +f.group_position.value : null,
          });
          await call('/api/exams/' + ex.id + '/questions', 'POST', { question_ids: D.questions.filter((q) => pickedQ.has(q.id)).map((q) => q.id) });
          await call('/api/exams/' + ex.id + '/classes', 'POST', { class_ids: chosenClasses() });
          if (when !== 'draft') await call('/api/exams/' + ex.id, 'PATCH', { status: when === 'now' ? 'open' : 'scheduled' });
          location.href = '/app/exams/' + ex.id + '?baru=1';
        } catch (x) { err.textContent = 'Gagal menyimpan: ' + x.message; err.hidden = false; next.disabled = false; }
      }
      document.getElementById('wBack').onclick = () => show(step - 1);
      document.getElementById('wNext').onclick = () => {
        const m = check(); if (m) { err.textContent = m; err.hidden = false; return; }
        step === 4 ? save() : show(step + 1);
      };
      f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'search') { e.preventDefault(); document.getElementById('wNext').click(); } });
      show(1);
    </script>
  `, { role: sess.role }));
});

pages.get("/app/exams/:id", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
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
    const certBtn = r.status === "submitted" && r.final_score != null
      ? ` · <a href="/app/sessions/${esc(r.session_id)}/certificate">sertifikat</a>`
      : "";
    const unlockBtn = r.status === "locked"
      ? ` · <a href="#" data-unlock="${esc(r.session_id)}">buka kembali</a>` : "";
    return `<tr>
      <td>${esc(r.student_name)}</td>
      <td>${esc(r.class_name ?? "-")}</td>
      <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span>${r.violation_count ? ` · ${r.violation_count} pelanggaran` : ""}${unlockBtn}</td>
      <td>${r.auto_score ?? "-"}</td>
      <td>${r.manual_score ?? "-"}</td>
      <td><b>${r.final_score ?? "-"}</b>${manualBtn}${certBtn}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">Belum ada peserta.</td></tr>`;

  const summaryRows = summary.map((r) => `<tr>
    <td>${esc(r.class_name)}</td><td>${r.peserta}</td><td>${r.nilai_tersedia}</td>
    <td>${r.rata_rata ?? "-"}</td><td>${r.terendah ?? "-"}</td><td>${r.tertinggi ?? "-"}</td>
  </tr>`).join("") || `<tr><td colspan="6" class="muted">Belum ada data.</td></tr>`;

  return c.html(base(ex.title, `
    <div class="card" id="okBanner" hidden style="border-color:var(--ok)"><b>Ujian tersimpan.</b> Atur detail di bawah, atau kembali ke <a href="/app/exams">daftar ujian</a>.</div>
    <script>if (new URLSearchParams(location.search).has("baru")) document.getElementById("okBanner").hidden = false;</script>
    <div class="card">
      <h1>${esc(ex.title)} <span class="muted" style="font-weight:normal">· ${esc(ex.kind)} · ${ex.duration_minutes} mnt</span></h1>
      <p class="sub"><a href="/app/exams">Daftar ujian</a></p>
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
        <a class="btn" href="/app/exams/${esc(examId)}/live">Live monitoring</a>
        <a class="btn" href="/app/exams/${esc(examId)}/lab">Mode lab komputer</a>
        <a class="btn" href="/app/exams/${esc(examId)}/items">Analisis butir soal</a>
        <a class="btn" href="/app/exams/${esc(examId)}/insights">Insights (distraktor + chat)</a>
        <a class="btn" href="/app/exams/${esc(examId)}/print">Cetak soal</a>
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
  `, { role: sess.role }));
});

// Antrian permintaan reset PIN dari siswa.
pages.get("/app/pin-resets", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select pr.id, pr.status, pr.requested_at, pr.approved_at, pr.new_pin,
              st.name as student_name, st.username
       from pin_resets pr join students st on st.id = pr.student_id
       where pr.status = 'pending' or pr.new_pin is not null
       order by pr.requested_at desc`,
  );
  type R = { id: string; status: string; requested_at: string; approved_at: string | null;
    new_pin: string | null; student_name: string; username: string };
  const list = (rows as unknown as R[]).map((r) => {
    const timeStr = new Date(r.requested_at).toLocaleString("id-ID");
    if (r.new_pin) {
      return `<tr>
        <td><b>${esc(r.student_name)}</b> (<code>${esc(r.username)}</code>)<br><span class="muted">${timeStr}</span></td>
        <td><span class="pill" style="background:#16a34a1a;border-color:#16a34a;color:#16a34a">PIN baru: ${esc(r.new_pin)}</span></td>
        <td style="text-align:right"><button data-clear="${esc(r.id)}">Sudah disampaikan</button></td>
      </tr>`;
    }
    return `<tr>
      <td><b>${esc(r.student_name)}</b> (<code>${esc(r.username)}</code>)<br><span class="muted">${timeStr}</span></td>
      <td><span class="pill">${esc(r.status)}</span></td>
      <td style="text-align:right">
        <button class="primary" data-approve="${esc(r.id)}">Setujui &amp; generate PIN</button>
        <button class="danger" data-reject="${esc(r.id)}">Tolak</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="muted">Tidak ada permintaan.</td></tr>`;
  return c.html(base("Reset PIN siswa", `
    <div class="card">
      <h1>Permintaan reset PIN siswa</h1>
      <p class="sub"><a href="/app">Dashboard</a></p>
      <p class="muted">Setujui akan menghasilkan PIN 6-digit baru. Tampilkan ke siswa, lalu klik "Sudah disampaikan" supaya PIN polos dihapus dari tampilan.</p>
    </div>
    <div class="card">
      <table style="width:100%; border-collapse:collapse">
        <tbody>${list}</tbody>
      </table>
    </div>
    <script>
      document.body.addEventListener('click', async (e) => {
        const id = e.target.dataset.approve || e.target.dataset.reject || e.target.dataset.clear;
        if (!id) return;
        const action = e.target.dataset.approve ? 'approve' : (e.target.dataset.reject ? 'reject' : 'clear');
        if (action === 'reject' && !confirm('Tolak permintaan ini?')) return;
        const r = await fetch('/api/pin-resets/' + id + '/' + action, { method:'POST', credentials:'same-origin' });
        if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || r.status); return; }
        location.reload();
      });
    </script>
  `, { role: sess.role }));
});

// Printable: semua soal ujian + opsional kunci (?key=1). Cetak atau simpan
// sebagai PDF untuk cadangan paper-based.
pages.get("/app/exams/:id/print", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const examId = c.req.param("id");
  const showKey = c.req.query("key") === "1";
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const e = await tx`select title, kind, duration_minutes from exams where id = ${examId}`;
    if (e.length === 0) return null;
    const qs = await tx`
      select eq.position, q.type, q.content, q.points, k.answer_key, k.rubric,
             p.title as passage_title, p.body as passage_body
      from exam_questions eq
      join questions q on q.id = eq.question_id
      left join question_keys k on k.question_id = q.id
      left join passages p on p.id = q.passage_id
      where eq.exam_id = ${examId}
      order by eq.position`;
    return { ex: e[0], qs };
  });
  if (!data) return c.notFound();
  const ex = data.ex as { title: string; kind: string; duration_minutes: number };
  type Q = { position: number; type: string; points: string;
    content: { text: string; options?: string[]; left?: string[]; right?: string[]; image?: string };
    answer_key: Record<string, unknown> | null; rubric: string | null;
    passage_title: string | null; passage_body: string | null };
  const list = (data.qs as unknown as Q[]).map((q) => {
    let body = `<p class="qtext"><b>${q.position}. (${q.points} pts)</b> ${esc(q.content.text)}</p>`;
    if (q.passage_body) body = `<div class="passage"><b>${esc(q.passage_title ?? "Bacaan")}</b><br>${esc(q.passage_body)}</div>` + body;
    if (q.content.image) body += `<img src="${esc(q.content.image)}" style="max-width:300px; max-height:200px; display:block; margin:4px 0">`;
    if (q.type === "pg" || q.type === "benar_salah" || q.type === "pgk_centang") {
      body += `<ol type="A" style="margin:4px 0 0 20px">` +
        (q.content.options ?? []).map((o, i) => {
          const marker = showKey && q.answer_key && (
            (q.type === "pgk_centang" && Array.isArray(q.answer_key.correct) && (q.answer_key.correct as number[]).includes(i)) ||
            (q.type !== "pgk_centang" && q.answer_key.index === i)
          );
          return `<li ${marker ? "style=\"background:#dcfce7; font-weight:600\"" : ""}>${esc(o)}${marker ? " ✓" : ""}</li>`;
        }).join("") + `</ol>`;
    } else if (q.type === "isian") {
      body += `<p>Jawaban: ${showKey ? `<b>${esc(((q.answer_key?.accepted as string[]) ?? []).join(" / "))}</b>` : "____________________"}</p>`;
    } else if (q.type === "menjodohkan") {
      body += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px; margin:4px 0">
        <div><b>Kiri:</b><ol style="margin:0 0 0 20px">` + (q.content.left ?? []).map((l) => `<li>${esc(l)}</li>`).join("") + `</ol></div>
        <div><b>Kanan:</b><ol type="A" style="margin:0 0 0 20px">` + (q.content.right ?? []).map((r) => `<li>${esc(r)}</li>`).join("") + `</ol></div>
      </div>`;
      if (showKey && Array.isArray(q.answer_key?.pairs)) {
        body += `<p class="muted">Kunci: ${(q.answer_key.pairs as number[][]).map((p) => `${p[0] + 1}→${String.fromCharCode(65 + p[1])}`).join(", ")}</p>`;
      }
    } else if (q.type === "uraian" || q.type === "simulasi") {
      body += `<p class="muted">Jawaban dinilai manual.${showKey && q.rubric ? ` Rubrik: ${esc(q.rubric)}` : ""}</p>`;
      if (q.type !== "simulasi") body += `<div style="min-height:60px; border-bottom:1px dotted #999"></div>`;
    }
    return `<div class="q">${body}</div>`;
  }).join("");
  return c.html(`<!doctype html><html lang="id"><head>
<meta charset="utf-8"><title>${esc(ex.title)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font: 13px/1.5 Georgia, serif; color: #111; margin: 0; background: #fafafa; }
  main { max-width: 720px; margin: 20px auto; background: #fff; padding: 24px; }
  h1 { margin: 0 0 4px; }
  .meta { color: #666; margin: 0 0 20px; }
  .q { padding: 10px 0; border-bottom: 1px dashed #ddd; }
  .qtext { margin: 0; }
  .passage { background: #f5f5f5; padding: 10px; border-left: 3px solid #666; margin: 6px 0; white-space: pre-wrap; font-size: 13px; }
  .no-print button { padding: 8px 14px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  @media print { body { background: #fff; } main { max-width: none; margin: 0; padding: 0; } .no-print { display: none; } }
</style></head><body><main>
  <div class="no-print">
    <button onclick="window.print()">Cetak atau simpan PDF</button>
    <a href="?key=${showKey ? "0" : "1"}" style="margin-left:12px">${showKey ? "Sembunyikan" : "Tampilkan"} kunci</a>
    <a href="/app/exams/${esc(examId)}" style="margin-left:12px">Detail ujian</a>
  </div>
  <h1>${esc(ex.title)}</h1>
  <p class="meta">${esc(ex.kind)} · Durasi ${ex.duration_minutes} menit · ${(data.qs as unknown as Q[]).length} soal${showKey ? " · <b>Lembar Kunci</b>" : ""}</p>
  <p>Nama: ______________________________ Kelas: __________ Tanggal: __________</p>
  ${list}
</main></body></html>`);
});

// Sertifikat pencapaian untuk satu sesi ujian jika nilainya ≥ KKM
// (default 75). Format cetak A4 landscape, dekorasi border tebal.
pages.get("/app/sessions/:sid/certificate", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const sessionId = c.req.param("sid");
  const kkm = parseInt(c.req.query("kkm") ?? "75", 10);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const r = await tx`
      select st.name as student_name, st.nisn, c.name as class_name,
             sch.name as school_name, sch.level, e.title as exam_title,
             e.kind, sc.final_score, es.finished_at
      from exam_sessions es
      join students st on st.id = es.student_id
      join exams e on e.id = es.exam_id
      join schools sch on sch.id = es.school_id
      left join classes c on c.id = st.class_id
      left join scores sc on sc.session_id = es.id
      where es.id = ${sessionId} and es.status = 'submitted'`;
    return r[0];
  });
  if (!data) return c.notFound();
  const d = data as {
    student_name: string; nisn: string | null; class_name: string | null;
    school_name: string; level: string; exam_title: string; kind: string;
    final_score: string | null; finished_at: string;
  };
  const score = parseFloat(d.final_score ?? "0");
  const passed = score >= kkm;
  const verifCode = `${sessionId.slice(0, 8).toUpperCase()}-${(Date.now() % 100000).toString().padStart(5, "0")}`;
  return c.html(`<!doctype html><html lang="id"><head>
<meta charset="utf-8"><title>Sertifikat — ${esc(d.student_name)}</title>
<style>
  @page { size: A4 landscape; margin: 15mm; }
  body { font: 15px/1.5 Georgia, 'Times New Roman', serif; margin: 0; background: #f5f5f5; color: #111; }
  main { max-width: 1000px; margin: 20px auto; background: #fff; padding: 48px 56px; border: 12px double #d4a24a; position: relative; min-height: 540px; }
  main::before { content:""; position:absolute; inset: 6px; border: 2px solid #d4a24a; pointer-events:none; }
  h1 { font-size: 44px; text-align: center; margin: 0 0 4px; letter-spacing: 2px; color: #0b3a7a; }
  h2 { font-size: 20px; text-align: center; margin: 0 0 24px; letter-spacing: 1px; color: #666; font-weight: 400; }
  .seal { text-align: center; font-size: 48px; margin: 10px 0; }
  .name { font-size: 32px; text-align: center; font-weight: 600; color: #0b3a7a; margin: 20px 0 6px; border-bottom: 1px solid #d4a24a; display: inline-block; padding: 0 40px 4px; }
  .center { text-align:center; }
  .body-txt { text-align: center; font-size: 16px; margin: 10px 40px; line-height: 1.7; }
  .score-box { text-align: center; margin: 24px 0 10px; }
  .score { font-size: 56px; font-weight: 700; color: ${passed ? "#16a34a" : "#999"}; font-family: Georgia, serif; }
  .label { font-size: 13px; color: #666; text-transform: uppercase; letter-spacing: 2px; }
  .footer { display: flex; justify-content: space-between; margin-top: 36px; align-items: flex-end; }
  .sig { text-align: center; font-size: 13px; }
  .sig-line { border-bottom: 1px solid #000; width: 220px; margin: 56px auto 6px; }
  .verif { font-family: monospace; font-size: 11px; color: #999; letter-spacing: 1px; }
  .no-print { padding: 10px 0; }
  .no-print button { padding: 8px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size: 13px; font-family: sans-serif; }
  @media print { body { background: #fff; } main { max-width: none; margin: 0; padding: 32px 40px; border-color: #c58f3a; } .no-print { display: none; } }
</style></head><body><main>
  <div class="no-print">
    <button onclick="window.print()">Cetak atau simpan PDF</button>
    <a href="/app/exams" style="margin-left:8px; font-family: sans-serif">Daftar ujian</a>
  </div>
  
  <h1>${passed ? "Sertifikat Pencapaian" : "Keterangan Ujian"}</h1>
  <h2>${esc(d.school_name)} · ${esc(d.level)}</h2>
  <p class="body-txt">Diberikan kepada:</p>
  <div class="center"><span class="name">${esc(d.student_name)}</span></div>
  <p class="body-txt">
    atas keikutsertaannya dalam ujian <b>${esc(d.exam_title)}</b> (${esc(d.kind)})
    ${d.class_name ? `kelas <b>${esc(d.class_name)}</b>` : ""}
    pada ${new Date(d.finished_at).toLocaleDateString("id-ID", { dateStyle: "long" })}${passed ? " dengan hasil memuaskan" : ""}.
  </p>
  <div class="score-box">
    <div class="label">Nilai Akhir</div>
    <div class="score">${d.final_score ?? "-"}</div>
    <div class="label">${passed ? `KKM ${kkm} — LULUS` : `KKM ${kkm} — belum tercapai`}</div>
  </div>
  <div class="footer">
    <div class="verif">#${esc(verifCode)}</div>
    <div class="sig">
      <div>Mengetahui,</div>
      <div class="sig-line"></div>
      <div>Kepala Sekolah</div>
    </div>
  </div>
</main></body></html>`);
});

// Rapor cetak per siswa: ringkasan nilai + tanda tangan + QR verifikasi.
// Dibuka di browser Ctrl/Cmd+P Save as PDF (CSS @media print disiapkan).
pages.get("/app/students/:id/report", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const studentId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const info = await tx`
      select s.name, s.username, s.nisn, s.gender, c.name as class_name,
             sch.name as school_name, sch.level
      from students s left join classes c on c.id = s.class_id
      join schools sch on sch.id = s.school_id
      where s.id = ${studentId}`;
    if (info.length === 0) return null;
    const scores = await tx`
      select e.title, e.kind, es.finished_at, sc.final_score, sc.auto_score, sc.manual_score
      from exam_sessions es
      join exams e on e.id = es.exam_id
      left join scores sc on sc.session_id = es.id
      where es.student_id = ${studentId} and es.status = 'submitted'
      order by es.finished_at`;
    const summary = await tx`
      select coalesce(cat.name, '(tanpa kategori)') as category,
             count(*)::int as total,
             sum(case
               when q.type = 'pg'          and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'benar_salah' and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'isian'       and exists(
                 select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                 where lower(trim(x.value)) = lower(trim(a.answer->>'text'))) then 1
               when q.type = 'pgk_centang' and (
                 select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(k.answer_key->'correct') x
               ) = (
                 select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(a.answer->'selected') x
               ) then 1
               when q.type = 'menjodohkan' and a.answer->'pairs' = k.answer_key->'pairs' then 1
               when q.type = 'uraian' and (a.answer->>'manual_score')::numeric >= q.points * 0.5 then 1
               else 0 end)::int as benar
      from answers a
      join questions q on q.id = a.question_id
      join exam_sessions es on es.id = a.session_id
      left join question_keys k on k.question_id = q.id
      left join categories cat on cat.id = q.category_id
      where es.student_id = ${studentId} and es.status = 'submitted'
      group by cat.name order by cat.name`;
    return { info: info[0], scores, summary };
  });
  if (!data) return c.notFound();
  const info = data.info as {
    name: string; username: string; nisn: string | null; gender: "L"|"P"|null;
    class_name: string | null; school_name: string; level: string;
  };
  type S = { title: string; kind: string; finished_at: string; final_score: string | null;
    auto_score: string | null; manual_score: string | null };
  type C = { category: string; total: number; benar: number };
  const scores = data.scores as unknown as S[];
  const summary = data.summary as unknown as C[];
  const avg = scores.length
    ? (scores.reduce((a, b) => a + Number(b.final_score ?? 0), 0) / scores.length).toFixed(2)
    : "-";
  const scoreRows = scores.map((r, i) => `<tr>
    <td>${i + 1}</td><td>${esc(r.title)}</td><td>${esc(r.kind)}</td>
    <td>${new Date(r.finished_at).toLocaleDateString("id-ID")}</td>
    <td style="text-align:right">${r.final_score ?? "-"}</td>
  </tr>`).join("") || `<tr><td colspan="5" class="muted">Belum ada ujian.</td></tr>`;
  const catRows = summary.map((r) => {
    const pct = r.total ? Math.round((r.benar / r.total) * 100) : 0;
    return `<tr><td>${esc(r.category)}</td><td>${r.benar}/${r.total}</td><td>${pct}%</td></tr>`;
  }).join("") || `<tr><td colspan="3" class="muted">Belum ada data jawaban.</td></tr>`;

  // Build QR as a <canvas>-fallback-free SVG (minimal manual encoding). Here
  // just render a short identifier box — opsional. Kalau mau QR real,
  // integrasikan library di layer frontend; untuk MVP cukup kode verifikasi.
  const verifCode = `${studentId.slice(0, 8).toUpperCase()}-${(Date.now() % 100000).toString().padStart(5, "0")}`;

  return c.html(`<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapor — ${esc(info.name)}</title>
<style>
  :root { --fg:#000; --mut:#555; --bd:#999; --accent:#2563eb; }
  * { box-sizing: border-box; }
  body { font: 13px/1.4 system-ui, sans-serif; color: var(--fg); background: #fff; margin: 0; }
  main { max-width: 800px; margin: 24px auto; padding: 24px; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 2px solid var(--fg); padding-bottom: 2px; }
  table { width:100%; border-collapse: collapse; margin: 4px 0; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; font-size: 12px; }
  th { background: #f3f4f6; font-weight: 600; }
  .head { display:flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .meta td { padding: 2px 6px; border: none; font-size: 12px; }
  .meta td:first-child { color: var(--mut); width: 110px; }
  .sig { display:flex; justify-content: flex-end; margin-top: 32px; }
  .sig-box { width: 240px; text-align: center; font-size: 12px; }
  .sig-line { border-bottom: 1px solid #000; margin-top: 56px; }
  .foot { margin-top: 24px; font-size: 11px; color: var(--mut); }
  .verif { font-family: monospace; font-size: 11px; letter-spacing: 1px; }
  .no-print { padding: 10px 0; border-bottom: 1px dashed #ddd; margin-bottom: 10px; }
  button { padding: 8px 14px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  @media print {
    body { background: #fff; }
    main { max-width: none; margin: 0; padding: 10mm; }
    .no-print { display: none; }
    @page { size: A4; margin: 15mm; }
  }
</style></head><body><main>
  <div class="no-print">
    <button onclick="window.print()">Cetak atau simpan PDF</button>
    <a href="/app/students/${esc(studentId)}/analytics" style="margin-left:8px">Analitik</a>
  </div>
  <div class="head">
    <div>
      <h1>Rapor Hasil Ujian</h1>
      <div style="font-size:12px;color:var(--mut)">${esc(info.school_name)} · ${esc(info.level)}</div>
    </div>
    <div style="text-align:right;font-size:12px">
      <div>${new Date().toLocaleDateString("id-ID", { dateStyle: "long" })}</div>
      <div class="verif">#${esc(verifCode)}</div>
    </div>
  </div>
  <h2>Identitas Siswa</h2>
  <table class="meta">
    <tr><td>Nama</td><td><b>${esc(info.name)}</b></td></tr>
    <tr><td>Username</td><td><code>${esc(info.username)}</code></td></tr>
    <tr><td>NISN</td><td>${esc(info.nisn ?? "-")}</td></tr>
    <tr><td>Kelas</td><td>${esc(info.class_name ?? "-")}</td></tr>
    <tr><td>Jenis Kelamin</td><td>${info.gender === "L" ? "Laki-laki" : info.gender === "P" ? "Perempuan" : "-"}</td></tr>
  </table>
  <h2>Nilai Ujian</h2>
  <table>
    <thead><tr><th>No</th><th>Judul</th><th>Jenis</th><th>Tanggal</th><th style="text-align:right">Nilai</th></tr></thead>
    <tbody>${scoreRows}</tbody>
    <tfoot><tr><th colspan="4" style="text-align:right">Rata-rata</th><th style="text-align:right">${avg}</th></tr></tfoot>
  </table>
  <h2>Pencapaian per Kategori</h2>
  <table>
    <thead><tr><th>Kategori</th><th>Benar / Total</th><th>Persen</th></tr></thead>
    <tbody>${catRows}</tbody>
  </table>
  <div class="sig">
    <div class="sig-box">
      <div>Mengetahui, Guru Mata Pelajaran</div>
      <div class="sig-line"></div>
      <div style="margin-top:4px">( ______________________ )</div>
    </div>
  </div>
  <div class="foot">
    Dokumen ini dicetak otomatis dari CBT Yuk pada ${new Date().toLocaleString("id-ID")}.
    Kode verifikasi: <span class="verif">${esc(verifCode)}</span>.
  </div>
</main></body></html>`);
});

// Analitik seorang siswa: tren nilai + persen benar per kategori.
pages.get("/app/students/:id/analytics", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const studentId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const info = await tx`select name, username from students where id = ${studentId}`;
    if (info.length === 0) return null;
    const timeline = await tx`
      select e.title, es.finished_at, sc.final_score
      from exam_sessions es
      join exams e on e.id = es.exam_id
      left join scores sc on sc.session_id = es.id
      where es.student_id = ${studentId} and es.status = 'submitted'
      order by es.finished_at`;
    const byCat = await tx`
      select coalesce(cat.name, '(tanpa kategori)') as category,
             count(*)::int as total,
             sum(case
               when q.type = 'pg'          and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'benar_salah' and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'isian'       and exists(
                 select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                 where lower(trim(x.value)) = lower(trim(a.answer->>'text'))) then 1
               when q.type = 'pgk_centang' and (
                 select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(k.answer_key->'correct') x
               ) = (
                 select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(a.answer->'selected') x
               ) then 1
               when q.type = 'menjodohkan' and a.answer->'pairs' = k.answer_key->'pairs' then 1
               when q.type = 'uraian' and (a.answer->>'manual_score')::numeric >= q.points * 0.5 then 1
               else 0 end)::int as benar
      from answers a
      join questions q on q.id = a.question_id
      join exam_sessions es on es.id = a.session_id
      left join question_keys k on k.question_id = q.id
      left join categories cat on cat.id = q.category_id
      where es.student_id = ${studentId} and es.status = 'submitted'
      group by cat.name order by cat.name`;
    return { info: info[0], timeline, byCat };
  });
  if (!data) return c.notFound();
  const info = data.info as { name: string; username: string };
  type T = { title: string; finished_at: string; final_score: string | null };
  type C = { category: string; total: number; benar: number };
  const tl = data.timeline as unknown as T[];
  const by = data.byCat as unknown as C[];
  // Build an SVG line chart manually (no external libs).
  const w = 640, h = 220, pad = 28;
  const scores = tl.map((r) => Number(r.final_score ?? 0));
  const pts = scores.map((v, i) => {
    const x = pad + (scores.length === 1 ? (w - 2*pad)/2 : (w - 2*pad) * i / (scores.length - 1));
    const y = h - pad - (h - 2*pad) * (v / 100);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const dots = scores.map((v, i) => {
    const x = pad + (scores.length === 1 ? (w - 2*pad)/2 : (w - 2*pad) * i / (scores.length - 1));
    const y = h - pad - (h - 2*pad) * (v / 100);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#2563eb"/>`;
  }).join("");
  const grid = [0, 25, 50, 75, 100].map((v) => {
    const y = h - pad - (h - 2*pad) * (v / 100);
    return `<line x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}" stroke="var(--bd)" stroke-dasharray="2,3"/>
      <text x="4" y="${y+3}" fill="var(--mut)" font-size="10">${v}</text>`;
  }).join("");
  const chart = scores.length
    ? `<svg viewBox="0 0 ${w} ${h}" style="width:100%; max-width:${w}px; display:block">
         ${grid}
         <polyline fill="none" stroke="#2563eb" stroke-width="2" points="${pts}"/>
         ${dots}
       </svg>`
    : `<p class="muted">Belum ada ujian yang diselesaikan.</p>`;

  const catBars = by.map((r) => {
    const pct = r.total ? Math.round((r.benar / r.total) * 100) : 0;
    const color = pct >= 75 ? "#16a34a" : (pct >= 50 ? "#eab308" : "#ef4444");
    return `<div style="margin:8px 0">
      <div class="row" style="justify-content:space-between;margin:0 0 4px"><span>${esc(r.category)}</span><span class="muted">${r.benar}/${r.total} (${pct}%)</span></div>
      <div style="background:var(--bg);border:1px solid var(--bd);border-radius:6px;overflow:hidden;height:12px">
        <div style="height:100%;width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
  }).join("") || `<p class="muted">Belum ada jawaban terekam.</p>`;

  return c.html(base(`Analitik — ${info.name}`, `
    <div class="card">
      <h1>${esc(info.name)}</h1>
      <p class="sub"><code>${esc(info.username)}</code> · <a href="/app">Dashboard</a> · <a href="/app/students/${esc(studentId)}/report">Rapor cetak</a></p>
    </div>
    <div class="card">
      <h2>Tren nilai akhir</h2>
      ${chart}
    </div>
    <div class="card">
      <h2>Kelemahan per kategori</h2>
      <p class="muted">Persen jawaban benar dari seluruh ujian yang diselesaikan.</p>
      ${catBars}
    </div>
  `, { role: sess.role }));
});

pages.get("/app/restore", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  if (sess.role !== "admin") return c.html(base("Restore", `<div class="card"><p class="err">Hanya admin.</p><a class="btn" href="/app">Dashboard</a></div>`, { role: sess.role }));
  return c.html(base("Restore backup", `
    <div class="card">
      <h1>Restore backup JSON</h1>
      <p class="sub"><a href="/app">Dashboard</a></p>
      <p class="muted">Upload file <code>backup-*.json</code> hasil ekspor. Sekolah baru akan dibuat dengan kode yang Anda tentukan di bawah; ID lama di-remap. Data operasional (sesi/jawaban/skor) <b>tidak</b> ikut.</p>
      <form id="f">
        <label>Kode sekolah baru <span class="muted">(3–32 huruf kecil/digit/strip, belum terpakai)</span></label>
        <input name="code" required pattern="[a-z0-9\\-]{3,32}" placeholder="sma-copy-1">
        <label>File backup.json</label>
        <input type="file" id="file" accept=".json,application/json" required>
        <div class="row"><button class="primary" type="submit">Restore</button></div>
        <p class="err" id="err" hidden></p>
        <pre id="out" style="margin-top:10px; background:var(--bg); padding:10px; border-radius:8px; font-size:12px; max-height:200px; overflow:auto" hidden></pre>
      </form>
    </div>
  `) + `<script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('err'); err.hidden = true;
      const out = document.getElementById('out'); out.hidden = true;
      const code = e.target.code.value.trim().toLowerCase();
      const file = document.getElementById('file').files[0];
      if (!file) return;
      const text = await file.text();
      const r = await fetch('/api/reports/restore?code=' + encodeURIComponent(code), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: text,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { out.hidden = false; out.textContent = JSON.stringify(j, null, 2); }
      else { err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false; }
    });
  </script>`);
});

pages.get("/app/bulk", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  if (sess.role !== "admin") return c.html(base("Bulk", `<div class="card"><p class="err">Hanya admin.</p><a class="btn" href="/app">Dashboard</a></div>`, { role: sess.role }));
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [classes, exams] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const cl = await tx`select id, name from classes order by name`;
    const ex = await tx`select e.id, e.title,
      (select count(*) from exam_sessions where exam_id = e.id) as sess_count
      from exams e order by e.created_at desc`;
    return [cl, ex] as const;
  });
  type Cl = { id: string; name: string };
  type Ex = { id: string; title: string; sess_count: string };
  const classOpts = (classes as unknown as Cl[]).map((cl) => `<option value="${esc(cl.id)}">${esc(cl.name)}</option>`).join("");
  const examOpts = (exams as unknown as Ex[]).map((e) => `<option value="${esc(e.id)}">${esc(e.title)} (${e.sess_count} sesi)</option>`).join("");
  return c.html(base("Bulk operasi", `
    <div class="card">
      <h1>Operasi massal</h1>
      <p class="sub"><a href="/app">Dashboard</a></p>
    </div>
    <div class="card">
      <h2>Reset PIN sekelas</h2>
      <p class="muted">Generate PIN baru 6-digit untuk setiap siswa aktif di kelas yang dipilih. Daftar ditampilkan sekali untuk dicetak.</p>
      <label>Kelas</label>
      <select id="classSel"><option value="">— pilih kelas —</option>${classOpts}</select>
      <div class="row" style="margin-top:8px"><button class="primary" id="runResetPin">Reset PIN sekelas</button></div>
      <pre id="pinOut" hidden style="margin-top:10px; padding:10px; border:1px solid var(--bd); border-radius:8px; background:var(--bg); font-size:12px; max-height:300px; overflow:auto"></pre>
    </div>
    <div class="card">
      <h2>Hapus semua sesi di satu ujian</h2>
      <p class="muted err">Peringatan: ini menghapus semua sesi + jawaban + skor ujian. Berguna untuk ujian ulang total.</p>
      <label>Ujian</label>
      <select id="examSel"><option value="">— pilih ujian —</option>${examOpts}</select>
      <div class="row" style="margin-top:8px"><button class="danger" id="runWipe">Hapus semua sesi</button></div>
    </div>
    <div class="card">
      <h2>Archive ujian lama</h2>
      <p class="muted">Set status 'closed' untuk semua ujian open/scheduled yang lebih tua dari N hari.</p>
      <label>Lebih tua dari (hari)</label>
      <input id="archDays" type="number" min="1" max="365" value="30">
      <div class="row" style="margin-top:8px"><button class="primary" id="runArchive">Archive sekarang</button></div>
    </div>
    <script>
      document.getElementById('runResetPin').addEventListener('click', async () => {
        const id = document.getElementById('classSel').value;
        if (!id) { alert('Pilih kelas dulu'); return; }
        if (!confirm('Reset PIN semua siswa kelas ini?')) return;
        const r = await fetch('/api/classes/' + id + '/reset-pins', { method:'POST', credentials:'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { alert(j.error || r.status); return; }
        const out = document.getElementById('pinOut');
        out.hidden = false;
        out.textContent = j.students.map((s) => s.username.padEnd(20) + s.name.padEnd(28) + ' PIN: ' + s.pin).join('\\n');
      });
      document.getElementById('runWipe').addEventListener('click', async () => {
        const id = document.getElementById('examSel').value;
        if (!id) { alert('Pilih ujian dulu'); return; }
        if (!confirm('BENAR-BENAR hapus semua sesi + jawaban + skor ujian ini? Tidak bisa dibatalkan.')) return;
        const r = await fetch('/api/exams/' + id + '/wipe-sessions', { method:'POST', credentials:'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (r.ok) alert(j.deleted + ' sesi dihapus.'); else alert(j.error || r.status);
      });
      document.getElementById('runArchive').addEventListener('click', async () => {
        const days = parseInt(document.getElementById('archDays').value, 10) || 30;
        if (!confirm('Archive semua ujian open/scheduled > ' + days + ' hari lalu?')) return;
        const r = await fetch('/api/exams/bulk-archive', { method:'POST', credentials:'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ older_than_days: days }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) alert(j.archived + ' ujian di-archive.'); else alert(j.error || r.status);
      });
    </script>
  `, { role: sess.role }));
});

pages.get("/app/audit", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  if (sess.role !== "admin") return c.html(base("Audit", `<div class="card"><p class="err">Hanya admin.</p><a class="btn" href="/app">Dashboard</a></div>`, { role: sess.role }));
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select id, actor_email, actor_role, action, entity, entity_id, details, created_at
       from audit_log order by created_at desc limit 200`,
  );
  type R = { id: string; actor_email: string | null; actor_role: string | null;
    action: string; entity: string | null; entity_id: string | null;
    details: Record<string, unknown> | null; created_at: string };
  const list = (rows as unknown as R[]).map((r) => `<tr>
    <td class="muted" style="white-space:nowrap">${new Date(r.created_at).toLocaleString("id-ID")}</td>
    <td>${esc(r.actor_email ?? "(sistem)")}<br><span class="muted">${esc(r.actor_role ?? "")}</span></td>
    <td><span class="pill">${esc(r.action)}</span></td>
    <td>${esc(r.entity ?? "-")}${r.entity_id ? `<br><code style="font-size:11px">${esc(r.entity_id.slice(0, 8))}…</code>` : ""}</td>
    <td class="muted" style="font-size:12px">${esc(r.details ? JSON.stringify(r.details) : "-")}</td>
  </tr>`).join("") || `<tr><td colspan="5" class="muted">Belum ada aktivitas tercatat.</td></tr>`;
  return c.html(base("Audit log", `
    <div class="card">
      <h1>Audit log</h1>
      <p class="sub"><a href="/app">Dashboard</a> · 200 aktivitas terbaru.</p>
    </div>
    <div class="card">
      <table style="width:100%; border-collapse:collapse">
        <thead><tr><th>Waktu</th><th>Pelaku</th><th>Aksi</th><th>Entitas</th><th>Detail</th></tr></thead>
        <tbody>${list}</tbody>
      </table>
    </div>
  `, { role: sess.role }));
});

pages.get("/app/users", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  if (sess.role !== "admin") return c.html(base("Staf", `<div class="card"><p class="err">Hanya admin yang boleh melihat halaman ini.</p><a class="btn" href="/app">Dashboard</a></div>`, { role: sess.role }));
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
      <p class="sub"><a href="/app">Dashboard</a></p>
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
  `, { role: sess.role }));
});

// Bacaan untuk reading comprehension — satu bacaan dapat dirujuk banyak soal.
// Bank soal publik: pilih kategori publish siapa saja bisa unduh JSON-nya
// via URL unik /public/banks/<slug>.
pages.get("/app/shared-banks", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  if (sess.role !== "admin") return c.html(base("Bank publik", `<div class="card"><p class="err">Hanya admin.</p><a class="btn" href="/app">Dashboard</a></div>`, { role: sess.role }));
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [banks, categories] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const b = await tx`select id, slug, title, description, download_count,
                              jsonb_array_length(payload->'questions') as question_count,
                              created_at from shared_banks order by created_at desc`;
    const c = await tx`select id, name from categories order by name`;
    return [b, c] as const;
  });
  type B = { id: string; slug: string; title: string; description: string | null;
    download_count: number; question_count: number; created_at: string };
  type C = { id: string; name: string };
  const list = (banks as unknown as B[]).map((b) => `<tr>
    <td><a href="/public/banks/${esc(b.slug)}" target="_blank"><b>${esc(b.title)}</b></a><br>
        <code style="font-size:12px">${esc(b.slug)}</code>
        ${b.description ? `<br><span class="muted">${esc(b.description)}</span>` : ""}</td>
    <td>${b.question_count}</td>
    <td>${b.download_count}</td>
    <td style="text-align:right"><button class="danger" data-del="${esc(b.id)}">Hapus</button></td>
  </tr>`).join("") || `<tr><td colspan="4" class="muted">Belum ada bank yang dipublikasikan.</td></tr>`;
  const catOpts = (categories as unknown as C[]).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  return c.html(base("Bank publik", `
    <div class="card">
      <h1>Bank soal publik</h1>
      <p class="sub"><a href="/app">Dashboard</a> · siapa saja bisa unduh via URL slug tanpa login.</p>
      <form id="fsb">
        <div class="grid">
          <div><label>Judul</label><input name="title" required placeholder="Bank Matematika SMA kelas X"></div>
          <div><label>Slug (URL)</label><input name="slug" required pattern="[a-z0-9\\-]{3,64}" placeholder="matematika-sma-x"></div>
          <div><label>Kategori <span class="muted">(opsional; semua jika kosong)</span></label>
            <select name="category_id"><option value="">— semua soal —</option>${catOpts}</select>
          </div>
        </div>
        <label>Deskripsi</label><input name="description">
        <div class="row"><button class="primary" type="submit">Publikasikan</button></div>
        <p class="err" id="err" hidden></p>
      </form>
    </div>
    <div class="card">
      <table><thead><tr><th>Bank</th><th>Soal</th><th>Unduhan</th><th></th></tr></thead>
        <tbody id="tb">${list}</tbody>
      </table>
    </div>
    <script>
      document.getElementById('fsb').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('err'); err.hidden = true;
        const d = Object.fromEntries(new FormData(e.target));
        d.category_id = d.category_id || null;
        const r = await fetch('/api/shared-banks', { method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify(d) });
        if (r.ok) location.reload();
        else { const j = await r.json().catch(() => ({})); err.textContent = j.error || 'HTTP '+r.status; err.hidden = false; }
      });
      document.getElementById('tb').addEventListener('click', async (e) => {
        const id = e.target.dataset.del; if (!id) return;
        if (!confirm('Hapus bank publik ini?')) return;
        const r = await fetch('/api/shared-banks/' + id, { method:'DELETE', credentials:'same-origin' });
        if (r.ok) location.reload(); else alert('Gagal: ' + r.status);
      });
    </script>
  `, { role: sess.role }));
});

pages.get("/app/passages", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select p.id, p.title, p.body,
              (select count(*) from questions q where q.passage_id = p.id) as qc
       from passages p order by p.title nulls last`,
  );
  type P = { id: string; title: string | null; body: string; qc: string };
  const list = (rows as unknown as P[]).map((p) => `<tr>
    <td><b>${esc(p.title ?? "(tanpa judul)")}</b><br><span class="muted">${esc(p.body.slice(0, 140))}${p.body.length > 140 ? "…" : ""}</span></td>
    <td>${p.qc} soal</td>
    <td style="text-align:right"><button class="danger" data-del="${esc(p.id)}">Hapus</button></td>
  </tr>`).join("") || `<tr><td colspan="3" class="muted">Belum ada bacaan.</td></tr>`;
  return c.html(base("Bacaan", `
    <div class="card">
      <h1>Bacaan (reading comprehension)</h1>
      <p class="sub"><a href="/app/questions">Bank soal</a></p>
      <form id="fp">
        <label>Judul (opsional)</label>
        <input name="title" placeholder="Kutipan sejarah proklamasi">
        <label>Teks bacaan</label>
        <textarea name="body" required rows="6" style="width:100%;padding:10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit"></textarea>
        <div class="row"><button class="primary" type="submit">Simpan bacaan</button></div>
        <p class="err" id="err" hidden></p>
      </form>
    </div>
    <div class="card">
      <table><thead><tr><th>Bacaan</th><th>Soal</th><th></th></tr></thead>
        <tbody id="tb">${list}</tbody></table>
    </div>
    <script>
      document.getElementById('fp').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('err'); err.hidden = true;
        const d = Object.fromEntries(new FormData(e.target));
        const r = await fetch('/api/passages', { method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify(d) });
        if (r.ok) location.reload();
        else { const j = await r.json().catch(() => ({})); err.textContent = j.error || 'HTTP '+r.status; err.hidden = false; }
      });
      document.getElementById('tb').addEventListener('click', async (e) => {
        const id = e.target.dataset.del; if (!id) return;
        if (!confirm('Hapus bacaan? Soal yang pakai bacaan ini akan jadi tanpa bacaan.')) return;
        const r = await fetch('/api/passages/' + id, { method:'DELETE', credentials:'same-origin' });
        if (r.ok) location.reload(); else alert('Gagal: ' + r.status);
      });
    </script>
  `, { role: sess.role }));
});

// Lab komputer mode: guru pilih siswa yang hadir, klik mulai sesi
// dibuat untuk mereka semua. Siswa cukup login + buka /s, sesi sudah
// terdaftar jadi tinggal 'Lanjutkan'.
pages.get("/app/exams/:id/lab", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const ex = await tx`select title, status, kind from exams where id = ${examId}`;
    if (ex.length === 0) return null;
    const assignedClasses = await tx`select class_id from exam_classes where exam_id = ${examId}`;
    const classIds = (assignedClasses as unknown as Array<{ class_id: string }>).map((x) => x.class_id);
    const students = classIds.length
      ? await tx`select s.id, s.name, s.username, c.name as class_name,
                        es.id as session_id, es.status as session_status
                 from students s
                 left join classes c on c.id = s.class_id
                 left join exam_sessions es on es.exam_id = ${examId} and es.student_id = s.id
                 where s.class_id in ${tx(classIds)} and s.active
                 order by s.name`
      : [];
    return { ex: ex[0], students };
  });
  if (!data) return c.notFound();
  const ex = data.ex as { title: string; status: string; kind: string };
  type R = { id: string; name: string; username: string; class_name: string | null;
    session_id: string | null; session_status: string | null };
  const studs = data.students as unknown as R[];
  const rows = studs.map((s) => `<tr>
    <td><input type="checkbox" class="pick" value="${esc(s.id)}" ${s.session_id ? "disabled" : ""}></td>
    <td>${esc(s.name)}</td>
    <td><code style="font-size:12px">${esc(s.username)}</code></td>
    <td>${esc(s.class_name ?? "-")}</td>
    <td>${s.session_status ? `<span class="pill ${esc(s.session_status)}">${esc(s.session_status)}</span>` : `<span class="muted">belum mulai</span>`}</td>
  </tr>`).join("") || `<tr><td colspan="5" class="muted">Belum ada siswa di kelas yang ditugaskan.</td></tr>`;
  return c.html(base(`Lab — ${ex.title}`, `
    <div class="card">
      <h1>Lab komputer</h1>
      <p class="sub">${esc(ex.title)} · <a href="/app/exams/${esc(examId)}">Detail ujian</a></p>
      ${ex.status !== "open" ? `<p class="err">Ujian masih <b>${esc(ex.status)}</b>. Buka ujian terlebih dahulu agar lab-start berfungsi.</p>` : ""}
      <p class="muted">Centang siswa yang hadir di depan komputer, lalu klik <b>Mulai sesi untuk yang dicentang</b>. Sesi mereka langsung dibuat (deadline = sekarang + durasi). Siswa cukup login dan klik 'Lanjutkan'.</p>
    </div>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <label><input type="checkbox" id="selAll"> Pilih semua yang belum mulai</label>
        <button class="primary" id="start" ${ex.status !== "open" ? "disabled" : ""}>Mulai sesi untuk yang dicentang</button>
      </div>
      <table style="width:100%; border-collapse:collapse">
        <thead><tr><th></th><th>Siswa</th><th>Username</th><th>Kelas</th><th>Status sesi</th></tr></thead>
        <tbody id="tb">${rows}</tbody>
      </table>
      <p class="err" id="err" hidden></p>
    </div>
    <script>
      document.getElementById('selAll').addEventListener('change', (e) => {
        document.querySelectorAll('input.pick').forEach((x) => { if (!x.disabled) x.checked = e.target.checked; });
      });
      document.getElementById('start').addEventListener('click', async () => {
        const err = document.getElementById('err'); err.hidden = true;
        const ids = [...document.querySelectorAll('input.pick:checked')].map((x) => x.value);
        if (ids.length === 0) { err.textContent = 'Belum ada siswa dicentang.'; err.hidden = false; return; }
        if (!confirm('Mulai sesi untuk ' + ids.length + ' siswa?')) return;
        const r = await fetch('/api/exams/${esc(examId)}/lab-start', {
          method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ student_ids: ids }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { alert(j.created + ' sesi dibuat, ' + j.skipped + ' dilewati (sudah ada).'); location.reload(); }
        else { err.textContent = j.error || 'HTTP ' + r.status; err.hidden = false; }
      });
    </script>
  `, { role: sess.role }));
});

// Analytics guru per ujian: distractor + top kata di chat.
pages.get("/app/exams/:id/insights", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [ex, distractors, chatSummary] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const e = await tx`select title from exams where id = ${examId}`;
    const d = await distractorRows(tx, examId);
    const chat = await tx`select m.content, m.from_role, st.name as student_name, m.created_at
                           from exam_messages m
                           join exam_sessions es on es.id = m.session_id
                           join students st on st.id = es.student_id
                           where es.exam_id = ${examId} and m.from_role = 'student'
                           order by m.created_at desc limit 50`;
    return [e[0], d, chat] as const;
  });
  if (!ex) return c.notFound();
  type D = { id: string; text: string; options: string[]; correct_index: number;
    total_answered: number; distribution: Record<string, number> };
  const items = (distractors as unknown as D[]).map((q) => {
    const total = q.total_answered;
    const bars = q.options.map((opt, idx) => {
      const n = q.distribution[String(idx)] ?? 0;
      const pct = total > 0 ? Math.round((n / total) * 100) : 0;
      const isCorrect = idx === q.correct_index;
      const color = isCorrect ? "#16a34a" : (pct > 30 ? "#eab308" : "#94a3b8");
      return `<div style="margin:4px 0">
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span>${String.fromCharCode(65 + idx)}. ${esc(opt)}${isCorrect ? " ✓" : ""}</span>
          <span>${n} (${pct}%)</span>
        </div>
        <div style="background:var(--bg);border:1px solid var(--bd);border-radius:4px;height:10px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
    }).join("");
    return `<div class="card">
      <p style="margin:0 0 4px"><b>${esc(q.text)}</b> <span class="muted">(${total} jawaban)</span></p>
      ${bars}
    </div>`;
  }).join("") || `<div class="card"><p class="muted">Belum cukup data (butuh ≥1 sesi submitted dengan soal pg).</p></div>`;

  // Chat topic: naive word frequency, buang stopword.
  type M = { content: string; student_name: string; created_at: string };
  const stop = new Set(["yang","dan","di","ini","itu","ke","dari","untuk","dengan","ada","saya","pak","bu","soal","jawab"]);
  const freq = new Map<string, number>();
  for (const m of chatSummary as unknown as M[]) {
    for (const w of m.content.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/)) {
      if (w.length >= 4 && !stop.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const topWords = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const wordsHtml = topWords.length
    ? topWords.map(([w, n]) => `<span class="pill" style="font-size:${12 + Math.min(n, 8)}px; margin:2px">${esc(w)} <span class="muted">×${n}</span></span>`).join(" ")
    : `<p class="muted">Belum ada pesan siswa.</p>`;
  const recentMsgs = (chatSummary as unknown as M[]).slice(0, 10).map((m) => `<li>
    <b>${esc(m.student_name)}:</b> ${esc(m.content.slice(0, 140))}
    <span class="muted" style="font-size:11px">· ${new Date(m.created_at).toLocaleTimeString("id-ID")}</span>
  </li>`).join("");

  return c.html(base(`Insights — ${(ex as { title: string }).title}`, `
    <div class="card">
      <h1>Insights ujian</h1>
      <p class="sub">${esc((ex as { title: string }).title)} · <a href="/app/exams/${esc(examId)}">Detail ujian</a></p>
    </div>
    <div class="card">
      <h2>Distractor analysis</h2>
      <p class="muted">Opsi yang jadi "jebakan" paling kuat (kuning: &gt; 30% siswa memilih). Hijau = kunci jawaban.</p>
    </div>
    ${items}
    <div class="card">
      <h2>Topik di chat siswa</h2>
      <p class="muted">Kata-kata yang paling sering muncul di pertanyaan siswa selama ujian.</p>
      <div style="margin:10px 0; line-height: 2.5">${wordsHtml}</div>
      ${recentMsgs ? `<h3 style="font-size:14px;margin:16px 0 6px">10 pesan terbaru</h3><ol style="margin:0 0 0 20px; font-size:13px">${recentMsgs}</ol>` : ""}
    </div>
  `, { role: sess.role }));
});

// Statistik butir soal (item analysis) per ujian.
pages.get("/app/exams/:id/items", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [ex, items] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => {
    const e = await tx`select title from exams where id = ${examId}`;
    const i = await itemRows(tx, examId);
    return [e[0], i] as const;
  });
  if (!ex) return c.notFound();
  type R = { id: string; type: string; text: string; n: number; p_value: string; discrimination: string };
  const items2 = items as unknown as R[];
  const rows = items2.map((r) => {
    const p = parseFloat(r.p_value); const d = parseFloat(r.discrimination);
    const pTag = p >= 0.3 && p <= 0.7 ? "ok" : p < 0.3 ? "sulit" : "mudah";
    const dLabel = d >= 0.4 ? "sangat baik" : d >= 0.3 ? "baik" : d >= 0.2 ? "cukup" : d >= 0 ? "jelek" : "terbalik";
    const dColor = d >= 0.4 ? "#16a34a" : d >= 0.3 ? "#2563eb" : d >= 0.2 ? "#eab308" : "#ef4444";
    const pColor = pTag === "ok" ? "#16a34a" : pTag === "sulit" ? "#ef4444" : "#eab308";
    return `<tr>
      <td style="max-width:380px"><span class="pill">${esc(r.type)}</span> ${esc(r.text)}</td>
      <td style="text-align:right">${r.n}</td>
      <td style="text-align:right"><span style="color:${pColor}">${r.p_value}</span><br><span class="muted" style="font-size:11px">${esc(pTag)}</span></td>
      <td style="text-align:right"><span style="color:${dColor}">${r.discrimination}</span><br><span class="muted" style="font-size:11px">${esc(dLabel)}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">Belum cukup data. Minimal 4 sesi submitted untuk kelompok atas/bawah.</td></tr>`;
  return c.html(base(`Analisis butir — ${(ex as { title: string }).title}`, `
    <div class="card">
      <h1>Analisis butir soal</h1>
      <p class="sub">${esc((ex as { title: string }).title)} · <a href="/app/exams/${esc(examId)}">Detail ujian</a></p>
      <p class="muted">
        <b>p-value</b> = proporsi siswa menjawab benar (ideal 0.3–0.7).<br>
        <b>Daya pembeda (D)</b> = benar kelompok atas 25% − benar kelompok bawah 25%
        (≥0.4 sangat baik, 0.3–0.4 baik, 0.2–0.3 cukup, &lt;0.2 jelek, negatif terbalik).
      </p>
    </div>
    <div class="card">
      <table style="width:100%; border-collapse:collapse">
        <thead><tr><th>Soal</th><th style="text-align:right">N</th><th style="text-align:right">p-value</th><th style="text-align:right">D</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `, { role: sess.role }));
});

// Live monitoring untuk guru/admin: refresh otomatis tiap 3 detik.
pages.get("/app/exams/:id/live", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const ex = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, (tx) =>
    tx`select title from exams where id = ${examId}`,
  );
  if ((ex as unknown as unknown[]).length === 0) return c.notFound();
  const title = (ex[0] as { title: string }).title;
  return c.html(base(`Live — ${title}`, `
    <div class="card">
      <h1>Live monitoring</h1>
      <p class="sub">${esc(title)} · <a href="/app/exams/${esc(examId)}">Detail ujian</a> · <span id="t" class="muted"></span></p>
    </div>
    <div class="card">
      <table style="width:100%; border-collapse:collapse">
        <thead><tr><th>Siswa</th><th>Status</th><th>Kemajuan</th><th>Pelanggaran</th><th>Sinyal</th><th></th></tr></thead>
        <tbody id="tb"><tr><td colspan="6" class="muted">Memuat…</td></tr></tbody>
      </table>
    </div>
    <div class="card">
      <h2>Chat masuk</h2>
      <div id="chats"><p class="muted">Memuat…</p></div>
    </div>
    <!-- Panel chat per sesi -->
    <dialog id="chatDlg" style="max-width:420px; width:92%;">
      <h3 id="chatTitle" style="margin:0 0 8px"></h3>
      <div id="chatBox2" style="max-height:300px; overflow-y:auto; padding:8px; border:1px solid var(--bd); border-radius:6px; background:var(--bg); margin-bottom:8px"></div>
      <form id="chatForm2" style="display:flex; gap:6px">
        <input id="chatInput2" placeholder="Balas…" maxlength="500" style="flex:1; padding:8px 12px; border:1px solid var(--bd); border-radius:6px; background:var(--bg); color:var(--fg); font:inherit">
        <button class="primary">Kirim</button>
        <button type="button" id="chatCloseDlg">Tutup</button>
      </form>
    </dialog>
    <script>
      const EID = ${JSON.stringify(examId)};
      const tb = document.getElementById('tb');
      const t = document.getElementById('t');
      function timeAgo(iso) {
        if (!iso) return '—';
        const s = Math.floor((Date.now() - new Date(iso).getTime())/1000);
        if (s < 60) return s + ' dtk lalu';
        if (s < 3600) return Math.floor(s/60) + ' mnt lalu';
        return Math.floor(s/3600) + ' jam lalu';
      }
      function dot(iso) {
        if (!iso) return '<span style="color:var(--mut)">○</span>';
        const s = (Date.now() - new Date(iso).getTime())/1000;
        const color = s < 30 ? 'var(--ok,#16a34a)' : (s < 120 ? '#eab308' : 'var(--danger)');
        return '<span style="color:' + color + '">●</span>';
      }
      async function tick() {
        try {
          const r = await fetch('/api/exams/' + EID + '/live', { credentials:'same-origin' });
          if (!r.ok) throw new Error(r.status);
          const d = await r.json();
          t.textContent = 'Terakhir diperbarui ' + new Date().toLocaleTimeString('id-ID');
          if (d.length === 0) { tb.innerHTML = '<tr><td colspan="5" class="muted">Belum ada peserta.</td></tr>'; return; }
          tb.innerHTML = d.map((r) => {
            const pct = r.total > 0 ? Math.round(r.answered * 100 / r.total) : 0;
            const vio = r.violation_count ? '<span style="color:var(--danger)"><b>' + r.violation_count + '</b></span>' : '0';
            const bar = '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:4px;height:8px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:#2563eb"></div></div>';
            return '<tr><td><b>' + escapeHtml(r.student_name) + '</b><br><span class="muted">' + escapeHtml(r.class_name || '-') + '</span></td>'
              + '<td>' + escapeHtml(r.status) + '</td>'
              + '<td>' + r.answered + '/' + r.total + ' (' + pct + '%)' + bar + '</td>'
              + '<td>' + vio + '</td>'
              + '<td>' + dot(r.last_seen_at) + ' ' + timeAgo(r.last_seen_at) + '</td>'
              + '<td><button data-act="chat" data-sid="' + escapeHtml(r.session_id) + '" data-name="' + escapeHtml(r.student_name) + '" style="padding:4px 8px">Chat</button>'
              + (r.status === "active" ? ' <button data-act="extend" data-sid="' + escapeHtml(r.session_id) + '" style="padding:4px 8px" title="Tambah 5 menit">+5 mnt</button> <button data-act="pause" data-sid="' + escapeHtml(r.session_id) + '" style="padding:4px 8px" title="Jeda atau lanjutkan">Jeda</button> <button data-act="submit" data-sid="' + escapeHtml(r.session_id) + '" style="padding:4px 8px" title="Kumpulkan paksa">Kumpulkan</button>' : "")
              + '</td></tr>';
          }).join('');
        } catch (e) { t.textContent = 'Gagal memuat: ' + e; }
      }
      // Satu listener untuk semua tombol aksi: nama siswa tidak pernah masuk ke kode JS.
      document.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-act]'); if (!b) return;
        const sid = b.dataset.sid, act = b.dataset.act;
        if (act === 'chat') openChat(sid, b.dataset.name);
        else if (act === 'extend') extend(sid);
        else if (act === 'pause') pauseResume(sid);
        else if (act === 'submit') forceSubmit(sid);
      });
      function escapeHtml(s){return (s||'').replace(/[&<>\"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);}
      tick(); setInterval(tick, 3000);

      // Chat panel
      const chatDlg = document.getElementById('chatDlg');
      const chatBox2 = document.getElementById('chatBox2');
      const chatInput2 = document.getElementById('chatInput2');
      const chatTitle = document.getElementById('chatTitle');
      let activeSid = null;
      document.getElementById('chatCloseDlg').onclick = () => chatDlg.close();
      async function openChat(sid, name) {
        activeSid = sid; chatTitle.textContent = 'Chat — ' + name;
        await loadChat(); chatDlg.showModal();
      }
      async function loadChat() {
        if (!activeSid) return;
        const r = await fetch('/api/sessions/' + activeSid + '/messages', { credentials:'same-origin' });
        if (!r.ok) return;
        const msgs = await r.json();
        chatBox2.innerHTML = msgs.map((m) => {
          const align = m.from_role === 'staff' ? 'right' : 'left';
          const bg = m.from_role === 'staff' ? '#2563eb' : 'var(--bd)';
          const fg = m.from_role === 'staff' ? '#fff' : 'var(--fg)';
          return '<div style="text-align:' + align + '; margin:4px 2px"><span style="display:inline-block;padding:4px 10px;border-radius:10px;background:' + bg + ';color:' + fg + ';max-width:260px;text-align:left;font-size:13px"><b style="font-size:11px">' + escapeHtml(m.from_name || m.from_role) + '</b><br>' + escapeHtml(m.content) + '</span></div>';
        }).join('');
        chatBox2.scrollTop = chatBox2.scrollHeight;
      }
      document.getElementById('chatForm2').addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = chatInput2.value.trim(); if (!content || !activeSid) return;
        chatInput2.value = '';
        await fetch('/api/sessions/' + activeSid + '/messages', {
          method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ content }),
        });
        await loadChat();
      });
      async function pollChats() {
        try {
          const r = await fetch('/api/exams/' + EID + '/chats', { credentials:'same-origin' });
          if (!r.ok) return;
          const d = await r.json();
          const el = document.getElementById('chats');
          if (d.length === 0) { el.innerHTML = '<p class="muted">Belum ada chat.</p>'; }
          else {
            el.innerHTML = d.map((c) => '<div style="padding:8px; border-bottom:1px solid var(--bd); cursor:pointer" data-act="chat" data-sid="' + escapeHtml(c.session_id) + '" data-name="' + escapeHtml(c.student_name) + '"><b>' + escapeHtml(c.student_name) + '</b> <span class="muted">· ' + c.msg_count + ' pesan · ' + (c.last_from === 'student' ? '' : '') + 'terakhir ' + new Date(c.last_at).toLocaleTimeString('id-ID') + '</span><br><span class="muted" style="font-size:13px">' + escapeHtml((c.last_msg || '').slice(0, 80)) + '</span></div>').join('');
          }
          if (activeSid) await loadChat();
        } catch(_){}
      }
      window.openChat = openChat;
      pollChats(); setInterval(pollChats, 5000);

      // Override timer siswa individual.
      window.extend = async (sid) => {
        const r = await fetch('/api/sessions/' + sid + '/extend', {
          method:'POST', credentials:'same-origin',
          headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ minutes: 5 }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) tick(); else alert(j.error || r.status);
      };
      window.pauseResume = async (sid) => {
        // Coba pause dulu; kalau 404 (sudah pause), resume.
        let r = await fetch('/api/sessions/' + sid + '/pause', { method:'POST', credentials:'same-origin' });
        if (r.status === 404) r = await fetch('/api/sessions/' + sid + '/resume', { method:'POST', credentials:'same-origin' });
        if (r.ok) tick(); else { const j = await r.json().catch(() => ({})); alert(j.error || r.status); }
      };
      window.forceSubmit = async (sid) => {
        if (!confirm('Paksa submit sesi ini sekarang?')) return;
        const r = await fetch('/api/sessions/' + sid + '/force-submit', { method:'POST', credentials:'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (r.ok) tick(); else alert(j.error || r.status);
      };
    </script>
  `, { role: sess.role }));
});

pages.get("/app/categories", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
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
      <p class="sub"><a href="/app/questions">Bank soal</a></p>
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
  `, { role: sess.role }));
});

// Penilaian manual untuk soal uraian dalam satu sesi.
pages.get("/app/sessions/:sid/grade", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
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
      select q.id, q.type, q.content, q.points, k.rubric, a.answer
      from exam_questions eq
      join questions q on q.id = eq.question_id
      left join question_keys k on k.question_id = q.id
      left join answers a on a.session_id = ${sessionId} and a.question_id = q.id
      where eq.exam_id = (select exam_id from exam_sessions where id = ${sessionId})
        and q.type in ('uraian','simulasi') order by eq.position`;
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
      <p class="sub">Ujian: ${esc(info.title)} · Kelas: ${esc(info.class_name ?? "-")} · <a href="/app/exams/${esc(info.exam_id)}">Kembali</a></p>
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
  `, { role: sess.role }));
});

pages.get("/app/questions", async (c) => {
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.redirect("/");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const [qs, cats] = await withTenant(sql, { schoolId: sess.sid, role: sess.role, userId: sess.uid }, async (tx) => [
    await tx`select q.id, q.type, q.content - 'image' - 'audio' - 'html' as content, q.content ? 'image' as has_image,
                    q.points, q.category_id, k.answer_key
             from questions q left join question_keys k on k.question_id = q.id
             order by q.created_at desc limit 1000`,
    await tx`select id, name from categories order by name`,
  ] as const);
  const data = JSON.stringify({ qs, cats, canDelete: sess.role === "admin" }).replace(/</g, "\\u003c");
  return c.html(base("Bank soal", `
    <div class="page-head">
      <div><h1>Bank soal</h1><p id="qsum">Semua soal sekolah Anda. Pakai ulang di ujian mana pun.</p></div>
      <div class="row" style="margin:0">
        <button type="button" id="btnUp">Upload soal</button>
        <button type="button" class="primary" id="btnNew">+ Tulis soal</button>
      </div>
    </div>
    <div class="qbar">
      <input type="search" id="fq" placeholder="Cari teks soal…" aria-label="Cari soal">
      <select id="ft" aria-label="Tipe"><option value="">Semua tipe</option></select>
      <select id="fc" aria-label="Kategori"><option value="">Semua kategori</option></select>
    </div>
    <div id="qlist"></div>

    <dialog id="ed" class="sheet" aria-labelledby="edTitle">
      <form id="ef" method="dialog">
        <div class="sheet-head"><h2 id="edTitle">Tulis soal</h2><button type="button" class="x" id="edX" aria-label="Tutup">✕</button></div>
        <div class="sheet-body">
          <p class="err" id="edWarn" hidden></p>
          <label>Tipe soal</label>
          <div class="seg" id="seg"></div>
          <label for="eText">Pertanyaan</label>
          <textarea id="eText" rows="4" placeholder="Tulis pertanyaan. Rumus matematika ditulis di antara tanda $, mis. $\\frac{1}{2}$"></textarea>
          <div class="imgrow">
            <label class="btn" style="margin:0">Tambah gambar<input type="file" id="eImg" accept="image/*" hidden></label>
            <img id="eImgPrev" alt="" hidden><button type="button" class="danger" id="eImgDel" hidden>Hapus gambar</button>
          </div>
          <div id="eBody"></div>
          <div class="grid" style="margin-top:4px">
            <div><label for="ePts">Poin</label><input id="ePts" type="number" min="0" step="0.5" value="1"></div>
            <div><label for="eCat">Kategori / mapel</label><input id="eCat" list="catList" placeholder="mis. Matematika"><datalist id="catList"></datalist></div>
          </div>
        </div>
        <div class="sheet-foot"><button type="button" id="edCancel">Batal</button><span class="spacer"></span><button type="submit" class="primary" id="edSave">Simpan soal</button></div>
      </form>
    </dialog>

    <dialog id="up" class="sheet" aria-labelledby="upTitle">
      <div class="sheet-head"><h2 id="upTitle">Upload soal</h2><button type="button" class="x" id="upX" aria-label="Tutup">✕</button></div>
      <div class="sheet-body">
        <div id="upDoc">
          <p class="hint" style="margin-top:10px">Unggah naskah soal yang biasa Anda ketik. Tulis dengan pola seperti ini:</p>
          <pre class="sample">1. Ibu kota Indonesia adalah …
A. Bandung
B. Jakarta
C. Surabaya
D. Medan
Jawaban: B

2. Jelaskan proses fotosintesis.</pre>
          <ul class="howto">
            <li>Soal bernomor, pilihan diawali A–E. Pilihan boleh sebaris: <i>A. 3 B. 4 C. 5</i>.</li>
            <li>Kunci: tulis <b>Jawaban: B</b> di bawah soal, atau kumpulkan di akhir: <b>Kunci Jawaban: 1. B 2. C …</b></li>
            <li>Dua huruf atau lebih (A, C) jadi PG kompleks. Benar/Salah, teks isian, dan soal tanpa pilihan (uraian) juga dikenali.</li>
            <li>Gambar dan rumus di dokumen belum ikut terbaca. Tambahkan lewat tombol Edit setelah disimpan.</li>
          </ul>
          <label class="btn primary" style="margin:6px 0 0">Pilih file Word atau PDF<input type="file" id="upDocFile" accept=".docx,.pdf" hidden></label>
        </div>
        <div id="upPrev"></div>
      </div>
      <div class="sheet-foot"><button type="button" id="upCancel">Batal</button><span class="spacer"></span><button type="button" class="primary" id="upGo" disabled>Simpan soal</button></div>
    </dialog>

    <style>
      .qbar { display:grid; grid-template-columns: 1fr 180px 200px; gap: 8px; margin-bottom: 14px; }
      @media (max-width: 640px) { .qbar { grid-template-columns: 1fr 1fr; } .qbar input { grid-column: 1 / -1; } }
      .qc { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px; margin-bottom: 10px; box-shadow: var(--shadow); }
      .qc-top { display:flex; gap: 8px; align-items:center; flex-wrap: wrap; margin-bottom: 8px; }
      .qc-top .sp { flex: 1; }
      .qc-top button { min-height: 36px; padding: 4px 12px; font-size: 13px; }
      .qc p { margin: 0 0 8px; }
      .qc ul { list-style:none; padding: 0; margin: 0; display:grid; gap: 4px; }
      .qc li { font-size: 14px; color: var(--mut); display:flex; gap: 8px; }
      .qc li b { width: 20px; flex: 0 0 auto; }
      .qc li.ok { color: var(--ok); font-weight: 600; }
      .tpill { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--soft); color: var(--brand); }
      .empty-q { text-align:center; padding: 40px 16px; color: var(--mut); background: var(--surface); border: 1.5px dashed var(--line); border-radius: 18px; }
      dialog.sheet { max-width: 680px; width: calc(100% - 16px); padding: 0; max-height: calc(100dvh - 24px); }
      dialog.sheet[open] { display:flex; flex-direction:column; }
      dialog.sheet form { display:flex; flex-direction:column; min-height: 0; flex: 1; }
      .sheet-head { display:flex; justify-content:space-between; align-items:center; padding: 16px 20px; border-bottom: 1px solid var(--line); }
      .sheet-head h2 { margin: 0; }
      .sheet-head .x { min-height: 40px; min-width: 40px; padding: 0; border: none; box-shadow:none; }
      .sheet-body { padding: 8px 20px 18px; overflow-y: auto; flex: 1; }
      .sheet-foot { display:flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--line); background: var(--surface); }
      .sheet-foot .spacer { flex: 1; }
      .seg { display:flex; flex-wrap: wrap; gap: 6px; }
      .seg button { min-height: 38px; padding: 6px 12px; font-size: 13.5px; border-radius: 999px; }
      .seg button[aria-pressed="true"] { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
      .imgrow { display:flex; gap: 10px; align-items:center; margin-top: 8px; flex-wrap: wrap; }
      .imgrow img { max-height: 80px; border-radius: 10px; border: 1px solid var(--line); }
      .orow { display:grid; grid-template-columns: 40px 1fr 40px; gap: 8px; align-items:center; margin: 8px 0; }
      .orow .mark { width: 40px; height: 40px; border-radius: 50%; border: 2px solid var(--line); display:grid; place-items:center; font-weight: 800; cursor:pointer; background: var(--surface); padding: 0; min-height: 0; }
      .orow .mark[aria-pressed="true"] { background: var(--ok); border-color: var(--ok); color: #fff; }
      .orow.pgk .mark { border-radius: 10px; }
      .orow .rm, .mrow .rm { min-height: 40px; padding: 0; border: none; box-shadow: none; color: var(--mut); }
      .mrow { display:grid; grid-template-columns: 1fr 24px 1fr 40px; gap: 8px; align-items:center; margin: 8px 0; }
      .hint { font-size: 13px; color: var(--mut); margin: 4px 0 0; }
      .sample { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; font: 13px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; margin: 6px 0; }
      .howto { padding-left: 20px; color: var(--mut); font-size: 14px; } .howto li { margin: 6px 0; }
      .uprev { max-height: 300px; overflow: auto; border: 1px solid var(--line); border-radius: 12px; margin-top: 14px; }
      .uprev table { margin: 0; font-size: 13px; } .uprev td.bad { color: var(--danger); }
    </style>
    <script>
      const D = ${data};
      const TYPES = [['pg','Pilihan ganda'],['pgk_centang','PG kompleks'],['benar_salah','Benar / Salah'],['isian','Isian singkat'],['uraian','Uraian'],['menjodohkan','Menjodohkan']];
      const TL = Object.fromEntries(TYPES.concat([['simulasi','Simulasi'],['dinamis_hitung','Hitung dinamis'],['pgk_kategori','Kategori']]));
      const CAT = Object.fromEntries(D.cats.map((c) => [c.id, c.name]));
      const L = 'ABCDEF';
      const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      const $ = (id) => document.getElementById(id);
      const math = (el) => { if (window.renderMathInElement) renderMathInElement(el, { delimiters: [{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}], throwOnError: false }); };
      TYPES.forEach(([k, v]) => $('ft').insertAdjacentHTML('beforeend', '<option value="' + k + '">' + v + '</option>'));
      D.cats.forEach((c) => { $('fc').insertAdjacentHTML('beforeend', '<option value="' + c.id + '">' + esc(c.name) + '</option>'); $('catList').insertAdjacentHTML('beforeend', '<option value="' + esc(c.name) + '">'); });

      function keyView(q) {
        const k = q.answer_key || {}, o = q.content.options || [];
        if (q.type === 'pg' || q.type === 'benar_salah') return '<ul>' + o.map((x, j) => '<li class="' + (k.index === j ? 'ok' : '') + '"><b>' + L[j] + '.</b><span>' + esc(x) + '</span></li>').join('') + '</ul>';
        if (q.type === 'pgk_centang') return '<ul>' + o.map((x, j) => '<li class="' + ((k.correct || []).includes(j) ? 'ok' : '') + '"><b>' + L[j] + '.</b><span>' + esc(x) + '</span></li>').join('') + '</ul>';
        if (q.type === 'isian') return '<ul><li class="ok"><b>✓</b><span>' + esc((k.accepted || []).join(' / ')) + '</span></li></ul>';
        if (q.type === 'menjodohkan') return '<ul>' + (k.pairs || []).map(([a, b]) => '<li><b>' + (a + 1) + '.</b><span>' + esc(q.content.left[a]) + ' → ' + esc(q.content.right[b]) + '</span></li>').join('') + '</ul>';
        if (q.type === 'uraian') return '<p class="hint">Dinilai manual oleh guru.</p>';
        return '';
      }
      function draw() {
        const t = $('fq').value.trim().toLowerCase(), ty = $('ft').value, ca = $('fc').value;
        const v = D.qs.filter((q) => (!ty || q.type === ty) && (!ca || q.category_id === ca) && (!t || (q.content.text || '').toLowerCase().includes(t)));
        $('qsum').textContent = D.qs.length + ' soal' + (v.length !== D.qs.length ? ' · ' + v.length + ' tampil' : '') + '. Pakai ulang di ujian mana pun.';
        $('qlist').innerHTML = v.length ? v.map((q) =>
          '<article class="qc"><div class="qc-top"><span class="tpill">' + esc(TL[q.type] || q.type) + '</span><span class="muted">' + (+q.points) + ' poin' + (q.category_id && CAT[q.category_id] ? ' · ' + esc(CAT[q.category_id]) : '') + (q.has_image ? ' · bergambar' : '') + '</span><span class="sp"></span>' +
          (TYPES.some(([k]) => k === q.type) ? '<button type="button" data-ed="' + q.id + '">Edit</button>' : '') +
          (D.canDelete ? '<button type="button" class="danger" data-del="' + q.id + '">Hapus</button>' : '') + '</div>' +
          '<p>' + esc(q.content.text || '(tanpa teks)') + '</p>' + keyView(q) + '</article>').join('')
          : '<div class="empty-q">' + (D.qs.length ? 'Tidak ada soal yang cocok.' : '<b>Bank soal masih kosong.</b><br>Mulai dengan <b>+ Tulis soal</b> atau <b>Upload soal</b> (Word, PDF, Excel).') + '</div>';
        math($('qlist'));
      }
      ['fq','ft','fc'].forEach((id) => $(id).addEventListener('input', draw));
      draw();

      // ===== Editor =====
      const ed = $('ed'); let cur = null; let img = undefined;
      function seg(type) {
        $('seg').innerHTML = TYPES.map(([k, v]) => '<button type="button" data-t="' + k + '" aria-pressed="' + (k === type) + '">' + v + '</button>').join('');
      }
      function optRows(opts, marks, multi) {
        return '<label>Pilihan jawaban <span class="muted">(ketuk huruf untuk menandai yang benar)</span></label><div id="opts">' +
          opts.map((o, j) => '<div class="orow' + (multi ? ' pgk' : '') + '"><button type="button" class="mark" aria-pressed="' + marks.includes(j) + '" aria-label="Tandai benar">' + L[j] + '</button><input value="' + esc(o) + '" placeholder="Pilihan ' + L[j] + '"><button type="button" class="rm" aria-label="Hapus pilihan">✕</button></div>').join('') +
          '</div>' + (opts.length < 6 ? '<button type="button" id="addOpt" style="margin-top:4px">+ Tambah pilihan</button>' : '');
      }
      function body(type, k, ct) {
        const b = $('eBody'); k = k || {}; ct = ct || {};
        if (type === 'pg') b.innerHTML = optRows(ct.options || ['', '', '', ''], typeof k.index === 'number' ? [k.index] : [], false);
        else if (type === 'pgk_centang') b.innerHTML = optRows(ct.options || ['', '', '', ''], k.correct || [], true);
        else if (type === 'benar_salah') b.innerHTML = '<label>Jawaban benar</label><div class="seg" id="bs"><button type="button" data-v="1" aria-pressed="' + (k.index !== 1) + '">Benar</button><button type="button" data-v="0" aria-pressed="' + (k.index === 1) + '">Salah</button></div>';
        else if (type === 'isian') b.innerHTML = '<label for="eAcc">Jawaban yang diterima</label><input id="eAcc" value="' + esc((k.accepted || []).join(' | ')) + '" placeholder="mis. Surabaya | Kota Surabaya"><p class="hint">Pisahkan dengan | bila ada beberapa jawaban benar. Huruf besar/kecil tidak berpengaruh.</p>';
        else if (type === 'uraian') b.innerHTML = '<label for="eRub">Pedoman penilaian <span class="muted">(opsional)</span></label><textarea id="eRub" rows="3" placeholder="Poin penting yang harus ada di jawaban">' + esc(cur && cur.rubric || '') + '</textarea>';
        else if (type === 'menjodohkan') {
          const L2 = ct.left || ['', '', ''], pairs = k.pairs || [];
          const rows = L2.map((l, j) => { const p = pairs.find((x) => x[0] === j); return [l, p && ct.right ? ct.right[p[1]] : (ct.right || [])[j] || '']; });
          b.innerHTML = '<label>Pasangan yang benar <span class="muted">(kolom kanan diacak otomatis untuk siswa)</span></label><div id="prs">' +
            rows.map(([l, r]) => '<div class="mrow"><input value="' + esc(l) + '" placeholder="Kiri"><span class="muted">→</span><input value="' + esc(r) + '" placeholder="Kanan"><button type="button" class="rm" aria-label="Hapus pasangan">✕</button></div>').join('') +
            '</div><button type="button" id="addPr" style="margin-top:4px">+ Tambah pasangan</button>';
        }
      }
      function collect(type) {
        const ct = {};
        if (type === 'pg' || type === 'pgk_centang') {
          const rows = [...document.querySelectorAll('#opts .orow')];
          ct.options = rows.map((r) => r.querySelector('input').value.trim());
          ct.marks = rows.map((r, j) => r.querySelector('.mark').getAttribute('aria-pressed') === 'true' ? j : -1).filter((j) => j >= 0);
        }
        if (type === 'menjodohkan') {
          const rows = [...document.querySelectorAll('#prs .mrow')].map((r) => [...r.querySelectorAll('input')].map((x) => x.value.trim()));
          ct.left = rows.map((r) => r[0]); ct.right = rows.map((r) => r[1]);
        }
        return ct;
      }
      $('eBody').addEventListener('click', (e) => {
        const t = e.target, type = $('seg').querySelector('[aria-pressed="true"]').dataset.t;
        if (t.classList.contains('mark')) {
          if (type === 'pg') document.querySelectorAll('#opts .mark').forEach((m) => m.setAttribute('aria-pressed', String(m === t)));
          else t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true'));
        } else if (t.id === 'addOpt' || (t.classList.contains('rm') && t.closest('.orow'))) {
          const c = collect(type);
          if (t.id === 'addOpt') c.options.push('');
          else { const j = [...document.querySelectorAll('#opts .orow')].indexOf(t.closest('.orow')); if (c.options.length <= 2) return; c.options.splice(j, 1); c.marks = c.marks.filter((m) => m !== j).map((m) => m > j ? m - 1 : m); }
          $('eBody').innerHTML = optRows(c.options, c.marks, type === 'pgk_centang');
        } else if (t.id === 'addPr') {
          $('prs').insertAdjacentHTML('beforeend', '<div class="mrow"><input placeholder="Kiri"><span class="muted">→</span><input placeholder="Kanan"><button type="button" class="rm" aria-label="Hapus pasangan">✕</button></div>');
        } else if (t.classList.contains('rm') && t.closest('.mrow')) {
          if (document.querySelectorAll('#prs .mrow').length > 2) t.closest('.mrow').remove();
        } else if (t.dataset.v !== undefined && t.closest('#bs')) {
          document.querySelectorAll('#bs button').forEach((m) => m.setAttribute('aria-pressed', String(m === t)));
        }
      });
      $('seg').addEventListener('click', (e) => {
        const t = e.target.dataset.t; if (!t) return;
        const prevType = $('seg').querySelector('[aria-pressed="true"]').dataset.t, prev = collect(prevType);
        seg(t);
        const keep = (t === 'pg' || t === 'pgk_centang') && prev.options ? { options: prev.options } : {};
        body(t, {}, keep);
      });
      function showImg(src) { const p = $('eImgPrev'); p.hidden = !src; $('eImgDel').hidden = !src; if (src) p.src = src; }
      $('eImg').addEventListener('change', (e) => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        if (f.size > 290000) { alert('Gambar terlalu besar. Maksimal sekitar 290 KB.'); return; }
        const rd = new FileReader(); rd.onload = () => { img = rd.result; showImg(img); }; rd.readAsDataURL(f);
      });
      $('eImgDel').onclick = () => { img = ''; showImg(''); };
      async function openEd(id) {
        $('edWarn').hidden = true; img = undefined; cur = null;
        let q = { type: 'pg', content: { text: '' }, answer_key: {}, points: 1, category_id: null };
        if (id) {
          const r = await fetch('/api/questions/' + id, { credentials: 'same-origin' });
          if (!r.ok) { alert('Gagal memuat soal.'); return; }
          q = cur = await r.json();
          if (q.live_exams) { $('edWarn').textContent = 'Soal ini dipakai ' + q.live_exams + ' ujian yang sedang dibuka/terjadwal. Perubahan langsung berlaku di ujian tersebut.'; $('edWarn').hidden = false; }
        }
        $('edTitle').textContent = id ? 'Edit soal' : 'Tulis soal';
        seg(q.type); body(q.type, q.answer_key, q.content);
        $('eText').value = q.content.text || ''; $('ePts').value = +q.points || 1;
        $('eCat').value = q.category_id && CAT[q.category_id] ? CAT[q.category_id] : '';
        showImg(q.content.image || '');
        ed.showModal(); $('eText').focus();
      }
      $('btnNew').onclick = () => openEd(null);
      $('qlist').addEventListener('click', async (e) => {
        if (e.target.dataset.ed) openEd(e.target.dataset.ed);
        if (e.target.dataset.del) {
          if (!confirm('Hapus soal ini? Soal juga hilang dari ujian yang memakainya.')) return;
          const r = await fetch('/api/questions/' + e.target.dataset.del, { method: 'DELETE', credentials: 'same-origin' });
          if (r.ok) { D.qs = D.qs.filter((q) => q.id !== e.target.dataset.del); draw(); } else alert('Gagal menghapus.');
        }
      });
      ['edX', 'edCancel'].forEach((id) => $(id).onclick = () => ed.close());
      async function catId(name) {
        name = name.trim(); if (!name) return null;
        const hit = D.cats.find((c) => c.name.toLowerCase() === name.toLowerCase()); if (hit) return hit.id;
        const r = await fetch('/api/categories', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        const j = await r.json().catch(() => ({})); if (!r.ok || !j.id) throw new Error(j.error || 'Gagal membuat kategori');
        D.cats.push({ id: j.id, name }); CAT[j.id] = name; return j.id;
      }
      $('ef').addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = $('seg').querySelector('[aria-pressed="true"]').dataset.t, c = collect(type);
        const b = { type, text: $('eText').value.trim(), points: +$('ePts').value || 1 };
        if (img !== undefined) b.image = img;
        if (type === 'pg' || type === 'pgk_centang') {
          const keep = c.options.map((o, j) => [o, j]).filter(([o]) => o);
          b.options = keep.map(([o]) => o);
          const idx = c.marks.map((m) => keep.findIndex(([, j]) => j === m)).filter((m) => m >= 0);
          if (type === 'pg') b.correct = idx[0]; else b.correct_indexes = idx;
          if (!idx.length) { alert('Tandai jawaban yang benar (ketuk huruf di kiri pilihan).'); return; }
        }
        if (type === 'benar_salah') b.correct = document.querySelector('#bs [aria-pressed="true"]').dataset.v === '1';
        if (type === 'isian') b.accepted = $('eAcc').value.split('|').map((x) => x.trim()).filter(Boolean);
        if (type === 'uraian') b.rubric = $('eRub').value.trim();
        if (type === 'menjodohkan') { const rows = c.left.map((l, j) => [l, c.right[j]]).filter(([l, r]) => l && r); b.left = rows.map((r) => r[0]); b.right = rows.map((r) => r[1]); }
        const btn = $('edSave'); btn.disabled = true;
        try {
          b.category_id = await catId($('eCat').value);
          const r = await fetch(cur ? '/api/questions/' + cur.id : '/api/questions', { method: cur ? 'PATCH' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
          location.reload();
        } catch (x) { alert('Gagal menyimpan: ' + x.message); btn.disabled = false; }
      });

      // ===== Upload Excel =====
      const up = $('up'); let rows = []; let lastText = [];
      $('btnUp').onclick = () => { $('upPrev').innerHTML = ''; $('upGo').disabled = true; up.showModal(); };
      ['upX', 'upCancel'].forEach((id) => $(id).onclick = () => up.close());
      // ===== Word / PDF: ambil teks, lalu kenali pola "1. soal / A. pilihan / Jawaban: B" =====
      const loadJs = (src, test) => test() ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Gagal memuat pembaca file. Periksa koneksi.')); document.head.appendChild(s); });
      // .docx dibaca langsung (zip + XML) supaya penomoran otomatis Word ikut terbaca:
      // level 1 jadi "1.", "2.", level berhuruf jadi "A.", "B.".
      async function docxLines(buf) {
        await loadJs('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', () => window.JSZip);
        const zip = await window.JSZip.loadAsync(buf);
        const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const xml = async (name) => { const f = zip.file(name); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
        const all = (el, tag) => [...el.getElementsByTagNameNS(W, tag)];
        const at = (el, a) => el ? el.getAttributeNS(W, a) || el.getAttribute('w:' + a) : null;
        const docX = await xml('word/document.xml'); if (!docX) throw new Error('Bukan file Word (.docx) yang valid.');
        const numX = await xml('word/numbering.xml'), stX = await xml('word/styles.xml');
        const fmt = {};
        if (numX) {
          const abs = {};
          all(numX, 'abstractNum').forEach((a) => { const m = {}; all(a, 'lvl').forEach((l) => { m[at(l, 'ilvl')] = at(all(l, 'numFmt')[0], 'val'); }); abs[at(a, 'abstractNumId')] = m; });
          all(numX, 'num').forEach((n) => { fmt[at(n, 'numId')] = abs[at(all(n, 'abstractNumId')[0], 'val')] || {}; });
        }
        const styleNum = {};
        if (stX) all(stX, 'style').forEach((st) => { const np = all(st, 'numPr')[0]; if (np) styleNum[at(st, 'styleId')] = [at(all(np, 'numId')[0], 'val'), at(all(np, 'ilvl')[0], 'val') || '0']; });
        const cnt = {}, out = [];
        for (const p of all(docX, 'p')) {
          const text = all(p, 't').map((t) => t.textContent).join('');
          let numId = null, ilvl = '0';
          const np = all(p, 'numPr')[0];
          if (np) { numId = at(all(np, 'numId')[0], 'val'); ilvl = at(all(np, 'ilvl')[0], 'val') || '0'; }
          if (!numId) { const ps = all(p, 'pStyle')[0]; const sn = ps && styleNum[at(ps, 'val')]; if (sn) { numId = sn[0]; if (!np) ilvl = sn[1]; } }
          let pre = '';
          if (numId && numId !== '0' && text.trim()) {
            const c = cnt[numId] = cnt[numId] || {}; c[ilvl] = (c[ilvl] || 0) + 1;
            Object.keys(c).forEach((k) => { if (+k > +ilvl) c[k] = 0; });
            const f = (fmt[numId] || {})[ilvl] || (ilvl === '0' ? 'decimal' : 'lowerLetter');
            pre = /letter/i.test(f) ? L[(c[ilvl] - 1) % 6] + '. ' : f === 'bullet' || f === 'none' ? '' : c[ilvl] + '. ';
          }
          out.push(pre + text);
        }
        return out;
      }
      async function pdfLines(buf) {
        const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
        await loadJs(base + 'pdf.min.js', () => window.pdfjsLib);
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const out = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const items = (await (await pdf.getPage(n)).getTextContent()).items.filter((it) => it.str.trim());
          let y = null, line = '';
          for (const it of items) {
            const iy = Math.round(it.transform[5]);
            if (y !== null && Math.abs(iy - y) > 3) { out.push(line); line = ''; }
            line += (line && !line.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str; y = iy;
          }
          if (line) out.push(line);
        }
        return out;
      }
      function parseLines(raw) {
        let lines = raw.join('\\n').replace(/[\\r\\u200b\\ufeff]/g, '').split('\\n').map((l) => l.replace(/\\s+/g, ' ').trim()).filter(Boolean);
        lastText = lines;
        // Pilihan sebaris ("A. 3  B. 4  C. 5", juga menempel di baris soal) dipecah per baris.
        lines = lines.flatMap((l) => {
          const lower = /^\\(?[a-e]\\s*[.)]\\s/.test(l) && /\\s\\(?[b-e]\\s*[.)]\\s/.test(l);
          const upper = (l.match(/(^|\\s)\\(?[A-E]\\s*[.)]\\s/g) || []).length >= 2;
          return lower ? l.split(/\\s+(?=\\(?[b-e]\\s*[.)]\\s)/) : upper ? l.split(/\\s+(?=\\(?[A-E]\\s*[.)]\\s)/) : [l];
        });
        // Kunci jawaban di akhir dokumen: "Kunci Jawaban" lalu "1. B 2. C ...".
        const keyMap = {};
        const ki = lines.findIndex((l) => /^kunci(\\s+jawaban)?\\s*:?\\s*$/i.test(l) || /^kunci(\\s+jawaban)?\\s*:?\\s*1\\s*[.)\\-:]/i.test(l));
        if (ki >= 0) {
          const tail = lines.splice(ki).join(' ').replace(/^kunci(\\s+jawaban)?\\s*:?/i, ' ');
          for (const m of tail.matchAll(/(\\d+)\\s*[.)\\-:=]?\\s*([A-Ea-e](?:\\s*,\\s*[A-Ea-e])*|benar|salah)\\b/gi)) keyMap[+m[1]] = m[2];
        }
        const qs = []; let cur = null;
        for (const l of lines) {
          let m;
          if ((m = l.match(/^(?:no\\.?|nomor|soal)?\\s*(\\d{1,3})\\s*[.):\\-](?:\\s+(.*)|$)/i))) {
            m[2] = m[2] || '';
            cur = { no: +m[1], text: m[2], opts: [], ans: '' }; qs.push(cur); continue;
          }
          if (!cur) continue;
          if ((m = l.match(/^\\(?([A-Ea-e])\\s*[.):]\\s+(.+)$/))) { cur.opts.push(m[2]); continue; }
          if ((m = l.match(/^(jawaban|kunci|jawab|jwb|ans)\\s*[:=]\\s*(.+)$/i))) { cur.ans = m[2].trim(); continue; }
          if (cur.opts.length) cur.opts[cur.opts.length - 1] += ' ' + l; else cur.text = (cur.text + ' ' + l).trim();
        }
        return qs.map((c, j) => {
          const ans = (c.ans || keyMap[c.no] || keyMap[j + 1] || '').trim();
          const q = { row: j + 1, text: c.text.trim(), points: 1 };
          if (c.opts.length >= 2) {
            const letters = ans.toUpperCase().split(/[\\s,;]+/).filter((x) => /^[A-E]$/.test(x)).map((x) => L.indexOf(x));
            q.options = c.opts;
            if (!letters.length) { q.type = 'pg'; return [q, 'Kunci jawaban belum ada']; }
            if (letters.some((x) => x >= c.opts.length)) { q.type = 'pg'; return [q, 'Kunci di luar pilihan']; }
            if (letters.length > 1) { q.type = 'pgk_centang'; q.correct_indexes = letters; } else { q.type = 'pg'; q.correct = letters[0]; }
            return [q, ''];
          }
          if (/^(benar|salah)$/i.test(ans)) { q.type = 'benar_salah'; q.correct = /^benar$/i.test(ans); return [q, '']; }
          if (ans) { q.type = 'isian'; q.accepted = ans.split('|').map((x) => x.trim()).filter(Boolean); return [q, '']; }
          q.type = 'uraian'; return [q, ''];
        });
      }
      function showParsed(parsed, unit) {
        rows = parsed.filter(([, err]) => !err).map(([q]) => q);
        const bad = parsed.filter(([, err]) => err);
        $('upPrev').innerHTML = parsed.length ? '<p style="margin:14px 0 0"><b>' + rows.length + ' soal siap disimpan</b>' + (bad.length ? ' · <span class="err" style="margin:0">' + bad.length + ' bermasalah (dilewati)</span>' : '') + '</p>' +
          '<div class="uprev"><table><thead><tr><th>' + unit + '</th><th>Tipe</th><th>Soal</th><th>Status</th></tr></thead><tbody>' +
          parsed.map(([q, err]) => '<tr><td>' + q.row + '</td><td>' + esc(TL[q.type] || '?') + '</td><td>' + esc(q.text.slice(0, 70)) + (q.options ? '<br><span class="muted">' + q.options.length + ' pilihan</span>' : '') + '</td><td class="' + (err ? 'bad' : '') + '">' + (err ? esc(err) : '✓') + '</td></tr>').join('') + '</tbody></table></div>'
          : '<p class="err">Tidak ada soal yang dikenali. Pastikan soal bernomor (1. 2. 3.) dan pilihan diawali A. B. C.</p>' +
            (lastText.length ? '<details open><summary>Teks yang terbaca dari file (' + lastText.length + ' baris)</summary><pre class="sample">' + esc(lastText.slice(0, 40).join('\\n')) + '</pre></details>'
              : '<p class="hint">Tidak ada teks yang bisa dibaca. Jika PDF berupa hasil scan/foto, ketik ulang di Word atau ekspor dari Word ke PDF.</p>');
        $('upGo').disabled = !rows.length;
      }
      $('upDocFile').addEventListener('change', async (e) => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        $('upPrev').innerHTML = '<p class="muted" style="margin-top:14px">Membaca ' + esc(f.name) + '…</p>';
        try {
          const buf = await f.arrayBuffer();
          const lines = /\\.pdf$/i.test(f.name) ? await pdfLines(buf) : await docxLines(buf);
          showParsed(parseLines(lines), 'No.');
        } catch (x) { $('upPrev').innerHTML = ''; alert('Gagal membaca file: ' + x.message); }
      });
      $('upGo').onclick = async () => {
        $('upGo').disabled = true;
        const r = await fetch('/api/questions/bulk', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions: rows }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { alert('Gagal: ' + (j.error || r.status)); $('upGo').disabled = false; return; }
        alert(j.ok + ' soal tersimpan.' + (j.fail && j.fail.length ? '\\n' + j.fail.length + ' gagal: ' + j.fail.slice(0, 5).map((x) => 'baris ' + x.row + ' (' + x.error + ')').join(', ') : ''));
        location.reload();
      };
    </script>
  `, { role: sess.role }));
});


pages.get("/demo", (c) => {
  const on = c.env.DEMO_LOGIN === "1";
  return c.html(base("Coba demo", `
    <style>
      .dm-head { text-align:center; padding: 28px 0 8px; }
      .dm-head h1 { font-size: clamp(30px, 4.5vw, 44px); letter-spacing: -.03em; margin: 14px 0 8px; }
      .dm-head p { color: var(--mut); margin: 0 auto; max-width: 52ch; font-size: 17px; }
      .dm { display:grid; grid-template-columns: 1fr 1fr; gap: 18px; max-width: 860px; margin: 28px auto 8px; }
      .dm form, .dm .card { margin: 0; display:flex; flex-direction:column; }
      .dm .card { padding: 26px; }
      .dm .ic { width:48px; height:48px; border-radius: 14px; background: var(--soft); color: var(--brand); display:grid; place-items:center; }
      .dm .ic svg { width: 26px; height: 26px; fill:none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .dm h2 { margin: 16px 0 6px; font-size: 20px; }
      .dm ul { margin: 6px 0 22px; padding-left: 18px; color: var(--mut); font-size: 14.5px; flex: 1; } .dm li { margin: 6px 0; }
      .dm button { width: 100%; min-height: 52px; font-size: 16px; border-radius: 14px; }
      @media (max-width: 720px) { .dm { grid-template-columns: 1fr; } }
    </style>
    <div class="top" style="display:flex;justify-content:space-between;align-items:center;padding:20px 0"><a class="brand" href="/">${LOGO}</a><a href="/" style="font-weight:600">← Beranda</a></div>
    <div class="dm-head">
      <span class="eyebrow" style="display:inline-flex;font-size:13px;font-weight:700;color:var(--brand);background:var(--soft);padding:6px 12px;border-radius:999px">Tanpa daftar, tanpa token</span>
      <h1>Mau coba sebagai siapa?</h1>
      <p>Semua data di demo adalah contoh. Silakan klik apa saja.</p>
    </div>
    ${on ? `
    <div class="dm">
      <form class="card" method="post" action="/demo/siswa">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"/></svg></span>
        <h2>Siswa</h2>
        <ul>
          <li>Langsung ke layar konfirmasi peserta seperti TKA. Nama, kelas, dan token sudah terisi.</li>
          <li>Kerjakan tryout 8 soal berbagai tipe dengan timer 15 menit.</li>
          <li>Kumpulkan dan lihat nilainya.</li>
        </ul>
        <button class="primary" type="submit">Mulai sebagai siswa</button>
      </form>
      <form class="card" method="post" action="/auth/dev-login">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M3 5h18v12H3zM8 21h8M12 17v4"/></svg></span>
        <h2>Guru / admin sekolah</h2>
        <ul>
          <li>Lihat dasbor, kelas, siswa, dan bank soal sekolah contoh.</li>
          <li>Buat ujian lewat panduan 4 langkah.</li>
          <li>Pantau siswa yang sedang mengerjakan dan lihat analisis nilai.</li>
        </ul>
        <button type="submit">Masuk sebagai admin</button>
      </form>
    </div>` : `<div class="card" style="max-width:520px;margin:28px auto;text-align:center"><p>Demo sedang dimatikan.</p></div>`}
  `, { nav: false }));
});


function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]!));
}
