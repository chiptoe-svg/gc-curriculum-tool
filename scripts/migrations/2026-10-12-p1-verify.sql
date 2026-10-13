-- 2026-10-12-p1-verify.sql — fail-closed verification for migration 0058 (P1).
-- Run read-only right after applying 0058. Same style as
-- 2026-10-12-p0b-verify.sql: printed `-At` item/value rows first for a human
-- to skim, then a DO block re-derives every check and RAISEs on the first
-- failure, so a bad migration makes the script itself error out rather than
-- just print a wrong number that a human might not read carefully.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT 'career_target_occupations exists (expect t)' AS item, (to_regclass('public.career_target_occupations') IS NOT NULL)::text AS value
UNION ALL SELECT 'onet_release exists (expect t)', (to_regclass('public.onet_release') IS NOT NULL)::text
UNION ALL SELECT 'onet_occupations exists (expect t)', (to_regclass('public.onet_occupations') IS NOT NULL)::text
UNION ALL SELECT 'onet_element_ratings exists (expect t)', (to_regclass('public.onet_element_ratings') IS NOT NULL)::text
UNION ALL SELECT 'onet_task_statements exists (expect t)', (to_regclass('public.onet_task_statements') IS NOT NULL)::text
UNION ALL SELECT 'onet_task_ratings exists (expect t)', (to_regclass('public.onet_task_ratings') IS NOT NULL)::text
UNION ALL SELECT 'sub_competencies.origin exists (expect t)', (EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'sub_competencies' AND column_name = 'origin'))::text
UNION ALL SELECT 'sub_competencies rows with origin <> migrated (expect 0)', count(*)::text
  FROM sub_competencies WHERE origin <> 'migrated'
UNION ALL SELECT 'sub_competencies rows with NULL origin (expect 0)', count(*)::text
  FROM sub_competencies WHERE origin IS NULL
UNION ALL SELECT 'career_target_occupations rows (0 right after apply, before any ingest)', count(*)::text
  FROM career_target_occupations
UNION ALL SELECT 'onet_release rows (0 right after apply, before any load)', count(*)::text
  FROM onet_release;

DO $$
DECLARE
  n_bad_origin int;
  n_null_origin int;
BEGIN
  IF to_regclass('public.career_target_occupations') IS NULL THEN
    RAISE EXCEPTION '0058 verify: career_target_occupations is missing';
  END IF;
  IF to_regclass('public.onet_release') IS NULL THEN
    RAISE EXCEPTION '0058 verify: onet_release is missing';
  END IF;
  IF to_regclass('public.onet_occupations') IS NULL THEN
    RAISE EXCEPTION '0058 verify: onet_occupations is missing';
  END IF;
  IF to_regclass('public.onet_element_ratings') IS NULL THEN
    RAISE EXCEPTION '0058 verify: onet_element_ratings is missing';
  END IF;
  IF to_regclass('public.onet_task_statements') IS NULL THEN
    RAISE EXCEPTION '0058 verify: onet_task_statements is missing';
  END IF;
  IF to_regclass('public.onet_task_ratings') IS NULL THEN
    RAISE EXCEPTION '0058 verify: onet_task_ratings is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sub_competencies' AND column_name = 'origin') THEN
    RAISE EXCEPTION '0058 verify: sub_competencies.origin is missing';
  END IF;

  SELECT count(*) INTO n_bad_origin FROM sub_competencies WHERE origin <> 'migrated';
  IF n_bad_origin <> 0 THEN
    RAISE EXCEPTION '0058 verify: % sub_competencies row(s) have an origin other than migrated right after apply', n_bad_origin;
  END IF;

  SELECT count(*) INTO n_null_origin FROM sub_competencies WHERE origin IS NULL;
  IF n_null_origin <> 0 THEN
    RAISE EXCEPTION '0058 verify: % sub_competencies row(s) have a NULL origin', n_null_origin;
  END IF;

  RAISE NOTICE '0058 verify: all checks passed';
END $$;

ROLLBACK;
