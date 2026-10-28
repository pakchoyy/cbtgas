// Token warna + komponen dasar yang dipakai halaman staf (pages.ts) dan
// portal siswa (student.ts). Identitas: lembar jawaban komputer (LJK) —
// tinta navy di atas kertas, kuning pensil hanya untuk tanda yang diisi.

export const SHARED_CSS = `
  :root {
    color-scheme: light;
    --ink: #14213D;        /* tinta: teks utama, tombol utama, topbar */
    --paper: #F6F7F9;      /* latar halaman */
    --surface: #FFFFFF;    /* kartu, input */
    --line: #E2E6EE;       /* garis & border */
    --pencil: #F5B400;     /* kuning pensil: jawaban terisi, timer, fokus */
    --fg: #14213D; --mut: #5B6478;
    --ok: #1F8A5B; --danger: #C2410C;
    /* alias lama agar markup lama tetap jalan */
    --bg: var(--paper); --card: var(--surface); --bd: var(--line); --accent: var(--ink);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --ink: #0F1A33; --paper: #0B1222; --surface: #131C31; --line: #24304B;
      --fg: #E8ECF5; --mut: #97A1B8; --accent: #E8ECF5; --ok: #3DBA82; --danger: #F07A4A;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --ink: #0F1A33; --paper: #0B1222; --surface: #131C31; --line: #24304B;
    --fg: #E8ECF5; --mut: #97A1B8; --accent: #E8ECF5; --ok: #3DBA82; --danger: #F07A4A;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin:0; font: 15px/1.55 "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
         color: var(--fg); background: var(--paper); font-feature-settings: "tnum" 0; }
  a { color: inherit; text-underline-offset: 3px; }
  main a:not(.btn) { color: var(--fg); text-decoration-color: var(--pencil); text-decoration-thickness: 2px; }
  h1 { font-size: clamp(22px, 2.6vw, 28px); line-height: 1.2; letter-spacing: -.02em; font-weight: 800; margin: 0 0 6px; }
  h2 { font-size: 17px; line-height: 1.3; letter-spacing: -.01em; font-weight: 700; margin: 0 0 12px; }
  h3 { font-size: 15px; font-weight: 700; }
  p { max-width: 72ch; }
  p.sub { color: var(--mut); margin: 0 0 18px; }
  .muted { color: var(--mut); font-size: 13px; }
  .err { color: var(--danger); font-size: 14px; margin-top: 10px; font-weight: 500; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; background: var(--paper); padding: 1px 6px;
         border-radius: 6px; border: 1px solid var(--line); font-size: 12.5px; }

  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 22px 24px; margin-bottom: 16px; }
  .card > h2:first-child, .card > h1:first-child { margin-top: 0; }

  label { display:block; font-size: 13px; font-weight: 600; color: var(--fg); margin: 14px 0 6px; }
  label .muted { font-weight: 400; }
  input, select, textarea { width:100%; min-height: 44px; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 10px;
         background: var(--surface); color: var(--fg); font: inherit; transition: border-color .15s; }
  textarea { min-height: 0; }
  input:hover, select:hover, textarea:hover { border-color: color-mix(in srgb, var(--fg) 25%, var(--line)); }
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline: none; border-color: var(--fg);
         box-shadow: 0 0 0 3px color-mix(in srgb, var(--pencil) 45%, transparent); }
  input[type=checkbox], input[type=radio] { width: 18px; height: 18px; min-height: 0; accent-color: var(--ink); }
  label:has(> input[type=checkbox]) { display:flex; align-items:center; gap:10px; font-weight:500; min-height:44px; margin:6px 0 0; }

  button, .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height: 42px; padding: 9px 16px;
         border-radius: 10px; border: 1.5px solid var(--line); background: var(--surface); color: var(--fg);
         font: inherit; font-size: 14px; font-weight: 600; cursor:pointer; text-decoration:none; white-space: nowrap;
         transition: background .15s, border-color .15s; }
  button:hover, .btn:hover { border-color: color-mix(in srgb, var(--fg) 35%, var(--line)); }
  button:focus-visible, .btn:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid var(--pencil); outline-offset: 2px; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button.primary, .btn.primary { background: var(--ink); border-color: var(--ink); color: #fff; }
  :root[data-theme="dark"] button.primary, :root[data-theme="dark"] .btn.primary { background: var(--pencil); border-color: var(--pencil); color: #14213D; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) button.primary, :root:not([data-theme="light"]) .btn.primary { background: var(--pencil); border-color: var(--pencil); color: #14213D; } }
  button.primary:hover, .btn.primary:hover { filter: brightness(1.12); }
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
  .pill.scheduled { background: color-mix(in srgb, var(--pencil) 22%, transparent); color: var(--fg); border-color: transparent; }

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

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
