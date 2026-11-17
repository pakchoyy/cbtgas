# Daftar periksa uji D1 sebelum cutover

Lakukan di Worker uji terpisah (`DB_BACKEND=d1`), bukan di produksi. Centang satu per satu; berhenti bila ada yang gagal.
Tes otomatis (`npm test`) sudah melewati alur ini di D1 **palsu**; daftar ini membuktikannya di D1 **asli**.

## A. Persiapan (sekali)

- [ ] `wrangler d1 create` + skema diterapkan (`db/d1/README.md` bagian 1).
- [ ] Data disalin: `export` → jalankan semua `.sql` → `verify` menampilkan **OK** (semua hitungan sama).
- [ ] Binding `DB` aktif di Worker uji dan `DB_BACKEND=d1` diset. Worker produksi **tidak** disentuh.
- [ ] Buka `/health` di Worker uji → 200.
- [ ] Catat jumlah ujian, siswa, dan soal di Neon untuk dibandingkan dengan tampilan di Worker uji.

## B. Guru / admin (login Google atau "Coba demo")

| # | Langkah | Hasil yang diharapkan |
|---|---|---|
| 1 | Masuk, buka **Beranda** | Angka kelas, siswa, soal, ujian sama dengan Neon |
| 2 | **Siswa** → buka daftar | Jumlah dan nama sama dengan Neon; kelas benar |
| 3 | Tambah 1 siswa baru | Muncul di daftar; username unik otomatis |
| 4 | **Pengguna** → nonaktifkan lalu aktifkan satu staf | Status berubah **dua arah** (tombol "Nonaktifkan" benar-benar menonaktifkan) |
| 5 | **Bank soal** → buka | Jumlah soal sama; soal bergambar tampil dan ditandai "bergambar" |
| 6 | Impor 10+ soal dari Word/Excel | Semua masuk dalam satu kali; kategori baru hanya dibuat **sekali** |
| 7 | Buat ujian dengan jadwal besok pukul 07.30 | Jam tampil **07.30 WIB** di daftar dan detail (bukan bergeser 7 jam) |
| 8 | Ubah soal/kelas peserta ujian itu | Daftar soal/kelas sesuai pilihan baru; tidak ada yang hilang |
| 9 | Buka ujian yang punya 100+ soal | Terbuka tanpa error |
| 10 | **Pantau langsung** saat siswa mengerjakan (bagian C) | Daftar siswa, status, jumlah terjawab, dan pelanggaran ter-update |
| 11 | **Nilai uraian** satu jawaban | Skor tersimpan; nilai akhir siswa ikut berubah |
| 12 | **Analisis butir**, **Distribusi pilihan**, **Rekomendasi** | Halaman terbuka; angka masuk akal dibanding Neon untuk ujian lama |
| 13 | Unduh **rekap nilai** (xlsx/CSV) dan **cadangan** | Berkas terunduh; jumlah baris sama dengan Neon |
| 14 | **Pemilik** (akun system owner) → daftar sekolah | Kolom "terakhir aktif" terisi, juga untuk sekolah tanpa sesi |

## C. Siswa (gunakan 2–3 akun, minimal satu dari HP)

| # | Langkah | Hasil yang diharapkan |
|---|---|---|
| 1 | Login username + PIN benar | Masuk ke beranda; ujian terbuka terlihat |
| 2 | Login PIN salah 5 kali | Akun terkunci 15 menit; pesan jelas |
| 3 | Mulai ujian | Soal tampil; opsi diacak bila diatur; timer sesuai durasi |
| 4 | Jawab beberapa soal, **muat ulang halaman** | Jawaban sebelumnya masih ada |
| 5 | Jawab 100+ soal sekaligus (ujian besar) | Tersimpan semua, tidak error |
| 6 | Pindah tab sampai batas pelanggaran | Sesi terkunci; kode buka muncul di layar pantau guru |
| 7 | Masukkan kode buka dari guru | Lanjut mengerjakan; hitungan pelanggaran mulai dari 0 |
| 8 | Kunci kedua kali | Dikumpulkan otomatis, **nilai langsung ada** |
| 9 | Matikan internet, jawab, nyalakan lagi | Jawaban terkirim otomatis (mode offline) |
| 10 | **Kumpulkan** | Layar selesai menampilkan nilai (bila diizinkan); nilai berformat 2 desimal, mis. 66.67 |
| 11 | Kumpulkan dua kali (klik ulang) | Tidak ada nilai ganda; pesan "sudah dikumpulkan" |
| 12 | **Riwayat**, **Rekomendasi belajar** | Terbuka; kategori lemah muncul |
| 13 | Biarkan satu siswa tidak mengumpulkan sampai waktu habis + 10 menit | Sesi otomatis berstatus selesai dan bernilai (saat guru/siswa lain membuka aplikasi) |

## D. Isolasi antar sekolah (wajib; ini pengganti RLS)

- [ ] Siapkan 2 sekolah. Masuk sebagai guru sekolah A, salin satu id ujian milik sekolah B (dari akun B).
- [ ] Buka `/app/exams/<id-ujian-B>` sebagai guru A → **tidak ditemukan** (404), bukan data B.
- [ ] `/api/exams/<id-ujian-B>/scores` dan `/api/questions/<id-soal-B>` sebagai guru A → kosong / tidak ditemukan.
- [ ] Siswa sekolah A mencoba `/s/take/<id-sesi-B>` → ditolak atau kosong.
- [ ] Bank soal **publik** sekolah B tetap bisa diunduh siswa/guru A lewat `/public/banks/<slug>` (ini sengaja lintas sekolah).

## E. Beban (uji dengan sebanyak mungkin perangkat, mendekati ujian nyata)

- [ ] 30–50 siswa mulai ujian bersamaan: tidak ada error 5xx; waktu mulai wajar (< beberapa detik).
- [ ] Pantau di Cloudflare → Workers → Metrics: tidak ada galat "too many subrequests/queries". Bila muncul pada paket gratis, pakai paket berbayar.
- [ ] Bandingkan waktu muat halaman utama guru dan layar ujian siswa dengan Neon (bukan harus lebih cepat; harus tidak terasa lambat).
- [ ] Setelah selesai: jumlah sesi, jawaban, dan nilai di D1 konsisten (tiap sesi `submitted` punya baris nilai).

## F. Cutover dan jalan mundur

1. Pilih jam sepi (tidak ada ujian berjalan). Beri tahu guru.
2. Hentikan penulisan ke Neon (jangan ada yang memakai aplikasi), jalankan ulang **A (salin data)** dari awal agar snapshot terbaru, dan `verify` OK.
3. Pasang `DB_BACKEND = "d1"` + binding `DB` di Worker **produksi**, deploy.
4. Ulangi singkat: B1, B7, C1, C3, C10 dengan akun nyata.
5. Pantau 1–2 jam pertama. **Jalan mundur:** hapus `DB_BACKEND`, deploy ulang → kembali ke Neon.
   Data yang ditulis di D1 setelah cutover **tidak** otomatis kembali ke Neon; putuskan lebih dulu apakah kehilangan itu bisa diterima, atau jangan buka ujian sampai yakin.
6. Biarkan Neon utuh minimal 2 minggu sebelum dimatikan.

## Yang sebaiknya diawasi (belum teruji di D1 asli)

- Batas query per permintaan di paket gratis (50) pada beban nyata.
- Kegagalan di tengah `batch()` pada D1 asli (di tes palsu sudah terbukti membatalkan semua).
- Tampilan angka: `60` bukan `60.00`, `1 poin` bukan `1.00 poin` (hanya kosmetik).
- Kolom baru bernama `active`/`has_*` yang berisi angka biasa akan salah dibaca sebagai boolean (lihat `BOOL_COLS` di `src/d1.ts`).
