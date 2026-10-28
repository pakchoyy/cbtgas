-- Audit log: catatan tindakan admin/guru/siswa yang mengubah state.
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,                       -- di-cache (nama user bisa hilang)
  actor_role  text,                        -- admin/teacher/proctor/student
  action      text NOT NULL,               -- mis. exam.open, student.import, pin_reset.approve
  entity      text,                        -- mis. exam, student, user
  entity_id   uuid,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_school ON audit_log (school_id, created_at desc);
CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (entity, entity_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (app_is_owner() OR school_id = app_school_id())
  WITH CHECK (app_is_owner() OR school_id = app_school_id());
GRANT SELECT, INSERT ON audit_log TO cbt_app;
