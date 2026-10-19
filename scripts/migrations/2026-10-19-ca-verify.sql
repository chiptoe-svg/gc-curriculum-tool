-- 2026-10-19-ca-verify.sql — fail-closed verification for migration 0060.
-- Run read-only right after applying 0060. Printed item/value rows first for a
-- human to skim, then a DO block re-derives every check and RAISEs on the
-- first failure.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT 'sub_competencies.foundational exists (expect t)' AS item, (EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'sub_competencies' AND column_name = 'foundational'))::text AS value
UNION ALL SELECT 'sub_competencies.scoring exists (expect t)', (EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'sub_competencies' AND column_name = 'scoring'))::text
UNION ALL SELECT 'rows with foundational = true (0 right after apply)', count(*)::text
  FROM sub_competencies WHERE foundational
UNION ALL SELECT 'rows with scoring = derived (0 right after apply)', count(*)::text
  FROM sub_competencies WHERE scoring = 'derived'
UNION ALL SELECT 'rows violating foundational = (know IS NULL AND understand IS NULL) (expect 0)', count(*)::text
  FROM sub_competencies WHERE foundational IS DISTINCT FROM (know_descriptor IS NULL AND understand_descriptor IS NULL)
UNION ALL SELECT 'expected 0060 constraints present (expect 0 missing)', count(*)::text
  FROM unnest(ARRAY['sub_competencies_foundational_ku_check', 'sub_competencies_scoring_check']) AS expected(conname)
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected.conname);

DO $$
DECLARE
  n_bad int;
  missing_constraint text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sub_competencies' AND column_name = 'foundational') THEN
    RAISE EXCEPTION '0060 verify: sub_competencies.foundational is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sub_competencies' AND column_name = 'scoring') THEN
    RAISE EXCEPTION '0060 verify: sub_competencies.scoring is missing';
  END IF;

  SELECT c INTO missing_constraint FROM unnest(ARRAY['sub_competencies_foundational_ku_check', 'sub_competencies_scoring_check']) AS c
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c)
    LIMIT 1;
  IF missing_constraint IS NOT NULL THEN
    RAISE EXCEPTION '0060 verify: expected constraint "%" is missing', missing_constraint;
  END IF;

  SELECT count(*) INTO n_bad FROM sub_competencies
    WHERE foundational IS DISTINCT FROM (know_descriptor IS NULL AND understand_descriptor IS NULL);
  IF n_bad <> 0 THEN
    RAISE EXCEPTION '0060 verify: % row(s) violate foundational = (know IS NULL AND understand IS NULL)', n_bad;
  END IF;

  RAISE NOTICE '0060 verify: all checks passed';
END $$;

ROLLBACK;
