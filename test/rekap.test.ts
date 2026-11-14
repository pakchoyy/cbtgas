import { test } from "node:test";
import assert from "node:assert/strict";
import { wib, detailRows, pivotRows, toCsv, toXlsx, rekapSheets, fileName, DETAIL_HEADER, type RawScore } from "../src/rekap.ts";

const base: Omit<RawScore, "title" | "username" | "student_name" | "final_score"> = {
  kind: "ASAS", class_name: "6C", status: "submitted", violation_count: 1,
  started_at: "2026-11-14T09:36:56.906Z", finished_at: "2026-11-14T09:38:12.837Z",
  auto_score: "60.00", manual_score: null, has_essay: false,
};
const raw: RawScore[] = [
  { ...base, title: "ASAS BAHASA INDO", student_name: "GHAISAN SURYA NURWAKHID", username: "0156094820", final_score: "60.00" },
  { ...base, title: "ASAS MATEMATIKA", student_name: "GHAISAN SURYA NURWAKHID", username: "0156094820", final_score: "75.00", has_essay: true },
  { ...base, title: "ASAS BAHASA INDO", class_name: "6A", student_name: "Budi", username: "b01", final_score: "80" },
  { ...base, title: "ASAS BAHASA INDO", class_name: "6C", student_name: "Ani", username: "a01", final_score: null, status: "active", finished_at: null },
];

test("waktu ditampilkan dalam WIB dengan format dd/mm/yyyy hh.mm", () => {
  assert.equal(wib("2026-11-14T09:36:56.906Z"), "14/11/2026 16.36");
  assert.equal(wib("2026-11-14T20:05:00Z"), "15/11/2026 03.05"); // lewat tengah malam WIB
  assert.equal(wib(null), "");
});

test("lembar detail: judul Indonesia, status diterjemahkan, nilai berupa angka, essay belum dikoreksi", () => {
  const rows = detailRows(raw);
  assert.deepEqual(rows[0], DETAIL_HEADER);
  const r1 = rows[1];
  assert.equal(r1[5], "Selesai");
  assert.equal(r1[7], "14/11/2026 16.36");
  assert.equal(r1[9], 60);
  assert.equal(typeof r1[11], "number");
  assert.equal(r1[10], "-");                 // ujian tanpa essay
  assert.equal(rows[2][10], "Belum dikoreksi"); // ujian ber-essay, belum dinilai
  assert.equal(rows[4][5], "Sedang mengerjakan");
});

test("rekap per mapel: satu baris per siswa, kolom per ujian, rata-rata, urut kelas lalu nama", () => {
  const rows = pivotRows(raw);
  assert.deepEqual(rows[0], ["Kelas", "Nama", "NIS", "ASAS BAHASA INDO", "ASAS MATEMATIKA", "Rata-rata"]);
  assert.deepEqual(rows.slice(1).map((r) => r[1]), ["Budi", "Ani", "GHAISAN SURYA NURWAKHID"]);
  assert.deepEqual(rows[3], ["6C", "GHAISAN SURYA NURWAKHID", "0156094820", 60, 75, 67.5]);
  assert.deepEqual(rows[2], ["6C", "Ani", "a01", null, null, null]);
});

test("CSV: BOM UTF-8, pemisah titik koma, koma desimal", () => {
  const csv = toCsv([["Nama", "Nilai"], ["Ani; Budi", 67.5], ["Ghaisan", 60]]);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).trim().split("\r\n");
  assert.equal(lines[0], "Nama;Nilai");
  assert.equal(lines[1], '"Ani; Budi";67,5');
  assert.equal(lines[2], "Ghaisan;60");
});

test("XLSX: zip valid berisi dua lembar, angka disimpan sebagai angka", () => {
  const bin = toXlsx(rekapSheets(raw));
  assert.deepEqual([...bin.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]); // PK..
  const text = new TextDecoder().decode(bin);
  assert.ok(text.includes('name="Detail Nilai"') && text.includes('name="Rekap per Mapel"'));
  assert.ok(text.includes("xl/worksheets/sheet2.xml"));
  assert.match(text, /<c r="J2"><v>60<\/v><\/c>/);            // Nilai PG numerik
  assert.match(text, /<c r="F4"><v>67\.5<\/v><\/c>/);         // rata-rata numerik di lembar 2
  assert.ok(!/<v>[^<]*,[^<]*<\/v>/.test(text));             // tidak ada angka bertanda koma di XML
});

test("nama file memuat kelas atau Semua-Kelas dan tanggal WIB", () => {
  const now = new Date("2026-11-14T18:00:00Z"); // 15/11 01.00 WIB
  assert.equal(fileName("6C", now), "Rekap-Nilai-6C-2026-11-15.xlsx");
  assert.equal(fileName(null, now), "Rekap-Nilai-Semua-Kelas-2026-11-15.xlsx");
  assert.equal(fileName("X IPA 1", now, "csv"), "Rekap-Nilai-X-IPA-1-2026-11-15.csv");
});
