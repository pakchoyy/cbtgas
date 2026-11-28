// Sertifikat hasil ujian (A4 mendatar, siap cetak / simpan PDF). Dipakai siswa (/s/cert/:sid) dan guru (/app/exams/:id/certs).
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export type CertItem = { name: string; className: string | null; title: string; kind: string; score: number | null; finishedAt: string | null };
export type CertSchool = { name: string; color: string; hasLogo: boolean };

export function predikat(score: number): { label: string; grade: string } {
  if (score >= 90) return { grade: "A", label: "Sangat Baik" };
  if (score >= 80) return { grade: "B", label: "Baik" };
  if (score >= 70) return { grade: "C", label: "Cukup" };
  return { grade: "D", label: "Terus Semangat" };
}

const fmtScore = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const fmtDate = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })
  : "";

function one(it: CertItem, sc: CertSchool): string {
  const p = it.score == null ? null : predikat(it.score);
  return `<section class="cert">
  <div class="frame">
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <header>${sc.hasLogo ? `<img class="logo" src="/logo" alt="">` : ""}<p class="sch">${esc(sc.name)}</p></header>
    <h1>SERTIFIKAT</h1>
    <p class="sub">Hasil ${esc(it.kind)}</p>
    <p class="given">Diberikan kepada</p>
    <p class="name">${esc(it.name)}</p>
    <p class="cls">${it.className ? `Kelas ${esc(it.className)} · ` : ""}peserta <b>${esc(it.title)}</b></p>
    <div class="score">
      <div class="ring"><b>${it.score == null ? "-" : fmtScore(it.score)}</b><span>Nilai</span></div>
      ${p ? `<div class="pred"><b>${p.grade}</b><span>${p.label}</span></div>` : ""}
    </div>
    <p class="msg">${p && p.grade === "A" ? "Selamat atas pencapaian yang luar biasa. Pertahankan semangat belajarmu!" : p && p.grade !== "D" ? "Selamat! Terus tingkatkan semangat belajarmu untuk hasil yang lebih baik." : "Tetap semangat belajar. Setiap usaha adalah langkah menuju keberhasilan."}</p>
    <footer>
      <div class="date">${esc(sc.name)}${it.finishedAt ? `, ${fmtDate(it.finishedAt)}` : ""}</div>
      <div class="sign"><span>Guru / Wali Kelas</span><i></i></div>
    </footer>
  </div>
</section>`;
}

export function certPage(items: CertItem[], sc: CertSchool, opts: { back: string; title?: string }): string {
  const C = sc.color;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title ?? "Sertifikat")}</title>
<style>
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #E2E8F0; font-family: system-ui, "Segoe UI", Roboto, sans-serif; color: #0F172A; }
.bar { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 16px; background: #fff; border-bottom: 1px solid #CBD5E1; }
.bar a, .bar button { font: inherit; font-weight: 700; min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid #CBD5E1; background: #fff; color: #0F172A; text-decoration: none; display: inline-flex; align-items: center; cursor: pointer; }
.bar .go { background: ${C}; border-color: ${C}; color: #fff; }
.bar small { color: #64748B; flex: 1 1 220px; }
.wrap { padding: 16px; display: grid; gap: 16px; justify-items: center; }
.cert { --c: ${C}; width: 297mm; height: 210mm; background: #fff; padding: 9mm; break-after: page; box-shadow: 0 10px 30px rgba(15,23,42,.15); }
.cert:last-child { break-after: auto; }
.frame { position: relative; height: 100%; border: 1.2mm solid var(--c); outline: .5mm solid color-mix(in srgb, var(--c) 40%, #fff); outline-offset: -3.5mm;
  background: radial-gradient(circle at 50% 0, color-mix(in srgb, var(--c) 7%, #fff), #fff 60%); display: flex; flex-direction: column; align-items: center; text-align: center; padding: 12mm 22mm 10mm; }
.corner { position: absolute; width: 22mm; height: 22mm; border: 2.2mm solid var(--c); }
.tl { top: -1.2mm; left: -1.2mm; border-right: 0; border-bottom: 0; } .tr { top: -1.2mm; right: -1.2mm; border-left: 0; border-bottom: 0; }
.bl { bottom: -1.2mm; left: -1.2mm; border-right: 0; border-top: 0; } .br { bottom: -1.2mm; right: -1.2mm; border-left: 0; border-top: 0; }
header { display: flex; flex-direction: column; align-items: center; gap: 2mm; }
.logo { width: 20mm; height: 20mm; object-fit: contain; }
.sch { margin: 0; font-weight: 800; font-size: 13pt; letter-spacing: .06em; text-transform: uppercase; color: var(--c); }
h1 { margin: 5mm 0 0; font-family: Georgia, "Times New Roman", serif; font-size: 40pt; letter-spacing: .22em; line-height: 1; }
.sub { margin: 2mm 0 0; font-size: 12pt; letter-spacing: .3em; text-transform: uppercase; color: #64748B; }
.given { margin: 7mm 0 0; color: #64748B; font-size: 11pt; }
.name { margin: 2mm 0 0; font-family: Georgia, "Times New Roman", serif; font-size: 30pt; font-weight: 700; color: var(--c); border-bottom: .4mm solid color-mix(in srgb, var(--c) 35%, #fff); padding: 0 10mm 2mm; max-width: 100%; overflow-wrap: anywhere; }
.cls { margin: 3mm 0 0; font-size: 12pt; }
.score { display: flex; align-items: center; gap: 10mm; margin-top: 6mm; }
.ring { width: 34mm; height: 34mm; border-radius: 50%; border: 1.6mm solid var(--c); display: flex; flex-direction: column; align-items: center; justify-content: center; background: #fff; }
.ring b { font-size: 26pt; line-height: 1; } .ring span { font-size: 8.5pt; color: #64748B; letter-spacing: .2em; text-transform: uppercase; margin-top: 1mm; }
.pred { display: flex; flex-direction: column; align-items: center; } .pred b { font-size: 30pt; color: var(--c); line-height: 1; } .pred span { font-weight: 700; font-size: 12pt; }
footer { margin-top: auto; width: 100%; display: flex; justify-content: space-between; align-items: flex-end; font-size: 10.5pt; }
.date { color: #334155; text-align: left; }
.sign { display: flex; flex-direction: column; align-items: center; gap: 16mm; min-width: 60mm; } .sign i { display: block; width: 60mm; border-bottom: .3mm solid #334155; }
@media print { body { background: #fff; } .bar { display: none; } .wrap { padding: 0; gap: 0; } .cert { box-shadow: none; zoom: 1 !important; } }
.msg { margin: 6mm 0 0; font-style: italic; color: #475569; font-size: 11.5pt; max-width: 170mm; }
</style></head><body>
<div class="bar"><a href="${esc(opts.back)}">‹ Kembali</a><button class="go" type="button" onclick="print()">Simpan PDF / Cetak</button>
<small>Di jendela cetak, pilih <b>Simpan sebagai PDF</b> untuk menyimpan, atau pilih printer. Ukuran A4 mendatar.</small></div>
<div class="wrap">${items.map((it) => one(it, sc)).join("")}</div>
<script>
  // Layar sempit (HP): perkecil tampilan agar sertifikat utuh terlihat. Cetak/PDF tetap A4 penuh.
  function fit() { const vw = Math.min(innerWidth, screen.width || innerWidth), w = Math.min(1, (vw - 32) / (297 * 96 / 25.4)); document.querySelectorAll('.cert').forEach((c) => { c.style.zoom = w < 1 ? String(w) : ''; }); }
  fit(); addEventListener('resize', fit);
</script>
</body></html>`;
}
