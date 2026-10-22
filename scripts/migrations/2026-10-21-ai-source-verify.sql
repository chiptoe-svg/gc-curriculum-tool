-- 2026-10-21-ai-source-verify.sql — fail-closed verification for migration 0063 (read-only).
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT 'weight_source check allows ai (expect t)' AS item, (EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'career_target_requirements_weight_source_check'
    AND pg_get_constraintdef(oid) LIKE '%''ai''%'))::text AS value
UNION ALL SELECT 'ai rows (0 right after apply)', count(*)::text FROM career_target_requirements WHERE weight_source = 'ai';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_target_requirements_weight_source_check'
                 AND pg_get_constraintdef(oid) LIKE '%''ai''%') THEN
    RAISE EXCEPTION '0063 verify: weight_source check does not allow ai';
  END IF;
END $$;
COMMIT;
