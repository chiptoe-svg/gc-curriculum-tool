-- 2026-10-21-membership-verify.sql — fail-closed verification for migration 0062.
-- Run read-only right after applying 0062. Printed rows first, then a DO block
-- re-derives every check and RAISEs on the first failure.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT 'career_target_membership exists (expect t)' AS item, (to_regclass('public.career_target_membership') IS NOT NULL)::text AS value
UNION ALL SELECT 'status check allows hidden (expect t)', (EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'career_target_requirements_status_check'
    AND pg_get_constraintdef(oid) LIKE '%hidden%'))::text
UNION ALL SELECT 'membership rows', count(*)::text FROM career_target_membership
UNION ALL SELECT 'distinct requirement pairs', count(*)::text FROM (SELECT DISTINCT career_target_id, competency_id FROM career_target_requirements) p
UNION ALL SELECT 'onet/employer rows (0 right after apply)', count(*)::text FROM career_target_requirements WHERE weight_source <> 'faculty'
UNION ALL SELECT 'views read career_target_membership (expect t)',
  (pg_get_viewdef('target_sub_competencies'::regclass) LIKE '%career_target_membership%'
   AND pg_get_viewdef('target_coverage'::regclass) LIKE '%career_target_membership%')::text;

DO $$
DECLARE m bigint; p bigint; w bigint;
BEGIN
  IF to_regclass('public.career_target_membership') IS NULL THEN
    RAISE EXCEPTION '0062 verify: career_target_membership is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_target_requirements_status_check'
                 AND pg_get_constraintdef(oid) LIKE '%hidden%') THEN
    RAISE EXCEPTION '0062 verify: status check does not allow hidden';
  END IF;
  SELECT count(*) INTO m FROM career_target_membership;
  SELECT count(*) INTO p FROM (SELECT DISTINCT career_target_id, competency_id FROM career_target_requirements) x;
  SELECT count(*) INTO w FROM career_target_requirements WHERE weight_source <> 'faculty';
  IF w = 0 AND m <> p THEN
    RAISE EXCEPTION '0062 verify: % membership rows but % requirement pairs', m, p;
  END IF;
  IF pg_get_viewdef('target_sub_competencies'::regclass) NOT LIKE '%career_target_membership%' THEN
    RAISE EXCEPTION '0062 verify: target_sub_competencies does not read career_target_membership';
  END IF;
  IF pg_get_viewdef('target_coverage'::regclass) NOT LIKE '%career_target_membership%' THEN
    RAISE EXCEPTION '0062 verify: target_coverage does not read career_target_membership';
  END IF;
END $$;
COMMIT;
