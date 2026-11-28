-- Padanan Postgres untuk db/d1/0003_staff_password.sql (jalur Neon tidak memakai login password; kolom disiapkan saja).
alter table users add column if not exists password_hash text;
alter table users add column if not exists pw_failed integer not null default 0;
alter table users add column if not exists pw_locked_until timestamptz;
