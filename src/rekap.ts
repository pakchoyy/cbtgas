// Rekap nilai sekolah untuk guru: lembar detail + lembar "Rekap per Mapel".
// Keluaran utama .xlsx (dibuat sendiri tanpa pustaka: zip "stored" + SpreadsheetML),
// cadangan CSV ramah Excel Indonesia (titik koma, BOM UTF-8, koma desimal).

export type RawScore = {
  title: string; kind: string; class_name: string | null; student_name: string; username: string;
  status: string; violation_count: number | null; started_at: string | Date | null; finished_at: string | Date | null;
  auto_score: string | number | null; manual_score: string | number | null; final_score: string | number | null;
  has_essay?: boolean;
};
export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

const STATUS: Record<string, string> = {
  submitted: "Selesai", expired: "Waktu habis", active: "Sedang mengerjakan", locked: "Terkunci",
};
export const DETAIL_HEADER = ["Ujian", "Jenis", "Kelas", "Nama", "NIS/Username", "Status", "Pelanggaran",
  "Mulai", "Selesai", "Nilai PG", "Nilai Essay", "Nilai Akhir"];

const num = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// "14/11/2026 16.36" dalam WIB (UTC+7, tanpa musim panas).
export function wib(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = new Date(new Date(v).getTime() + 7 * 3600_000);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}.${p(d.getUTCMinutes())}`;
}

export function detailRows(raw: RawScore[]): Cell[][] {
  return [DETAIL_HEADER, ...raw.map((r) => {
    const manual = num(r.manual_score);
    return [r.title, r.kind, r.class_name ?? "", r.student_name, r.username, STATUS[r.status] ?? r.status,
      r.violation_count ?? 0, wib(r.started_at), wib(r.finished_at), num(r.auto_score),
      manual ?? (r.has_essay ? "Belum dikoreksi" : "-"), num(r.final_score)];
  })];
}

// Satu baris per siswa, satu kolom per ujian (Nilai Akhir), lalu Rata-rata. Urut kelas lalu nama.
export function pivotRows(raw: RawScore[]): Cell[][] {
  const exams: string[] = [];
  const studs = new Map<string, { kelas: string; nama: string; nis: string; v: Map<string, number> }>();
  for (const r of raw) {
    if (!exams.includes(r.title)) exams.push(r.title);
    const key = r.username;
    if (!studs.has(key)) studs.set(key, { kelas: r.class_name ?? "", nama: r.student_name, nis: r.username, v: new Map() });
    const f = num(r.final_score);
    if (f != null) studs.get(key)!.v.set(r.title, f);
  }
  const coll = new Intl.Collator("id", { numeric: true, sensitivity: "base" });
  const list = [...studs.values()].sort((a, b) => coll.compare(a.kelas, b.kelas) || coll.compare(a.nama, b.nama));
  return [["Kelas", "Nama", "NIS", ...exams, "Rata-rata"], ...list.map((s) => {
    const vals = exams.map((e) => s.v.get(e) ?? null);
    const got = vals.filter((x): x is number => x != null);
    return [s.kelas, s.nama, s.nis, ...vals, got.length ? Math.round(got.reduce((a, b) => a + b, 0) / got.length * 100) / 100 : null];
  })];
}

export function rekapSheets(raw: RawScore[]): Sheet[] {
  return [{ name: "Detail Nilai", rows: detailRows(raw) }, { name: "Rekap per Mapel", rows: pivotRows(raw) }];
}

export function fileName(kelas: string | null, now = new Date(), ext = "xlsx"): string {
  const d = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const k = kelas ? kelas.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "Kelas" : "Semua-Kelas";
  return `Rekap-Nilai-${k}-${d}.${ext}`;
}

// ===== CSV ramah Excel Indonesia =====
export function toCsv(rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

// ===== XLSX (Office Open XML) tanpa pustaka =====
const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))
  // karakter kontrol tidak sah di XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colName = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

function sheetXml(rows: Cell[][]): string {
  const widths = rows[0]?.map((_, c) => Math.min(45, Math.max(8, ...rows.map((r) => String(r[c] ?? "").length + 2)))) ?? [];
  const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1), st = ri === 0 ? ` s="1"` : "";
    if (v == null || v === "") return `<c r="${ref}"${st}/>`;
    if (typeof v === "number") return `<c r="${ref}"${st}><v>${v}</v></c>`;
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }).join("") + `</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

// Zip tanpa kompresi (metode 0): cukup untuk file kecil dan dibaca semua versi Excel.
export function zip(files: Array<[string, string]>): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name), d = enc.encode(text), crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), n, d); central.push(new Uint8Array(c.buffer), n);
    off += 30 + n.length + d.length;
  }
  const cSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

export function toXlsx(sheets: Sheet[]): Uint8Array {
  const ns = "http://schemas.openxmlformats.org/";
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)] as [string, string]),
  ]);
}
