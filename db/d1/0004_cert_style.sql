-- Tampilan sertifikat per sekolah (tema warna, judul, kota, penanda tangan).
-- Jalankan sekali: npx wrangler d1 execute cbt-yuk --remote --file db/d1/0004_cert_style.sql
ALTER TABLE schools ADD COLUMN cert_style text CHECK (cert_style IS NULL OR json_valid(cert_style));
