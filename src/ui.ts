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

export const INSTALL_SHEET = `
<div id="installCard" class="install" role="dialog" aria-labelledby="installTitle" hidden>
  <img src="/icon-192.svg" alt="" width="52" height="52">
  <div class="install-txt"><b id="installTitle">Pasang CBT Yuk</b><span>Buka langsung dari layar utama, layar penuh seperti aplikasi.</span></div>
  <div class="install-act"><button type="button" id="installClose">Nanti</button><button type="button" class="primary" id="installBtn">Pasang</button></div>
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
  main a:not(.btn):hover { text-decoration: underline; }
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
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline: none; border-color: var(--brand);
         box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 18%, transparent); }
  input[type=checkbox], input[type=radio] { width: 18px; height: 18px; min-height: 0; accent-color: var(--brand); }
  label:has(> input[type=checkbox]) { display:flex; align-items:center; gap:10px; font-weight:500; min-height:44px; margin:6px 0 0; }

  button, .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height: 42px; padding: 9px 16px;
         border-radius: 10px; border: 1.5px solid var(--line); background: var(--surface); color: var(--fg);
         font: inherit; font-size: 14px; font-weight: 600; cursor:pointer; text-decoration:none; white-space: nowrap;
         transition: background .15s, border-color .15s; }
  button:hover, .btn:hover { border-color: color-mix(in srgb, var(--fg) 35%, var(--line)); }
  button:focus-visible, .btn:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid color-mix(in srgb, var(--brand) 45%, transparent); outline-offset: 2px; }
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
