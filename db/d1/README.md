# Cloudflare D1 (migrasi dari Neon)

Neon tetap backend bawaan. D1 hanya aktif bila variabel `DB_BACKEND=d1` diset **dan** binding `DB` ada.
Tanpa itu, perilaku aplikasi sama persis seperti sebelumnya.

## 1. Siapkan database

```bash
npx wrangler d1 create cbt-yuk
npx wrangler d1 execute cbt-yuk --remote --file db/d1/0001_init.sql
```

Salin `database_id` dari keluaran perintah pertama, lalu buka komentar blok `[[d1_databases]]` di `wrangler.toml`.

## 2. Salin data dari Neon

Skrip hanya MEMBACA Neon (transaksi read-only) dan menulis berkas SQL yang Anda jalankan sendiri ke D1:

```bash
DATABASE_URL='postgres://...' node scripts/neon-to-d1.mjs export out/
for f in out/*.sql; do npx wrangler d1 execute cbt-yuk --remote --file "$f"; done
npx wrangler d1 execute cbt-yuk --remote --json --command "$(node scripts/neon-to-d1.mjs count-query)" > out/d1.json
node scripts/neon-to-d1.mjs verify out/ out/d1.json
```

`verify` membandingkan jumlah baris tiap tabel, jumlah nilai akhir, dan jumlah jawaban berisi data. Jangan lanjut bila ada yang tidak sama.
Salinan ini satu kali jalan (snapshot): data yang masuk ke Neon sesudahnya tidak ikut. Lakukan di luar jam ujian,
lalu cutover segera, atau hentikan penulisan ke Neon selama jendela itu. `rate_counters` sengaja tidak disalin.

## 3. Uji tanpa menyentuh produksi

Deploy sebagai Worker terpisah (mis. `--name cbt-api-d1test`) dengan `DB_BACKEND=d1`, atau jalankan lokal:

```bash
npx wrangler dev --var DB_BACKEND:d1
```

Produksi tetap Neon sampai variabel itu dipasang di Worker produksi. Mengembalikan ke Neon = hapus variabelnya.

## 4. Batasan D1 yang perlu diketahui

- Paket gratis: 50 query per permintaan (berbayar: 1.000). Halaman dengan banyak query berurutan bisa menyentuh batas gratis.
- Tidak ada RLS: isolasi antar sekolah ditegakkan adapter (`src/tenant.ts`) dengan menulis ulang query. Query dengan bentuk SQL yang tak dikenal ditolak.
- Tidak ada transaksi interaktif: jalur kritis memakai `atomic()` (`src/dbfn.ts`) = satu `batch()` D1.
- Waktu disimpan sebagai teks ISO-8601 UTC (`...Z`). Jangan menulis format lain.
- Kolom JSON/boolean dikonversi saat dibaca berdasarkan nama kolom (`JSON_COLS`, `BOOL_COLS` di `src/d1.ts`).

## 5. Tes

`npm test` menjalankan seluruh aplikasi di atas D1 palsu (SQLite), termasuk alur siswa penuh dan semua halaman staf.
D1 palsu bukan D1 asli: uji juga di D1 sungguhan sebelum cutover.
