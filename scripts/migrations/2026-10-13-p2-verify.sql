-- 2026-10-13-p2-verify.sql — fail-closed verification for migration 0059 (P2).
-- Run read-only right after applying 0059. Same style as
-- 2026-10-12-p1-verify.sql: printed `-At` item/value rows first for a human
-- to skim, then a DO block re-derives every check and RAISEs on the first
-- failure, so a bad migration makes the script itself error out rather than
-- just print a wrong number that a human might not read carefully.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT 'bundle_cards exists (expect t)' AS item, (to_regclass('public.bundle_cards') IS NOT NULL)::text AS value
UNION ALL SELECT 'item_embeddings exists (expect t)', (to_regclass('public.item_embeddings') IS NOT NULL)::text
UNION ALL SELECT 'onet_element_definitions exists (expect t)', (to_regclass('public.onet_element_definitions') IS NOT NULL)::text
UNION ALL SELECT 'bundle_mapping_runs exists (expect t)', (to_regclass('public.bundle_mapping_runs') IS NOT NULL)::text
UNION ALL SELECT 'bundle_members exists (expect t)', (to_regclass('public.bundle_members') IS NOT NULL)::text
UNION ALL SELECT 'bundle_mapping_outcomes exists (expect t)', (to_regclass('public.bundle_mapping_outcomes') IS NOT NULL)::text
UNION ALL SELECT 'bundle_golden_samples exists (expect t)', (to_regclass('public.bundle_golden_samples') IS NOT NULL)::text
UNION ALL SELECT 'bundle_golden_picks exists (expect t)', (to_regclass('public.bundle_golden_picks') IS NOT NULL)::text
UNION ALL SELECT 'bundle_members rows (0 right after apply, before any ingest)', count(*)::text
  FROM bundle_members
UNION ALL SELECT 'bundle_cards rows (0 right after apply, before any ingest)', count(*)::text
  FROM bundle_cards
UNION ALL SELECT 'bundle_golden_samples rows (0 right after apply, before any ingest)', count(*)::text
  FROM bundle_golden_samples
UNION ALL SELECT 'bundle_members FKs to any onet_* table (expect 0)', count(*)::text
  FROM pg_constraint
  WHERE conrelid = 'bundle_members'::regclass AND contype = 'f' AND confrelid::regclass::text LIKE 'onet_%'
UNION ALL SELECT 'expected 0059 constraints present (expect 0 missing)', count(*)::text
  FROM unnest(ARRAY[
    'bundle_cards_pkey','bundle_cards_competency_id_fkey','bundle_cards_stratum_check','bundle_cards_status_check','bundle_cards_confirmed_check',
    'item_embeddings_pkey','item_embeddings_kind_check','item_embeddings_vector_check',
    'onet_element_definitions_pkey','onet_element_definitions_release_fkey','onet_element_definitions_domain_check',
    'bundle_mapping_runs_pkey','bundle_mapping_runs_k_check','bundle_mapping_runs_cost_check',
    'bundle_members_pkey','bundle_members_bundle_id_fkey','bundle_members_run_id_fkey','bundle_members_source_check',
    'bundle_members_position_check','bundle_members_ai_position_check','bundle_members_status_check','bundle_members_soc_check',
    'bundle_members_release_check','bundle_members_decision_check','bundle_members_reviewer_added_check','bundle_members_item_key',
    'bundle_mapping_outcomes_pkey','bundle_mapping_outcomes_run_id_fkey','bundle_mapping_outcomes_bundle_id_fkey',
    'bundle_mapping_outcomes_status_check','bundle_mapping_outcomes_failed_check',
    'bundle_golden_samples_pkey','bundle_golden_samples_bundle_id_fkey','bundle_golden_samples_stratum_check','bundle_golden_samples_submitted_check',
    'bundle_golden_picks_pkey','bundle_golden_picks_bundle_id_fkey','bundle_golden_picks_source_check','bundle_golden_picks_position_check',
    'bundle_golden_picks_shape_check','bundle_golden_picks_item_key'
  ]) AS expected(conname)
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected.conname);

DO $$
DECLARE
  n_members int;
  n_cards int;
  n_golden int;
  n_onet_fks int;
  expected_constraints text[] := ARRAY[
    'bundle_cards_pkey','bundle_cards_competency_id_fkey','bundle_cards_stratum_check','bundle_cards_status_check','bundle_cards_confirmed_check',
    'item_embeddings_pkey','item_embeddings_kind_check','item_embeddings_vector_check',
    'onet_element_definitions_pkey','onet_element_definitions_release_fkey','onet_element_definitions_domain_check',
    'bundle_mapping_runs_pkey','bundle_mapping_runs_k_check','bundle_mapping_runs_cost_check',
    'bundle_members_pkey','bundle_members_bundle_id_fkey','bundle_members_run_id_fkey','bundle_members_source_check',
    'bundle_members_position_check','bundle_members_ai_position_check','bundle_members_status_check','bundle_members_soc_check',
    'bundle_members_release_check','bundle_members_decision_check','bundle_members_reviewer_added_check','bundle_members_item_key',
    'bundle_mapping_outcomes_pkey','bundle_mapping_outcomes_run_id_fkey','bundle_mapping_outcomes_bundle_id_fkey',
    'bundle_mapping_outcomes_status_check','bundle_mapping_outcomes_failed_check',
    'bundle_golden_samples_pkey','bundle_golden_samples_bundle_id_fkey','bundle_golden_samples_stratum_check','bundle_golden_samples_submitted_check',
    'bundle_golden_picks_pkey','bundle_golden_picks_bundle_id_fkey','bundle_golden_picks_source_check','bundle_golden_picks_position_check',
    'bundle_golden_picks_shape_check','bundle_golden_picks_item_key'
  ];
  missing_constraint text;
BEGIN
  IF to_regclass('public.bundle_cards') IS NULL THEN
    RAISE EXCEPTION '0059 verify: bundle_cards is missing';
  END IF;
  IF to_regclass('public.item_embeddings') IS NULL THEN
    RAISE EXCEPTION '0059 verify: item_embeddings is missing';
  END IF;
  IF to_regclass('public.onet_element_definitions') IS NULL THEN
    RAISE EXCEPTION '0059 verify: onet_element_definitions is missing';
  END IF;
  IF to_regclass('public.bundle_mapping_runs') IS NULL THEN
    RAISE EXCEPTION '0059 verify: bundle_mapping_runs is missing';
  END IF;
  IF to_regclass('public.bundle_members') IS NULL THEN
    RAISE EXCEPTION '0059 verify: bundle_members is missing';
  END IF;
  IF to_regclass('public.bundle_mapping_outcomes') IS NULL THEN
    RAISE EXCEPTION '0059 verify: bundle_mapping_outcomes is missing';
  END IF;
  IF to_regclass('public.bundle_golden_samples') IS NULL THEN
    RAISE EXCEPTION '0059 verify: bundle_golden_samples is missing';
  END IF;
  IF to_regclass('public.bundle_golden_picks') IS NULL THEN
    RAISE EXCEPTION '0059 verify: bundle_golden_picks is missing';
  END IF;

  -- These three counts are only meaningful immediately after a fresh apply,
  -- before any load/draft/draw script has written anything (same caveat as
  -- P1's verify.sql on career_target_occupations/onet_release row counts).
  SELECT count(*) INTO n_members FROM bundle_members;
  IF n_members <> 0 THEN
    RAISE EXCEPTION '0059 verify: bundle_members has % row(s), expected 0 right after apply', n_members;
  END IF;
  SELECT count(*) INTO n_cards FROM bundle_cards;
  IF n_cards <> 0 THEN
    RAISE EXCEPTION '0059 verify: bundle_cards has % row(s), expected 0 right after apply', n_cards;
  END IF;
  SELECT count(*) INTO n_golden FROM bundle_golden_samples;
  IF n_golden <> 0 THEN
    RAISE EXCEPTION '0059 verify: bundle_golden_samples has % row(s), expected 0 right after apply', n_golden;
  END IF;

  -- bundle_members must have NO foreign key to any onet_* table (Global
  -- Constraints): load-onet.ts reloads a release by deleting
  -- onet_occupations, whose children cascade, and an FK here would silently
  -- wipe reviewed members on every reload.
  SELECT count(*) INTO n_onet_fks
    FROM pg_constraint
    WHERE conrelid = 'bundle_members'::regclass AND contype = 'f' AND confrelid::regclass::text LIKE 'onet_%';
  IF n_onet_fks <> 0 THEN
    RAISE EXCEPTION '0059 verify: bundle_members has % foreign key(s) to an onet_* table, expected 0', n_onet_fks;
  END IF;

  SELECT c INTO missing_constraint FROM unnest(expected_constraints) AS c
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c)
    LIMIT 1;
  IF missing_constraint IS NOT NULL THEN
    RAISE EXCEPTION '0059 verify: expected constraint "%" is missing', missing_constraint;
  END IF;

  RAISE NOTICE '0059 verify: all checks passed';
END $$;

ROLLBACK;
