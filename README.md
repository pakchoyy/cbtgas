# cbtgas

CBT berbasis cloud untuk SD-SMA (multi-sekolah, Cloudflare + Neon Postgres). Lihat PRD: "PRD Final CBT Sekolah SD-SMA".

## Database (fase A)

- `db/migrations/0001_init.sql`: skema fase A, RLS (`FORCE ROW LEVEL SECURITY`), role `cbt_app` non-pemilik.
- `db/tests/rls_cross_school.sql`: tes isolasi antar sekolah (di dalam transaksi, di-rollback).

Konteks per transaksi yang harus diset Worker sebelum query: `app.school_id`, `app.role`, `app.user_id`
(`SELECT set_config('app.school_id', $1, true)`). Worker login memakai `cbt_app`, bukan pemilik tabel.

Uji lokal:

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_init.sql
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/rls_cross_school.sql
