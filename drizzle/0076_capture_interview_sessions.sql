-- 0076_capture_interview_sessions.sql — evidence map + status per staged-interview session (plan 2026-11-25-interview-stages).
-- Adds one table; touches no existing table. Undo: DROP TABLE capture_interview_sessions;
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'capture_interview_sessions') THEN
    RAISE EXCEPTION '0076: already applied';
  END IF;
END $$;
CREATE TABLE capture_interview_sessions (
  session_id uuid PRIMARY KEY,
  course_code text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  map jsonb,
  map_status text NOT NULL,
  materials_fingerprint text,
  map_edited_at timestamptz,
  map_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
