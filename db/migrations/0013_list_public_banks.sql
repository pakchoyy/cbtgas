-- Katalog bank soal publik dari semua sekolah (judul & ringkasan saja; isi
-- soal tetap diambil per slug lewat public_bank()).
CREATE OR REPLACE FUNCTION list_public_banks()
RETURNS TABLE (slug text, title text, description text, download_count int, created_at timestamptz,
               question_count int, school_name text, mine boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT b.slug, b.title, b.description, b.download_count, b.created_at,
          jsonb_array_length(b.payload->'questions'), s.name,
          b.school_id::text = current_setting('app.school_id', true)
   FROM shared_banks b JOIN schools s ON s.id = b.school_id AND s.active
   ORDER BY b.download_count DESC, b.created_at DESC
   LIMIT 200 $$;
REVOKE ALL ON FUNCTION list_public_banks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_public_banks() TO cbt_app;
