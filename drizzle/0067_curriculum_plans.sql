-- 0067_curriculum_plans.sql — curriculum builder (spec 2026-11-14-curriculum-builder-design.md):
-- one table for a saved curriculum plan (which courses sit in which act, the
-- goal, and any proposed courses). A plan never writes to courses, snapshots
-- or coverage. Purely additive.
-- Live order: backup -> apply (this file) -> verify the table -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'curriculum_plans') THEN
    RAISE EXCEPTION '0067: already applied';
  END IF;
END $$;

CREATE TABLE curriculum_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  owner_grant_id text NOT NULL,
  owner_kind text NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_plans_owner_kind_check CHECK (owner_kind IN ('personal', 'department')),
  CONSTRAINT curriculum_plans_version_check CHECK (version >= 1)
);
CREATE INDEX idx_curriculum_plans_updated ON curriculum_plans (updated_at DESC);
COMMIT;
