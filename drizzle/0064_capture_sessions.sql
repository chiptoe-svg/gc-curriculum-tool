-- 0064_capture_sessions.sql — one row per capture session: the revision mode
-- the instructor chose when reopening an approved course, and the approved
-- snapshot the revision started from (spec 2026-11-08-course-revision-modes-labels-design.md).
-- Live order: backup -> apply (this file) -> verify the table exists -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regclass('public.capture_sessions') IS NOT NULL THEN
    RAISE EXCEPTION '0064: already applied';
  END IF;
END $$;
CREATE TABLE capture_sessions (
  session_id uuid PRIMARY KEY,
  course_code text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  revision_mode text NOT NULL CHECK (revision_mode IN ('targeted', 'recheck', 'fresh')),
  baseline_snapshot_id uuid NULL REFERENCES course_capture_snapshots(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
