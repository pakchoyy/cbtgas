-- Login guru/admin dengan email + password (di samping login Google).
-- Jalankan sekali: npx wrangler d1 execute cbt-yuk --remote --file db/d1/0003_staff_password.sql
ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD COLUMN pw_failed integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pw_locked_until text;
