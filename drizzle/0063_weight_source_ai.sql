-- 0063_weight_source_ai.sql — career_target_requirements.weight_source also allows 'ai':
-- an AI-drafted provisional weight (spec 2026-10-21-p3-ai-draft-weights-design.md).
-- Live order: backup -> apply (this file) -> verify -> deploy the build -> import-ai-weights.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regclass('public.career_target_membership') IS NULL THEN
    RAISE EXCEPTION '0063: precondition — 0062 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_target_requirements_weight_source_check'
             AND pg_get_constraintdef(oid) LIKE '%''ai''%') THEN
    RAISE EXCEPTION '0063: already applied';
  END IF;
END $$;
ALTER TABLE career_target_requirements DROP CONSTRAINT career_target_requirements_weight_source_check;
ALTER TABLE career_target_requirements ADD CONSTRAINT career_target_requirements_weight_source_check
  CHECK (weight_source IN ('onet', 'employer', 'faculty', 'ai'));
COMMIT;
