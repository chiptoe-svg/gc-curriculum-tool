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
  FROM onet_release
UNION ALL SELECT 'expected 0058 constraints present (expect 0 missing)', count(*)::text
  FROM unnest(ARRAY[
    'sub_competencies_origin_check',
    'career_target_occupations_career_target_id_fkey',
    'career_target_occupations_career_target_id_horizon_soc_code_key',
    'career_target_occupations_horizon_check',
    'career_target_occupations_soc_code_check',
    'career_target_occupations_onet_soc_code_check',
    'career_target_occupations_onet_status_check',
    'career_target_occupations_count_check',
    'career_target_occupations_share_check',
    'career_target_occupations_source_check',
    'career_target_occupations_check',
    'onet_occupations_pkey',
    'onet_occupations_release_fkey',
    'onet_element_ratings_pkey',
    'onet_element_ratings_release_onet_soc_code_fkey',
    'onet_element_ratings_domain_check',
    'onet_element_ratings_scale_id_check',
    'onet_task_statements_pkey',
    'onet_task_statements_release_onet_soc_code_fkey',
    'onet_task_ratings_pkey',
    'onet_task_ratings_release_onet_soc_code_task_id_fkey',
    'onet_task_ratings_scale_id_check'
  ]) AS expected(conname)
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected.conname);

DO $$
DECLARE
  n_bad_origin int;
  n_null_origin int;
  expected_constraints text[] := ARRAY[
    'sub_competencies_origin_check',
    'career_target_occupations_career_target_id_fkey',
    'career_target_occupations_career_target_id_horizon_soc_code_key',
    'career_target_occupations_horizon_check',
    'career_target_occupations_soc_code_check',
    'career_target_occupations_onet_soc_code_check',
    'career_target_occupations_onet_status_check',
    'career_target_occupations_count_check',
    'career_target_occupations_share_check',
    'career_target_occupations_source_check',
    'career_target_occupations_check',
    'onet_occupations_pkey',
    'onet_occupations_release_fkey',
    'onet_element_ratings_pkey',
    'onet_element_ratings_release_onet_soc_code_fkey',
    'onet_element_ratings_domain_check',
    'onet_element_ratings_scale_id_check',
    'onet_task_statements_pkey',
    'onet_task_statements_release_onet_soc_code_fkey',
    'onet_task_ratings_pkey',
    'onet_task_ratings_release_onet_soc_code_task_id_fkey',
    'onet_task_ratings_scale_id_check'
  ];
  missing_constraint text;
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

  -- m6 (hostile-review fix wave): the checks above only prove the TABLES
  -- and COLUMN exist — a migration that silently lost a CHECK/UNIQUE/FK
  -- would still pass them. Walk every constraint 0058 is supposed to have
  -- created and refuse on the first one missing.
  SELECT c INTO missing_constraint FROM unnest(expected_constraints) AS c
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c)
    LIMIT 1;
  IF missing_constraint IS NOT NULL THEN
    RAISE EXCEPTION '0058 verify: expected constraint "%" is missing', missing_constraint;
  END IF;

  RAISE NOTICE '0058 verify: all checks passed';
END $$;

ROLLBACK;
