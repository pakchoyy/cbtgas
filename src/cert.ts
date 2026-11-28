// Sertifikat / piagam hasil ujian (A4 mendatar, siap cetak / simpan PDF).
// Dipakai siswa (/s/cert/:sid, tanpa pengaturan) dan guru (/app/exams/:id/certs, dengan panel "Atur tampilan").
// Tampilan (tema, judul, kota, penanda tangan) disimpan per sekolah di schools.cert_style.
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export type CertItem = { name: string; className: string | null; title: string; kind: string; score: number | null; finishedAt: string | null };
export type CertSchool = { name: string; color: string; hasLogo: boolean };
export type CertStyle = {
  theme: string; title: string; city: string;
  s1Role: string; s1Name: string; s1Nip: string;
  s2Role: string; s2Name: string; s2Nip: string;
  predikat: boolean; pesan: boolean;
};

// Warna utama tiap tema; aksen emas sama untuk semua. "sekolah" = warna merek sekolah.
export const CERT_THEMES: Record<string, { label: string; hex: string | null }> = {
  navy: { label: "Biru Emas", hex: "#1E3A8A" },
  hijau: { label: "Hijau Emas", hex: "#14532D" },
  marun: { label: "Marun Emas", hex: "#7F1D1D" },
  hitam: { label: "Hitam Emas", hex: "#1F2937" },
  ungu: { label: "Ungu Emas", hex: "#4C1D95" },
  sekolah: { label: "Warna Sekolah", hex: null },
};

export const CERT_DEFAULT: CertStyle = {
  theme: "navy", title: "SERTIFIKAT", city: "",
  s1Role: "Kepala Sekolah", s1Name: "", s1Nip: "",
  s2Role: "Guru Mata Pelajaran", s2Name: "", s2Nip: "",
  predikat: true, pesan: true,
};

// Bersihkan masukan dari klien / database: hanya kunci yang dikenal, teks dipangkas.
export function cleanCertStyle(raw: unknown): CertStyle {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = (k: keyof CertStyle, max: number) => (typeof r[k] === "string" ? String(r[k]).trim().slice(0, max) : String(CERT_DEFAULT[k]));
  return {
    theme: typeof r.theme === "string" && r.theme in CERT_THEMES ? r.theme : CERT_DEFAULT.theme,
    title: t("title", 40) || CERT_DEFAULT.title, city: t("city", 60),
    s1Role: t("s1Role", 60), s1Name: t("s1Name", 80), s1Nip: t("s1Nip", 40),
    s2Role: t("s2Role", 60), s2Name: t("s2Name", 80), s2Nip: t("s2Nip", 40),
    predikat: typeof r.predikat === "boolean" ? r.predikat : true,
    pesan: typeof r.pesan === "boolean" ? r.pesan : true,
  };
}

export function predikat(score: number): { label: string; grade: string } {
  if (score >= 90) return { grade: "A", label: "Sangat Baik" };
  if (score >= 80) return { grade: "B", label: "Baik" };
  if (score >= 70) return { grade: "C", label: "Cukup" };
  return { grade: "D", label: "Terus Semangat" };
}

const fmtScore = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const fmtDate = (iso: string | null) => new Date(iso ?? Date.now())
  .toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

// Pola guilloche (garis gelombang bersilang, seperti pada ijazah/uang kertas) untuk pita bingkai.
const GUILLOCHE = "url(\"data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='14'><g fill='none' stroke='#fff' stroke-opacity='.28' stroke-width='.7'>` +
  `<path d='M0 7 Q7 0 14 7 T28 7'/><path d='M0 7 Q7 14 14 7 T28 7'/><path d='M0 3.5 Q7 10.5 14 3.5 T28 3.5' stroke-opacity='.14'/><path d='M0 10.5 Q7 3.5 14 10.5 T28 10.5' stroke-opacity='.14'/></g></svg>`) + "\")";

// Ornamen sudut (sulur emas). Diputar untuk tiap sudut.
const CORNER = `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
<path d="M6 94V30C6 16 16 6 30 6h64"/><path d="M14 94V36c0-12 10-22 22-22h58" stroke-width="1.2"/>
<path d="M30 6c0 14-10 24-24 24"/><circle cx="30" cy="30" r="5"/><path d="M40 20c8 2 12 8 12 16M20 40c2 8 8 12 16 12" stroke-width="1.4"/>
<path d="M60 14c6-6 14-6 18 0M14 60c-6 6-6 14 0 18" stroke-width="1.4"/></g></svg>`;

const MESSAGES = {
  A: "Atas pencapaian yang luar biasa. Semoga terus berprestasi dan menjadi teladan.",
  B: "Atas hasil yang baik. Teruslah belajar dengan tekun untuk meraih prestasi terbaik.",
  C: "Atas usaha dan kerja kerasnya. Tingkatkan terus semangat belajarmu.",
  D: "Atas keikutsertaannya. Setiap usaha adalah langkah menuju keberhasilan.",
};

function one(it: CertItem, sc: CertSchool, st: CertStyle): string {
  const p = it.score == null ? null : predikat(it.score);
  const signer = (n: 1 | 2) => {
    const role = n === 1 ? st.s1Role : st.s2Role, name = n === 1 ? st.s1Name : st.s2Name, nip = n === 1 ? st.s1Nip : st.s2Nip;
    return `<div class="sg sg${n}"${!role && !name ? " hidden" : ""}>
      ${n === 2 ? `<span class="place"><span data-f="city">${esc(st.city || sc.name)}</span>, ${esc(fmtDate(it.finishedAt))}</span>` : `<span class="place">Mengetahui,</span>`}
      <span class="role" data-f="s${n}Role">${esc(role)}</span><i></i>
      <b class="nm" data-f="s${n}Name">${esc(name)}</b><span class="nip"${nip ? "" : " hidden"}>NIP. <span data-f="s${n}Nip">${esc(nip)}</span></span></div>`;
  };
  return `<section class="cert">
  <div class="band"><div class="paper">
    ${sc.hasLogo ? `<img class="wm" src="/logo" alt="">` : ""}
    <span class="cn tl">${CORNER}</span><span class="cn tr">${CORNER}</span><span class="cn bl">${CORNER}</span><span class="cn br">${CORNER}</span>
    <header>${sc.hasLogo ? `<img class="logo" src="/logo" alt="">` : ""}<p class="sch">${esc(sc.name)}</p></header>
    <h1 data-f="title">${esc(st.title)}</h1>
    <p class="sub"><span>${esc(it.kind)}</span></p>
    <p class="given">Diberikan kepada</p>
    <p class="name">${esc(it.name)}</p>
    <p class="body">${it.className ? `Kelas ${esc(it.className)}, ` : ""}telah mengikuti <b>${esc(it.title)}</b>${p ? " dengan hasil" : ""}</p>
    <div class="result">
      <div class="medal"><div class="disc"><b>${it.score == null ? "-" : fmtScore(it.score)}</b><span>NILAI</span></div><i class="rb l"></i><i class="rb r"></i></div>
      ${p ? `<div class="pred"${st.predikat ? "" : " hidden"}><span>Predikat</span><b>${p.grade}</b><em>${p.label}</em></div>` : ""}
    </div>
    ${p ? `<p class="msg"${st.pesan ? "" : " hidden"}>${MESSAGES[p.grade as keyof typeof MESSAGES]}</p>` : ""}
    <footer>${signer(1)}${signer(2)}</footer>
  </div></div>
</section>`;
}

export function certPage(items: CertItem[], sc: CertSchool, st: CertStyle, opts: { back: string; title?: string; editable?: boolean }): string {
  const themeHex = (k: string) => CERT_THEMES[k]?.hex ?? sc.color;
  const P = themeHex(st.theme);
  const themes = Object.fromEntries(Object.keys(CERT_THEMES).map((k) => [k, themeHex(k)]));
  const editor = opts.editable ? `
<details class="ed" id="ed"><summary>Atur tampilan</summary>
  <div class="edg">
    <fieldset><legend>Tema warna</legend><div class="sw">${Object.entries(CERT_THEMES).map(([k, v]) =>
      `<label title="${esc(v.label)}"><input type="radio" name="theme" value="${k}"${k === st.theme ? " checked" : ""}><span style="background:${themes[k]}"></span><small>${esc(v.label)}</small></label>`).join("")}</div></fieldset>
    <label>Judul<input name="title" list="titles" value="${esc(st.title)}" maxlength="40"><datalist id="titles"><option>SERTIFIKAT</option><option>PIAGAM PENGHARGAAN</option><option>PIAGAM</option><option>SERTIFIKAT PRESTASI</option></datalist></label>
    <label>Kota<input name="city" value="${esc(st.city)}" placeholder="${esc(sc.name)}" maxlength="60"></label>
    <fieldset><legend>Penanda tangan kiri</legend><input name="s1Role" value="${esc(st.s1Role)}" placeholder="Jabatan, mis. Kepala Sekolah"><input name="s1Name" value="${esc(st.s1Name)}" placeholder="Nama lengkap & gelar"><input name="s1Nip" value="${esc(st.s1Nip)}" placeholder="NIP (opsional)"></fieldset>
    <fieldset><legend>Penanda tangan kanan</legend><input name="s2Role" value="${esc(st.s2Role)}" placeholder="Jabatan, mis. Guru Mata Pelajaran"><input name="s2Name" value="${esc(st.s2Name)}" placeholder="Nama lengkap & gelar"><input name="s2Nip" value="${esc(st.s2Nip)}" placeholder="NIP (opsional)"></fieldset>
    <label class="ck"><input type="checkbox" name="predikat"${st.predikat ? " checked" : ""}> Tampilkan predikat (A–D)</label>
    <label class="ck"><input type="checkbox" name="pesan"${st.pesan ? " checked" : ""}> Tampilkan kalimat penghargaan</label>
    <div class="edf"><button type="button" class="go" id="edSave">Simpan untuk sekolah</button><small>Berlaku juga untuk sertifikat yang diunduh siswa. Kosongkan jabatan &amp; nama untuk menyembunyikan satu kolom tanda tangan.</small></div>
  </div>
</details>` : "";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title ?? "Sertifikat")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Great+Vibes&display=swap" rel="stylesheet">
<style>
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
:root { --p: ${P}; --g: #B8860B; --g2: #D4AF37; --ink: #1F2937; }
body { margin: 0; background: #CBD5E1; font-family: "Cormorant Garamond", Georgia, serif; color: var(--ink); }
.bar { position: sticky; top: 0; z-index: 5; background: #fff; border-bottom: 1px solid #CBD5E1; padding: 10px 16px; font-family: system-ui, "Segoe UI", Roboto, sans-serif; }
.bar .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bar a, .bar button { font: inherit; font-weight: 700; min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid #CBD5E1; background: #fff; color: #0F172A; text-decoration: none; display: inline-flex; align-items: center; cursor: pointer; }
.bar .go { background: var(--p); border-color: var(--p); color: #fff; }
.bar small { color: #64748B; }
.ed { margin-top: 8px; } .ed summary { cursor: pointer; font-weight: 700; color: var(--p); min-height: 40px; display: flex; align-items: center; }
.edg { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px 16px; padding: 6px 0 4px; max-height: 60vh; overflow: auto; }
.edg label, .edg fieldset { display: grid; gap: 4px; font-size: 13px; font-weight: 600; color: #334155; margin: 0; }
.edg fieldset { border: 1px solid #E2E8F0; border-radius: 10px; padding: 8px 10px; } .edg legend { padding: 0 4px; }
.edg input[name]:not([type=radio]):not([type=checkbox]) { font: inherit; font-weight: 400; min-height: 40px; padding: 6px 10px; border: 1px solid #CBD5E1; border-radius: 8px; }
.edg .ck { display: flex; align-items: center; gap: 8px; min-height: 40px; } .edg .ck input { width: 18px; height: 18px; }
.sw { display: flex; flex-wrap: wrap; gap: 8px; } .sw label { display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; }
.sw input { position: absolute; opacity: 0; width: 1px; height: 1px; } .sw span { width: 34px; height: 34px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1px #CBD5E1, inset 0 -8px 0 #D4AF37; }
.sw input:checked + span { box-shadow: 0 0 0 2.5px #0F172A, inset 0 -8px 0 #D4AF37; } .sw input:focus-visible + span { outline: 2px solid #2563EB; outline-offset: 2px; } .sw small { font-size: 11px; font-weight: 500; }
.edf { grid-column: 1 / -1; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.wrap { padding: 18px; display: grid; gap: 18px; justify-items: center; }
.cert { width: 297mm; height: 210mm; background: #fff; break-after: page; box-shadow: 0 12px 32px rgba(15,23,42,.25); }
.cert:last-child { break-after: auto; }
.band { height: 100%; padding: 6mm; background: ${GUILLOCHE} var(--p); background-size: 7mm 3.5mm; }
.paper { position: relative; height: 100%; overflow: hidden; background: #FFFDF6;
  box-shadow: 0 0 0 1mm var(--g2), inset 0 0 0 2.2mm #FFFDF6, inset 0 0 0 2.6mm var(--g);
  display: flex; flex-direction: column; align-items: center; text-align: center; padding: 9mm 34mm 9mm; }
.paper::before { content: ""; position: absolute; inset: 4mm; border: .35mm solid color-mix(in srgb, var(--g) 70%, transparent); pointer-events: none; }
.wm { position: absolute; top: 50%; left: 50%; width: 92mm; height: 92mm; object-fit: contain; transform: translate(-50%, -46%); opacity: .055; pointer-events: none; }
.cn { position: absolute; width: 24mm; height: 24mm; color: var(--g); } .cn svg { width: 100%; height: 100%; }
.cn.tl { top: 5mm; left: 5mm; } .cn.tr { top: 5mm; right: 5mm; transform: scaleX(-1); } .cn.bl { bottom: 5mm; left: 5mm; transform: scaleY(-1); } .cn.br { bottom: 5mm; right: 5mm; transform: scale(-1); }
header { display: flex; flex-direction: column; align-items: center; gap: 1.5mm; position: relative; }
.logo { width: 17mm; height: 17mm; object-fit: contain; }
.sch { margin: 0; font-family: Cinzel, Georgia, serif; font-weight: 700; font-size: 12pt; letter-spacing: .14em; color: var(--p); }
h1 { margin: 2mm 0 0; font-family: Cinzel, Georgia, serif; font-weight: 700; font-size: 38pt; letter-spacing: .14em; line-height: 1.05; color: var(--p); }
.sub { margin: 1.5mm 0 0; display: flex; align-items: center; gap: 4mm; font-family: Cinzel, Georgia, serif; font-size: 11pt; letter-spacing: .32em; color: var(--g); text-transform: uppercase; }
.sub::before, .sub::after { content: ""; width: 22mm; height: .35mm; background: linear-gradient(90deg, transparent, var(--g)); } .sub::after { transform: scaleX(-1); }
.given { margin: 4mm 0 0; font-style: italic; font-size: 15pt; color: #475569; }
.name { margin: 0; font-family: "Great Vibes", cursive; font-size: 42pt; line-height: 1.25; color: var(--p); padding: 0 12mm 1mm; max-width: 100%; overflow-wrap: anywhere;
  background: linear-gradient(90deg, transparent, var(--g2), transparent) bottom / 100% .4mm no-repeat; }
.body { margin: 2.5mm 0 0; font-size: 15pt; max-width: 200mm; } .body b { font-weight: 700; color: var(--p); }
.result { display: flex; align-items: center; gap: 9mm; margin-top: 3mm; margin-bottom: 8mm; }
.medal { position: relative; width: 28mm; height: 28mm; }
.disc { position: relative; z-index: 1; width: 100%; height: 100%; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #FFF6D0 0, #E9C756 38%, #B8860B 78%, #8A6400 100%); box-shadow: inset 0 0 0 1.4mm #F8E08E, inset 0 0 0 2mm #9A7208, 0 1mm 2mm rgba(0,0,0,.25); color: #3B2A00; }
.disc b { font-family: Cinzel, Georgia, serif; font-size: 21pt; line-height: 1; } .disc span { font-family: Cinzel, serif; font-size: 7pt; letter-spacing: .2em; margin-top: .8mm; }
.rb { position: absolute; z-index: 0; bottom: -8mm; width: 8mm; height: 14mm; background: var(--p); clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%); }
.rb.l { left: 6mm; transform: rotate(14deg); } .rb.r { right: 6mm; transform: rotate(-14deg); }
.pred { display: flex; flex-direction: column; align-items: center; min-width: 28mm; } .pred[hidden], .msg[hidden] { display: none; } .sg .nip[hidden] { display: block; visibility: hidden; }
.pred span { font-family: Cinzel, serif; font-size: 8.5pt; letter-spacing: .25em; color: #64748B; text-transform: uppercase; }
.pred b { font-family: Cinzel, Georgia, serif; font-size: 32pt; line-height: 1.05; color: var(--p); } .pred em { font-size: 14pt; font-weight: 700; font-style: normal; }
.msg { margin: 0; font-style: italic; font-size: 13pt; color: #475569; max-width: 190mm; }
footer { margin-top: auto; padding-top: 3mm; width: 100%; display: flex; justify-content: space-between; align-items: flex-end; gap: 20mm; position: relative; }
.sg { display: flex; flex-direction: column; align-items: center; min-width: 66mm; font-size: 12.5pt; line-height: 1.3; }
.sg[hidden] { display: none; } footer:has(.sg1[hidden]) { justify-content: flex-end; } footer:has(.sg2[hidden]) { justify-content: flex-start; }
.sg .place { color: #334155; } .sg .role { font-weight: 600; } .sg i { display: block; height: 15mm; }
.sg .nm { min-width: 62mm; border-bottom: .3mm solid var(--ink); padding: 0 2mm .5mm; font-weight: 700; min-height: 6mm; } .sg .nip { font-size: 11pt; color: #334155; }
@media print { body { background: #fff; } .bar { display: none; } .wrap { padding: 0; gap: 0; } .cert { box-shadow: none; zoom: 1 !important; } }
</style></head><body>
<div class="bar"><div class="row"><a href="${esc(opts.back)}">‹ Kembali</a><button class="go" type="button" onclick="print()">Simpan PDF / Cetak</button>
<small>Di jendela cetak pilih <b>Simpan sebagai PDF</b> atau printer · A4 mendatar${items.length > 1 ? ` · ${items.length} sertifikat` : ""}</small></div>${editor}</div>
<div class="wrap">${items.map((it) => one(it, sc, st)).join("")}</div>
<script>
  // Layar sempit (HP): perkecil tampilan agar sertifikat utuh terlihat. Cetak/PDF tetap A4 penuh.
  function fit() { const vw = Math.min(innerWidth, screen.width || innerWidth), w = Math.min(1, (vw - 36) / (297 * 96 / 25.4)); document.querySelectorAll('.cert').forEach((c) => { c.style.zoom = w < 1 ? String(w) : ''; }); }
  fit(); addEventListener('resize', fit);
${opts.editable ? `
  const THEMES = ${JSON.stringify(themes)}, ed = document.getElementById('ed');
  const val = () => { const o = {}; ed.querySelectorAll('[name]').forEach((i) => { if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; } else o[i.name] = i.type === 'checkbox' ? i.checked : i.value; }); return o; };
  function apply() {
    const o = val();
    document.documentElement.style.setProperty('--p', THEMES[o.theme] || THEMES.navy);
    document.querySelectorAll('[data-f]').forEach((el) => { const k = el.dataset.f; el.textContent = k === 'city' ? (o.city || ${JSON.stringify(sc.name).replace(/</g, "\\u003c")}) : (o[k] ?? ''); });
    [1, 2].forEach((n) => document.querySelectorAll('.sg' + n).forEach((s) => { s.hidden = !o['s' + n + 'Role'] && !o['s' + n + 'Name']; const nip = s.querySelector('.nip'); if (nip) nip.hidden = !o['s' + n + 'Nip']; }));
    document.querySelectorAll('.pred').forEach((e) => e.hidden = !o.predikat); document.querySelectorAll('.msg').forEach((e) => e.hidden = !o.pesan);
  }
  ed.addEventListener('input', apply); ed.addEventListener('change', apply);
  document.getElementById('edSave').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; const t = b.textContent;
    try {
      const r = await fetch('/api/cert-style', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(val()) });
      const j = await r.json().catch(() => ({}));
      b.textContent = r.ok ? 'Tersimpan ✓' : (j.error || 'Gagal menyimpan');
    } catch (_) { b.textContent = 'Koneksi terputus'; }
    setTimeout(() => { b.textContent = t; b.disabled = false; }, 2000);
  });` : ""}
</script>
</body></html>`;
}
