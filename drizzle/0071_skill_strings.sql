-- 0071_skill_strings.sql — locked skill strings (spec 2026-11-18 locked skill strings; plan 2026-11-18-locked-skill-strings).
-- Seven new tables: string_points (a skill statement at a course), string_links (hooks between points, with a why),
-- curriculum_strings (a named string) + curriculum_string_path (its ordered points), skill_orphan_notes,
-- curriculum_string_events (audit trail), string_point_resolutions (reword-resolution cache).
-- Creates tables only; no existing table or row is touched. Live order: backup -> apply (this file) -> verify -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'string_points') THEN
    RAISE EXCEPTION '0071: already applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'curriculum_clusters') THEN
    RAISE EXCEPTION '0071: precondition — 0070 not applied';
  END IF;
END $$;

CREATE TABLE string_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code text NOT NULL,
  role text NOT NULL,
  statement text NOT NULL,
  statement_hash text NOT NULL,
  snapshot_id uuid,
  k smallint,
  u smallint,
  d smallint,
  term smallint,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT string_points_role_check CHECK (role IN ('develops', 'requires')),
  CONSTRAINT string_points_term_check CHECK (term BETWEEN 1 AND 9),
  CONSTRAINT string_points_unique UNIQUE (course_code, role, statement_hash)
);

CREATE TABLE string_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_point uuid NOT NULL REFERENCES string_points(id) ON DELETE RESTRICT,
  to_point uuid NOT NULL REFERENCES string_points(id) ON DELETE RESTRICT,
  why text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT string_links_unique UNIQUE (from_point, to_point),
  CONSTRAINT string_links_distinct_check CHECK (from_point <> to_point)
);

CREATE TABLE curriculum_strings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  end_note text,
  end_by text,
  end_at timestamptz,
  merged_into uuid REFERENCES curriculum_strings(id) ON DELETE RESTRICT,
  merged_by text,
  merged_at timestamptz,
  merge_reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT curriculum_strings_status_check CHECK (status IN ('active', 'unlocked')),
  CONSTRAINT curriculum_strings_version_check CHECK (version >= 1),
  CONSTRAINT curriculum_strings_merge_self_check CHECK (merged_into IS NULL OR merged_into <> id)
);
CREATE UNIQUE INDEX idx_curriculum_strings_active_name ON curriculum_strings (lower(name)) WHERE status = 'active';

CREATE TABLE curriculum_string_path (
  string_id uuid NOT NULL REFERENCES curriculum_strings(id) ON DELETE CASCADE,
  position integer NOT NULL,
  point_id uuid NOT NULL REFERENCES string_points(id) ON DELETE RESTRICT,
  CONSTRAINT curriculum_string_path_pkey PRIMARY KEY (string_id, position)
);

CREATE TABLE skill_orphan_notes (
  course_code text NOT NULL,
  role text NOT NULL,
  statement_hash text NOT NULL,
  statement text NOT NULL,
  reason text NOT NULL,
  by text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_orphan_notes_pkey PRIMARY KEY (course_code, role, statement_hash),
  CONSTRAINT skill_orphan_notes_role_check CHECK (role IN ('develops', 'requires'))
);

CREATE TABLE curriculum_string_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  string_id uuid,
  point_id uuid,
  kind text NOT NULL,
  by text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  reason text,
  before jsonb,
  after jsonb,
  CONSTRAINT curriculum_string_events_kind_check CHECK (kind IN ('locked', 'extended', 'joined', 'branched', 'merged', 'unmerged', 'point_removed', 'reword_confirmed', 'link_why', 'renamed', 'end_note', 'unlocked', 'relocked', 'orphan_note'))
);
CREATE INDEX idx_curriculum_string_events_string_at ON curriculum_string_events (string_id, at DESC);

CREATE TABLE string_point_resolutions (
  point_id uuid NOT NULL REFERENCES string_points(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL,
  status text NOT NULL,
  candidate_statement text,
  candidate_hash text,
  p_fully real,
  model text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT string_point_resolutions_pkey PRIMARY KEY (point_id, snapshot_id, model, prompt_version),
  CONSTRAINT string_point_resolutions_status_check CHECK (status IN ('changed', 'unanchored'))
);
COMMIT;
