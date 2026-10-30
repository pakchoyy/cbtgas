// Token warna + komponen dasar yang dipakai halaman staf (pages.ts) dan
// portal siswa (student.ts). Identitas: lembar jawaban komputer (LJK) —
// tinta navy di atas kertas, kuning pensil hanya untuk tanda yang diisi.

// Warna merek yang bisa dipilih admin sekolah di Pengaturan.
export const BRAND_COLORS: Record<string, { label: string; hex: string }> = {
  biru:   { label: "Biru",   hex: "#2563EB" },
  hijau:  { label: "Hijau",  hex: "#059669" },
  ungu:   { label: "Ungu",   hex: "#7C3AED" },
  merah:  { label: "Merah",  hex: "#E11D48" },
  oranye: { label: "Oranye", hex: "#EA580C" },
  toska:  { label: "Toska",  hex: "#0891B2" },
};
export const brandHex = (key: string | null | undefined) => (BRAND_COLORS[key ?? ""] ?? BRAND_COLORS.biru).hex;

export const APP_NAME = "CBT Yuk";

// Tahun ajar berjalan (Juli–Juni, WIB), mis. "2026/2027".
export const schoolYear = () => {
  const d = new Date(Date.now() + 7 * 3600_000), y = d.getUTCFullYear();
  return d.getUTCMonth() >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
};

const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
export const ICON_EDIT = svg("M4 20h4L19 9l-4-4L4 16zM14 6l4 4");
export const ICON_DEL = svg("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3");

// Kritik & saran langsung ke WhatsApp pengelola.
export const FEEDBACK_WA = "https://wa.me/6289530713597?text=" + encodeURIComponent("Halo CBT Yuk, saya mau kasih kritik/saran: ");

// Jenis ujian lama disimpan sebagai kode; yang baru berupa teks bebas.
const KIND_LABELS: Record<string, string> = { harian: "Ulangan harian", pts_pas: "PTS / PAS", sumatif: "Sumatif", tryout: "Tryout" };
export const kindLabel = (k: string) => KIND_LABELS[k] ?? k;

// Logo kecil (ikut warna merek sekolah lewat var(--brand)).
export const LOGO_MARK = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--brand)"/><circle cx="16" cy="16" r="9.6" fill="#fff"/><path d="M11.8 16.4l3 3 5.6-6.2" fill="none" stroke="var(--brand)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const LOGO = `${LOGO_MARK}<span>CBT <b>Yuk</b></span>`;

// Footer halaman publik + kartu "pasang aplikasi" (dipakai pages.ts dan student.ts).
export const SITE_FOOTER = `
<footer class="site-foot">
  <div class="sf-in">
    <div class="sf-brand">
      <a class="brand" href="/">${LOGO}</a>
      <p>Ujian sekolah online yang ringan untuk SD, SMP, dan SMA. Buat soal, jadwalkan, awasi, nilai keluar otomatis.</p>
    </div>
    <nav class="sf-col" aria-label="Produk"><h4>Produk</h4>
      <a href="/demo">Coba demo</a><a href="/s/login">Masuk siswa</a><a href="/auth/google/start?mode=register">Daftar sekolah</a></nav>
    <nav class="sf-col" aria-label="Bantuan"><h4>Bantuan</h4>
      <a href="${FEEDBACK_WA}" target="_blank" rel="noopener">Kritik &amp; saran (WhatsApp)</a><a href="mailto:admin@bantuguruyuk.web.id">Email kami</a><a href="/privasi">Kebijakan privasi</a><a href="/syarat">Syarat layanan</a></nav>
  </div>
  <div class="sf-bot"><span>© CBT Yuk</span><span>Dibuat untuk sekolah Indonesia</span></div>
</footer>`;

// Toast (menggantikan alert bawaan) + tombol "Pasang aplikasi". Pesan yang
// muncul tepat sebelum halaman dimuat ulang dibawa ke halaman berikutnya.
export const UI_JS = `<script>
(function () {
  let box, lastToast = null;
  function toast(msg, kind) {
    msg = String(msg ?? '');
    kind = kind || (/gagal|error|salah|tidak bisa|harus|wajib|belum/i.test(msg) ? 'err' : /berhasil|tersimpan|disimpan|dikirim|dibagikan|diimpor|dibuat/i.test(msg) ? 'ok' : 'info');
    if (!box) { box = document.createElement('div'); box.className = 'yk-toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'yk-toast ' + kind;
    t.innerHTML = '<i>' + (kind === 'ok' ? '✓' : kind === 'err' ? '!' : 'i') + '</i><span></span>'; t.querySelector('span').textContent = msg;
    box.appendChild(t);
    lastToast = { msg, kind, at: Date.now() };
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, 4200);
  }
  window.toast = toast; window.alert = (m) => toast(m);
  try { const f = JSON.parse(sessionStorage.getItem('yk_flash') || 'null'); sessionStorage.removeItem('yk_flash'); if (f) addEventListener('DOMContentLoaded', () => toast(f.msg, f.kind)); } catch (_) {}
  // Pesan hanya dibawa ke halaman berikutnya bila halaman ditinggal sesaat setelah muncul (mis. setelah simpan lalu muat ulang).
  addEventListener('pagehide', () => { if (lastToast && Date.now() - lastToast.at < 2500) try { sessionStorage.setItem('yk_flash', JSON.stringify(lastToast)); } catch (_) {} });

  // Dialog konfirmasi: await ask('Hapus soal ini?') → true / false.
  window.ask = (msg, okText) => new Promise((done) => {
    const danger = /hapus|tolak|paksa|reset|archive|arsip/i.test(msg);
    const d = document.createElement('dialog'); d.className = 'yk-ask';
    d.innerHTML = '<div class="ai ' + (danger ? 'dg' : '') + '">' + (danger ? '!' : '?') + '</div><p></p><div class="ab"><button type="button" data-v="0">Batal</button><button type="button" class="primary ' + (danger ? 'dgb' : '') + '" data-v="1"></button></div>';
    d.querySelector('p').textContent = msg;
    d.querySelector('[data-v="1"]').textContent = okText || (danger ? (/hapus/i.test(msg) ? 'Ya, hapus' : 'Ya, lanjutkan') : 'Ya');
    const end = (v) => { d.close(); d.remove(); done(v); };
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) end(b.dataset.v === '1'); else if (e.target === d) end(false); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); end(false); });
    document.body.appendChild(d); d.showModal(); d.querySelector('[data-v="1"]').focus();
  });

  // Dialog isian: await askText('Nama kategori baru', 'mis. Matematika 7') → teks atau null.
  window.askText = (msg, ph, val) => new Promise((done) => {
    const d = document.createElement('dialog'); d.className = 'yk-ask';
    d.innerHTML = '<form method="dialog"><p style="font-weight:700;color:var(--fg)"></p><input name="v" autocomplete="off" style="width:100%;margin:4px 0 16px"><div class="ab"><button type="button" data-v="0">Batal</button><button class="primary" value="1">Simpan</button></div></form>';
    d.querySelector('p').textContent = msg; const i = d.querySelector('input'); i.placeholder = ph || ''; i.value = val || '';
    const end = (v) => { d.close(); d.remove(); done(v); };
    d.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const v = i.value.trim(); if (v) end(v); else i.focus(); });
    d.addEventListener('click', (e) => { if (e.target.closest('[data-v="0"]') || e.target === d) end(null); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
    document.body.appendChild(d); d.showModal(); i.focus();
  });

  let deferred = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    let seen = false; try { seen = !!localStorage.getItem('install_dismissed'); } catch (_) {}
    if (!seen) setTimeout(() => { const c = document.getElementById('installCard'); if (c && deferred) c.hidden = false; }, 6000);
  });
  async function install() {
    const c = document.getElementById('installCard'); if (c) c.hidden = true;
    if (standalone()) return toast('CBT Yuk sudah terpasang di perangkat ini.', 'ok');
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice; deferred = null; if (r.outcome === 'accepted') toast('CBT Yuk dipasang. Buka dari layar utama.', 'ok'); return; }
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return toast('Di iPhone/iPad: ketuk tombol Bagikan di Safari, lalu pilih "Tambah ke Layar Utama".');
    toast('Buka menu browser (⋮), lalu pilih "Instal aplikasi" atau "Tambahkan ke layar utama".');
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-install]')) { e.preventDefault(); install(); }
    if (e.target.closest('#installClose')) { document.getElementById('installCard').hidden = true; try { localStorage.setItem('install_dismissed', '1'); } catch (_) {} }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
</script>`;

export const INSTALL_SHEET = `
<div id="installCard" class="install" role="dialog" aria-labelledby="installTitle" hidden>
  <img src="/icon-192.svg" alt="" width="52" height="52">
  <div class="install-txt"><b id="installTitle">Pasang CBT Yuk</b><span>Buka langsung dari layar utama, layar penuh seperti aplikasi.</span></div>
  <div class="install-act"><button type="button" id="installClose">Nanti</button><button type="button" class="primary" data-install>Pasang</button></div>
</div>`;

export const SHARED_CSS = `
  :root {
    color-scheme: light;
    --brand: #2563EB;      /* diganti per sekolah lewat /brand.css */
    --brand-ink: #FFFFFF;  /* teks di atas warna merek */
    --ink: #0F172A;
    --fg: #0F172A; --mut: #64748B;
    --paper: #F5F7FB; --surface: #FFFFFF; --line: #E4E8F0;
    --ok: #16A34A; --danger: #DC2626;
    --soft: color-mix(in srgb, var(--brand) 9%, var(--surface));
    --shadow: 0 1px 2px rgba(15,23,42,.04), 0 6px 20px rgba(15,23,42,.05);
    /* alias lama */
    --pencil: var(--brand);
    --bg: var(--paper); --card: var(--surface); --bd: var(--line); --accent: var(--brand);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --ink: #E6E9F2; --paper: #0A0F1C; --surface: #111827; --line: #1F2A40;
      --fg: #E6E9F2; --mut: #94A3B8; --ok: #34D399; --danger: #F87171;
      --soft: color-mix(in srgb, var(--brand) 18%, var(--surface));
      --shadow: 0 1px 2px rgba(0,0,0,.3);
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --ink: #E6E9F2; --paper: #0A0F1C; --surface: #111827; --line: #1F2A40;
    --fg: #E6E9F2; --mut: #94A3B8; --ok: #34D399; --danger: #F87171;
    --soft: color-mix(in srgb, var(--brand) 18%, var(--surface));
    --shadow: 0 1px 2px rgba(0,0,0,.3);
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin:0; font: 15px/1.55 "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
         color: var(--fg); background: var(--paper); font-feature-settings: "tnum" 0; }
  a { color: inherit; text-underline-offset: 3px; }
  main a:not(.btn) { color: var(--brand); text-decoration: none; font-weight: 500; }
  @media (hover: hover) { main a:not(.btn):hover { text-decoration: underline; } }
  * { -webkit-tap-highlight-color: transparent; }
  h1 { font-size: clamp(22px, 2.6vw, 28px); line-height: 1.2; letter-spacing: -.02em; font-weight: 800; margin: 0 0 6px; }
  h2 { font-size: 17px; line-height: 1.3; letter-spacing: -.01em; font-weight: 700; margin: 0 0 12px; }
  h3 { font-size: 15px; font-weight: 700; }
  p { max-width: 72ch; }
  p.sub { color: var(--mut); margin: 0 0 18px; }
  .muted { color: var(--mut); font-size: 13px; }
  .err { color: var(--danger); font-size: 14px; margin-top: 10px; font-weight: 500; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; background: var(--paper); padding: 1px 6px;
         border-radius: 6px; border: 1px solid var(--line); font-size: 12.5px; }

  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 22px 24px; margin-bottom: 16px; box-shadow: var(--shadow); }
  .card > h2:first-child, .card > h1:first-child { margin-top: 0; }

  label { display:block; font-size: 13px; font-weight: 600; color: var(--fg); margin: 14px 0 6px; }
  label .muted { font-weight: 400; }
  input, select, textarea { width:100%; min-height: 44px; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 10px;
         background: var(--surface); color: var(--fg); font: inherit; transition: border-color .15s; }
  textarea { min-height: 0; }
  input:hover, select:hover, textarea:hover { border-color: color-mix(in srgb, var(--fg) 25%, var(--line)); }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--brand); box-shadow: none; }
  @media (hover: hover) { input:focus-visible, select:focus-visible, textarea:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 14%, transparent); } }
  input[type=checkbox], input[type=radio] { width: 18px; height: 18px; min-height: 0; accent-color: var(--brand); }
  label:has(> input[type=checkbox]) { display:flex; align-items:center; gap:10px; font-weight:500; min-height:44px; margin:6px 0 0; }

  button, .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height: 42px; padding: 9px 16px;
         border-radius: 10px; border: 1.5px solid var(--line); background: var(--surface); color: var(--fg);
         font: inherit; font-size: 14px; font-weight: 600; cursor:pointer; text-decoration:none; white-space: nowrap;
         transition: background .15s, border-color .15s; }
  button > svg.bi, .btn > svg.bi { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
  button:hover, .btn:hover { border-color: color-mix(in srgb, var(--fg) 35%, var(--line)); }
  button:focus, .btn:focus, a:focus, summary:focus { outline: none; }
  @media (hover: hover) { button:focus-visible, .btn:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid color-mix(in srgb, var(--brand) 55%, transparent); outline-offset: 2px; } }
  button:active, .btn:active { transform: scale(.98); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button.primary, .btn.primary { background: var(--brand); border-color: var(--brand); color: var(--brand-ink);
         box-shadow: 0 1px 2px rgba(15,23,42,.08), 0 4px 12px color-mix(in srgb, var(--brand) 28%, transparent); }
  button.primary:hover, .btn.primary:hover { filter: brightness(1.08); }
  button.danger { color: var(--danger); background: transparent; border-color: transparent; }
  button.danger:hover { background: color-mix(in srgb, var(--danger) 9%, transparent); border-color: transparent; }
  .row { display:flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; align-items: center; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 14px; }

  table { width:100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
  th { text-align:left; color: var(--mut); font-weight: 600; font-size: 12.5px; padding: 8px 10px; border-bottom: 1.5px solid var(--line); }
  td { text-align:left; padding: 11px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  td button { min-height: 36px; padding: 6px 12px; }
  .g { width: 20px; height: 20px; flex: 0 0 auto; }
  tbody tr:hover td { background: color-mix(in srgb, var(--paper) 70%, transparent); }
  tbody tr:last-child td { border-bottom: none; }
  .card:has(> table) { overflow-x: auto; }

  .pill { display:inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600;
          background: var(--paper); color: var(--mut); border: 1px solid var(--line); }
  .pill.open, .pill.active, .pill.submitted { background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); border-color: transparent; }
  .pill.closed, .pill.locked, .pill.expired { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); border-color: transparent; }
  .pill.scheduled { background: var(--soft); color: var(--brand); border-color: transparent; }

  dialog { max-width: 460px; width: calc(100% - 28px); border: 1px solid var(--line); border-radius: 18px; background: var(--surface);
           color: var(--fg); padding: 22px; box-shadow: 0 24px 60px rgba(20,33,61,.28); }
  dialog::backdrop { background: rgba(20,33,61,.45); }

  .pick { max-height: 340px; overflow:auto; border: 1.5px solid var(--line); border-radius: 12px; padding: 4px 10px; margin: 12px 0; }
  .qpick { display:flex; gap:12px; padding: 10px 2px; border-bottom: 1px solid var(--line); align-items:flex-start; font-weight: 400; margin: 0; min-height: 44px; }
  .qpick:last-child { border-bottom: none; }
  .qpick input { margin-top: 2px; flex: 0 0 auto; }
  .optrow { display:flex; gap: 10px; align-items:center; margin: 8px 0; }
  .optrow input:not([type=radio]):not([type=checkbox]) { flex: 1; }

  /* Angka ringkasan */
  .card.stats { display:grid; grid-template-columns: repeat(5, 1fr); gap: 0; padding: 0; overflow: hidden; }
  .stat { padding: 18px 20px; border-left: 1px solid var(--line); }
  .stat:first-child { border-left: none; }
  .stat b { display:block; font-size: 26px; line-height: 1.1; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 13px; color: var(--mut); }
  .stat.live b { color: var(--ok); }
  @media (max-width: 760px) {
    .card.stats { grid-template-columns: repeat(2, 1fr); padding: 0; }
    .stat { padding: 14px 16px; }
    .stat:last-child { grid-column: 1 / -1; }
    .stat { border-left: none; border-top: 1px solid var(--line); }
    .stat:nth-child(-n+2) { border-top: none; }
    .stat:nth-child(even) { border-left: 1px solid var(--line); }
    .card { padding: 18px 16px; border-radius: 14px; }
    td, th { padding-left: 8px; padding-right: 8px; white-space: nowrap; }
  }

  /* Merek */
  .brand { display:inline-flex; align-items:center; gap:10px; color: var(--fg); text-decoration:none; font-size:18px; letter-spacing:-.02em; font-weight:600; }
  .brand b { font-weight:800; color: var(--brand); }
  .brand .logo { width:32px; height:32px; flex:0 0 auto; }

  /* Footer publik */
  .site-foot { background: #0B1220; color: #CBD5E1; margin-top: 56px; }
  .site-foot .brand { color:#fff; }
  .site-foot .brand b { color:#fff; }
  .sf-in { max-width: 1040px; margin: 0 auto; padding: 44px 20px 28px; display:grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 28px; }
  .sf-brand p { color:#94A3B8; font-size:14px; margin: 14px 0 0; max-width: 34ch; }
  .sf-col h4 { color:#fff; font-size:13px; letter-spacing:.06em; text-transform:uppercase; margin: 6px 0 12px; }
  .sf-col a { display:block; color:#CBD5E1; text-decoration:none; font-size:14px; padding: 6px 0; }
  .sf-col a:hover { color:#fff; }
  .sf-bot { max-width:1040px; margin:0 auto; padding: 16px 20px 26px; border-top: 1px solid #1E293B; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:13px; color:#64748B; }
  @media (max-width: 640px) { .sf-in { grid-template-columns: 1fr 1fr; } .sf-brand { grid-column: 1 / -1; } }

  /* Kartu folder (kategori soal, kelas) */
  .folders { display:grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; margin-bottom: 18px; }
  .folder { display:flex; align-items:center; gap: 14px; text-align:left; padding: 14px; min-height: 76px; border-radius: 18px; width: 100%;
            background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow); color: var(--fg); font-weight: 400; white-space: normal; justify-content:flex-start; }
  .folder:hover { border-color: hsl(var(--h, 217) 70% 55%); }
  .folder .fi { width: 46px; height: 46px; border-radius: 14px; flex: 0 0 auto; display:grid; place-items:center; font-weight: 800; font-size: 19px;
                background: hsl(var(--h, 217) 85% 95%); color: hsl(var(--h, 217) 65% 40%); }
  :root[data-theme="dark"] .folder .fi { background: hsl(var(--h, 217) 40% 20%); color: hsl(var(--h, 217) 80% 75%); }
  .folder .ft { flex: 1; min-width: 0; display:flex; flex-direction:column; } .folder .ft b { font-size: 15.5px; } .folder .ft span { color: var(--mut); font-size: 13px; }
  .folder .chev { color: var(--mut); font-size: 22px; }
  .folder.add { border-style: dashed; box-shadow: none; } .folder.add .fi { background: var(--soft); color: var(--brand); }
  .folder.pack button { min-height: 38px; padding: 6px 14px; font-size: 13.5px; flex: 0 0 auto; }
  .crumb { display:flex; align-items:center; gap: 10px; margin: 0 0 12px; flex-wrap: wrap; }
  .crumb button { min-height: 38px; padding: 6px 12px; font-size: 13.5px; border-radius: 999px; }
  .crumb b { font-size: 17px; }
  /* Panel dialog (sheet) */
  dialog.sheet { max-width: 680px; width: calc(100% - 16px); padding: 0; max-height: calc(100dvh - 24px); }
  dialog.sheet[open] { display:flex; flex-direction:column; }
  dialog.sheet form { display:flex; flex-direction:column; min-height: 0; flex: 1; }
  .sheet-head { display:flex; justify-content:space-between; align-items:center; padding: 16px 20px; border-bottom: 1px solid var(--line); }
  .sheet-head h2 { margin: 0; }
  .sheet-head .x { min-height: 40px; min-width: 40px; padding: 0; border: none; box-shadow:none; }
  .sheet-body { padding: 8px 20px 18px; overflow-y: auto; flex: 1; }
  .sheet-foot { display:flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--line); background: var(--surface); }
  .sheet-foot .spacer { flex: 1; }
  /* Saklar on/off */
  input.switch { appearance: none; -webkit-appearance: none; width: 48px; height: 28px; min-height: 0; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; flex: 0 0 auto; border: none; padding: 0; transition: background .15s; }
  input.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .15s; }
  input.switch:checked { background: var(--brand); } input.switch:checked::after { transform: translateX(20px); }
  .sw-row { display:flex; align-items:center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); margin: 0; font-weight: 400; min-height: 56px; cursor: pointer; }
  .sw-row > span { flex: 1; display:flex; flex-direction:column; } .sw-row small { color: var(--mut); font-size: 13px; }

  /* Tombol ikon (edit/hapus di tabel) */
  .ibtn { width: 40px; height: 40px; min-height: 40px; padding: 0; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--mut); box-shadow: none; }
  .ibtn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .ibtn:hover { color: var(--brand); border-color: var(--brand); }
  .ibtn.del:hover { color: var(--danger); border-color: var(--danger); }
  .acts { display:flex; gap: 6px; justify-content:flex-end; flex: 0 0 auto; }
  .lrows { margin-top: 10px; }
  .lrow { display:flex; align-items:center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
  .lrow:first-child { border-top: none; }
  .lrow .lt { flex: 1; min-width: 0; display:flex; flex-direction:column; }
  .lrow .lt > span { color: var(--mut); font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  main .lrow .lt a { color: var(--fg); }

  /* Toast */
  .yk-toasts { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 200; display:flex; flex-direction:column; gap: 8px;
               width: min(440px, calc(100% - 24px)); pointer-events: none; }
  .yk-toast { display:flex; gap: 12px; align-items:flex-start; padding: 13px 14px; border-radius: 16px; background: var(--surface); color: var(--fg);
              border: 1px solid var(--line); box-shadow: 0 16px 40px rgba(15,23,42,.18); font-size: 14.5px; line-height: 1.45; pointer-events: auto;
              animation: tin .22s ease-out; white-space: pre-line; }
  .yk-toast i { width: 26px; height: 26px; border-radius: 50%; flex: 0 0 auto; display:grid; place-items:center; font-style: normal; font-weight: 800; font-size: 14px; color: #fff; background: var(--brand); }
  .yk-toast.ok i { background: var(--ok); } .yk-toast.err i { background: var(--danger); }
  .yk-toast.out { opacity: 0; transform: translateY(-6px); transition: .2s; }
  @keyframes tin { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }

  /* Dialog konfirmasi */
  dialog.yk-ask { max-width: 380px; width: calc(100% - 32px); text-align: center; padding: 24px 22px 18px; border-radius: 22px; }
  dialog.yk-ask[open] { animation: tin .18s ease-out; }
  .yk-ask .ai { width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 10px; display:grid; place-items:center; font-size: 24px; font-weight: 800; background: var(--soft); color: var(--brand); }
  .yk-ask .ai.dg { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
  .yk-ask p { margin: 0 auto 18px; font-size: 16px; line-height: 1.5; color: var(--fg); }
  .yk-ask .ab { display:grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .yk-ask .ab button { min-height: 48px; }
  .yk-ask .dgb { background: var(--danger); border-color: var(--danger); color: #fff; box-shadow: none; }

  /* Kartu pasang aplikasi */
  .install { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(460px, calc(100% - 24px)); z-index: 70;
             display:grid; grid-template-columns: 52px 1fr; gap: 12px 14px; align-items:center; padding: 16px;
             background: var(--surface); border: 1px solid var(--line); border-radius: 20px;
             box-shadow: 0 20px 50px rgba(15,23,42,.22); animation: rise .25s ease-out; }
  .install img { border-radius: 14px; }
  .install-txt { display:flex; flex-direction:column; } .install-txt span { color: var(--mut); font-size: 13px; }
  .install-act { grid-column: 1 / -1; display:flex; gap: 8px; justify-content:flex-end; }
  @keyframes rise { from { transform: translate(-50%, 16px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
