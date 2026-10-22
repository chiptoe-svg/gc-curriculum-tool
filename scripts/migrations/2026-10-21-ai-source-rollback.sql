-- 2026-10-21-ai-source-rollback.sql — undo migration 0063. Revert the build first.
-- Refuses while ai rows exist; delete them deliberately first
-- (DELETE FROM career_target_requirements WHERE weight_source = 'ai'), then rebuild membership.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM career_target_requirements WHERE weight_source = 'ai') THEN
    RAISE EXCEPTION 'rollback refused: ai rows exist';
  END IF;
END $$;
ALTER TABLE career_target_requirements DROP CONSTRAINT career_target_requirements_weight_source_check;
ALTER TABLE career_target_requirements ADD CONSTRAINT career_target_requirements_weight_source_check
  CHECK (weight_source IN ('onet', 'employer', 'faculty'));
COMMIT;
