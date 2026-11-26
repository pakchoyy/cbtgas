-- Padanan Postgres untuk db/d1/0002_answered_count.sql.
alter table exam_sessions add column if not exists answered_count integer not null default 0;
update exam_sessions es set answered_count = (select count(*) from answers a where a.session_id = es.id and a.answer is not null);
create index if not exists exam_sessions_due on exam_sessions (school_id, status, deadline_at);
