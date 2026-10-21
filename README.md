# cbtgas

CBT berbasis cloud untuk SD-SMA (multi-sekolah, Cloudflare + Neon Postgres). Lihat PRD: "PRD Final CBT Sekolah SD-SMA".

## Database (fase A)

- `db/migrations/0001_init.sql`: skema fase A, RLS (`FORCE ROW LEVEL SECURITY`), role `cbt_app` non-pemilik.
- `db/tests/rls_cross_school.sql`: tes isolasi antar sekolah (di dalam transaksi, di-rollback).

Konteks per transaksi yang harus diset Worker sebelum query: `app.school_id`, `app.role`, `app.user_id`
(`SELECT set_config('app.school_id', $1, true)`). Worker login memakai `cbt_login`
(NOBYPASSRLS, non-pemilik), bukan pemilik tabel; `cbt_app` dipakai lewat `SET ROLE` di
dalam transaksi.

Uji lokal:

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_init.sql
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/rls_cross_school.sql

## Worker (Cloudflare)

- Deploy: `npx wrangler deploy`
- Live: `https://cbt-api.pulsachoy.workers.dev`
- Binding `HYPERDRIVE` menunjuk ke Neon project `CBT GAS` (role `cbt_login`).

### Endpoint

| Metode | Path | Catatan |
|---|---|---|
| GET  | `/health`                   | Status + `APP_ENV` |
| GET  | `/auth/google/start?mode=login\|register` | Redirect ke Google OAuth, set `oauth_state` |
| GET  | `/auth/google/callback`     | Tukar `code`, panggil `find_staff_by_email` (login) atau set `pending_registration` (register) |
| POST | `/auth/register-school`     | Body JSON: `{code,name,level,npsn?,operator_name,operator_phone}` — butuh cookie `pending_registration` |
| GET  | `/auth/me`                  | Sesi staf saat ini |
| POST | `/auth/logout`              | Hapus cookie sesi |
| GET  | `/api/students`             | Butuh sesi staf (atau header `x-school-id` saat `APP_ENV!=production` untuk demo) |

### Setup Google OAuth

1. Google Cloud Console → **APIs & Services → Credentials** → *Create OAuth client ID* → *Web application*.
2. **Authorized redirect URI**: `https://cbt-api.pulsachoy.workers.dev/auth/google/callback`
   (ganti host saat pakai custom domain).
3. Tanamkan secret ke Worker:

   ```sh
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   # SESSION_SECRET sudah di-set di deploy awal; buat ulang kalau mau rotasi:
   openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
   ```
4. Deploy ulang: `npx wrangler deploy`.

Setelah itu, buka `/auth/google/start?mode=register` untuk mendaftarkan sekolah
baru dengan akun Google admin, atau `?mode=login` kalau email sudah diundang
sebagai staf di suatu sekolah.

### Data demo

Sekolah `demo-sma` (id `adee329a-8b27-45ca-a0c2-9e47ea2f45a3`) sudah di-seed dengan
3 siswa di kelas X-IPA-1. Verifikasi:

    curl -H 'x-school-id: adee329a-8b27-45ca-a0c2-9e47ea2f45a3' \
      https://cbt-api.pulsachoy.workers.dev/api/students
