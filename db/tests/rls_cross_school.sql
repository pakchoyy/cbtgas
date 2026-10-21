-- Jalankan sebagai pemilik tabel (migrator) setelah 0001_init.sql:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/rls_cross_school.sql
-- Seluruh tes di dalam transaksi dan di-ROLLBACK.
BEGIN;

INSERT INTO schools (id, code, name, level, operator_name, operator_phone) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','sekolah-a','Sekolah A','SMA','Op A','081'),
  ('bbbbbbbb-0000-0000-0000-000000000002','sekolah-b','Sekolah B','SD','Op B','082');
INSERT INTO students (school_id, name, username, pin_hash) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','Siswa A','a1','x'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Siswa B','b1','x');

SET LOCAL ROLE cbt_app;

DO $$
DECLARE n int;
BEGIN
  -- 1. Sekolah A hanya melihat siswanya sendiri
  PERFORM set_config('app.school_id','aaaaaaaa-0000-0000-0000-000000000001', true);
  PERFORM set_config('app.role','teacher', true);
  SELECT count(*) INTO n FROM students;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: sekolah A melihat % siswa (harus 1)', n; END IF;

  -- 2. Sekolah A tidak bisa menyisipkan baris untuk sekolah B
  BEGIN
    INSERT INTO students (school_id, name, username, pin_hash)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000002','Bocor','z','x');
    RAISE EXCEPTION 'FAIL: insert lintas sekolah berhasil';
  EXCEPTION WHEN insufficient_privilege THEN NULL; -- diharapkan (RLS WITH CHECK)
  END;

  -- 3. Sekolah A tidak bisa mengubah/menghapus data sekolah B
  UPDATE students SET name = 'diubah' WHERE school_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: update lintas sekolah mengubah % baris', n; END IF;

  -- 4. Tanpa konteks sekolah: tidak ada baris terlihat
  PERFORM set_config('app.school_id','', true);
  PERFORM set_config('app.role','', true);
  SELECT count(*) INTO n FROM students;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: tanpa konteks terlihat % siswa', n; END IF;

  -- 5. Owner melihat semua
  PERFORM set_config('app.role','owner', true);
  SELECT count(*) INTO n FROM students;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: owner melihat % siswa (harus 2)', n; END IF;

  RAISE NOTICE 'OK: semua tes RLS lintas sekolah lolos';
END $$;

ROLLBACK;
