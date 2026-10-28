-- Antrian permintaan reset PIN siswa. Siswa mengajukan dengan kode sekolah +
-- username; guru/admin menyetujui, lalu system set PIN baru 6-digit acak
-- (dihapus setelah ditampilkan sekali).
CREATE TABLE IF NOT EXISTS pin_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by  uuid REFERENCES users(id),
  approved_at  timestamptz,
  new_pin      text,                 -- hanya terisi antara approve dan "ditampilkan ke guru"; lalu di-null-kan
  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS pin_resets_school ON pin_resets (school_id, status);
CREATE INDEX IF NOT EXISTS pin_resets_student ON pin_resets (student_id);

ALTER TABLE pin_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_resets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pin_resets
  USING (app_is_owner() OR school_id = app_school_id())
  WITH CHECK (app_is_owner() OR school_id = app_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON pin_resets TO cbt_app;
