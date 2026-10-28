-- Beri cbt_app izin INSERT ke schools untuk mendukung restore backup
-- (sekolah baru dibuat oleh admin ber-role 'owner' di sesi restore).
-- Register sekolah biasa tetap lewat function register_school (SECURITY
-- DEFINER) jadi izin ini tidak membuka celah tambahan bagi klien biasa.
GRANT INSERT, DELETE ON schools TO cbt_app;
