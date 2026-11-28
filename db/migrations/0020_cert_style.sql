-- Padanan Postgres untuk db/d1/0004_cert_style.sql.
alter table schools add column if not exists cert_style jsonb;
