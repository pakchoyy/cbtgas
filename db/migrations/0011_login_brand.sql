-- Login siswa tanpa kode sekolah: cari siswa aktif berdasarkan username di
-- semua sekolah aktif. Pemanggil memverifikasi PIN tiap kandidat.
CREATE OR REPLACE FUNCTION find_students_by_username(p_username text)
RETURNS TABLE (id uuid, school_id uuid, name text, pin_hash text,
               locked_until timestamptz, pin_failed_count int)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT st.id, st.school_id, st.name, st.pin_hash, st.locked_until, st.pin_failed_count
   FROM students st JOIN schools s ON s.id = st.school_id AND s.active
   WHERE lower(st.username) = lower(trim(p_username)) AND st.active $$;
REVOKE ALL ON FUNCTION find_students_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_students_by_username(text) TO cbt_app;

-- Warna merek sekolah: kunci preset.
UPDATE schools SET color = 'biru' WHERE color NOT IN ('biru','hijau','ungu','merah','oranye','toska');
ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_color_check;
ALTER TABLE schools ADD CONSTRAINT schools_color_check
  CHECK (color IN ('biru','hijau','ungu','merah','oranye','toska'));
