-- 0066_what_ifs.sql — what-if course changes (plan 2026-11-13-what-if-course-changes, Task 1):
-- three tables for a faculty member's sketch of a change to a course, its chat
-- and attachments, and the page that predicts the effects. Stored apart from
-- the real course. Purely additive.
-- Live order: backup -> apply (this file) -> verify the three tables -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'course_what_ifs') THEN
    RAISE EXCEPTION '0066: already applied';
  END IF;
END $$;

CREATE TABLE course_what_ifs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  base_snapshot_id uuid NULL REFERENCES course_capture_snapshots(id) ON DELETE SET NULL,
  owner_grant_id text NOT NULL,
  owner_kind text NOT NULL,
  author_name text NOT NULL,
  title text,
  summary text,
  estimate jsonb,
  profile jsonb,
  knock_on jsonb,
  prose jsonb,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_what_ifs_owner_kind_check CHECK (owner_kind IN ('personal', 'department'))
);
CREATE INDEX idx_course_what_ifs_course ON course_what_ifs (course_code);

CREATE TABLE course_what_if_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  what_if_id uuid NOT NULL REFERENCES course_what_ifs(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_what_if_messages_role_check CHECK (role IN ('user', 'assistant'))
);
CREATE INDEX idx_course_what_if_messages_what_if ON course_what_if_messages (what_if_id, created_at);

CREATE TABLE course_what_if_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  what_if_id uuid NOT NULL REFERENCES course_what_ifs(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  blob_url text NOT NULL,
  status text NOT NULL,
  held_back_reason text,
  ferpa_risk text,
  extracted_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_what_if_attachments_status_check CHECK (status IN ('ok', 'failed', 'held_back'))
);
COMMIT;
