-- 2026-10-12-p0b-verify.sql — fail-closed verification for migration 0057 (P0b).
-- Run read-only right after applying 0057. Prints readable `-At` item/value
-- rows first, then a DO block re-derives every check and RAISEs on the first
-- failure — unlike the P0a verify script (2026-10-11-p0a-verify.sql), which
-- only printed "expect 0" rows and relied on a human reading them (P0a
-- adversarial review finding M-a). This script fails closed: a bad migration
-- makes the script itself error out, not just print a wrong number.
-- (Minor 4, Task 2 fix round 1) ON_ERROR_STOP so psql itself exits non-zero
-- on any statement error (e.g. a typo breaking a check) — belt-and-braces
-- with the fail-closed DO block below, not a substitute for it.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

-- M-1 (hostile review 2026-10-12): this script runs AFTER the migration
-- committed, so it has no way to see the pre-migration row count — a
-- hard-coded "expect 35" here would be exactly as wrong as the migration's
-- own old post-check was. Checked as a STRUCTURAL invariant instead: no
-- requirement still references a retired-merged competency, and the
-- survivor now has a requirement in every target that any group member
-- used (the same 5 (member, target) pairs the migration's own precondition
-- checks against — domain-knowledge absorbs account-management/ai-workflow/
-- production-operations; project-management absorbs production-operations).
SELECT 'requirements on a retired-merged competency (expect 0)' AS item, count(*)::text AS value
  FROM career_target_requirements r JOIN sub_competencies s ON s.id = r.competency_id
  WHERE s.merged_into IS NOT NULL
UNION ALL SELECT 'a merged competency''s target is missing its survivor requirement (expect 0)', count(*)::text
  FROM (VALUES
    ('account-management','domain-knowledge'), ('ai-workflow','domain-knowledge'),
    ('production-operations','domain-knowledge'), ('production-operations','project-management')
  ) AS expected(target_id, survivor_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM career_target_requirements r
    WHERE r.career_target_id = expected.target_id AND r.competency_id = expected.survivor_id)
UNION ALL SELECT 'sub_competency_map rows', count(*)::text FROM sub_competency_map
UNION ALL SELECT 'sub_competencies rows (expect = map rows)', count(*)::text FROM sub_competencies
UNION ALL SELECT 'snapshot_target_coverage exists (expect f)',
  (to_regclass('public.snapshot_target_coverage') IS NOT NULL)::text
UNION ALL SELECT 'coverage_scores exists (expect f)',
  (to_regclass('public.coverage_scores') IS NOT NULL)::text
UNION ALL SELECT 'sub_competencies.career_target_id exists (expect f)', (EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'sub_competencies' AND column_name = 'career_target_id'))::text
UNION ALL SELECT 'sub_competencies.display_order exists (expect f)', (EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'sub_competencies' AND column_name = 'display_order'))::text
UNION ALL SELECT 'non-retired snapshots missing a pre-merge group''s survivor cell (expect 0)', count(*)::text
  FROM (
    SELECT DISTINCT p.survivor, p.snapshot_id FROM (
      SELECT competency_id AS survivor, snapshot_id FROM p0b_premerge_survivor_coverage
      UNION
      SELECT m.competency_id AS survivor, c.snapshot_id
        FROM snapshot_competency_coverage c
        JOIN sub_competency_map m ON m.old_sub_competency_id = c.competency_id AND m.old_sub_competency_id <> m.competency_id
    ) p
    JOIN course_capture_snapshots s ON s.id = p.snapshot_id AND s.retired_at IS NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM snapshot_competency_coverage have
      WHERE have.snapshot_id = p.snapshot_id AND have.competency_id = p.survivor)
  ) missing
UNION ALL SELECT 'target_coverage rows (actual)', count(*)::text FROM target_coverage
UNION ALL SELECT 'target_coverage rows (expected, from requirement memberships)', coalesce(sum(cnt), 0)::text
  FROM (
    SELECT (SELECT count(*) FROM snapshot_competency_coverage c WHERE c.competency_id = r.competency_id) AS cnt
    FROM (SELECT DISTINCT career_target_id, competency_id FROM career_target_requirements) r
  ) x
UNION ALL SELECT 'open P0b disagreement flags not on a survivor (expect 0)', count(*)::text
  FROM faculty_flags
  WHERE flagged_by = 'P0b merge (system)' AND status = 'open'
    AND sub_competency_id NOT IN ('domain-knowledge', 'project-management');

DO $$
DECLARE
  n_bad_req int;
  n_missing_survivor_req int;
  n_map int;
  n_subs int;
  n_missing_survivor int;
  n_tc_actual bigint;
  n_tc_expected bigint;
  n_bad_flags int;
BEGIN
  SELECT count(*) INTO n_bad_req FROM career_target_requirements r
    JOIN sub_competencies s ON s.id = r.competency_id WHERE s.merged_into IS NOT NULL;
  IF n_bad_req <> 0 THEN
    RAISE EXCEPTION '0057 verify: % requirement row(s) reference a retired-merged competency', n_bad_req;
  END IF;

  -- M-1: structural invariant, not a pre-migration-relative count this
  -- script has no way to compute (see the comment on the printed row above).
  SELECT count(*) INTO n_missing_survivor_req FROM (VALUES
      ('account-management','domain-knowledge'), ('ai-workflow','domain-knowledge'),
      ('production-operations','domain-knowledge'), ('production-operations','project-management')
    ) AS expected(target_id, survivor_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM career_target_requirements r
      WHERE r.career_target_id = expected.target_id AND r.competency_id = expected.survivor_id);
  IF n_missing_survivor_req <> 0 THEN
    RAISE EXCEPTION '0057 verify: % merge target(s) are missing their survivor''s requirement row', n_missing_survivor_req;
  END IF;

  SELECT count(*) INTO n_map FROM sub_competency_map;
  SELECT count(*) INTO n_subs FROM sub_competencies;
  IF n_map <> n_subs THEN
    RAISE EXCEPTION '0057 verify: sub_competency_map has % row(s) but there are % sub_competencies', n_map, n_subs;
  END IF;

  IF to_regclass('public.snapshot_target_coverage') IS NOT NULL THEN
    RAISE EXCEPTION '0057 verify: snapshot_target_coverage still exists';
  END IF;
  IF to_regclass('public.coverage_scores') IS NOT NULL THEN
    RAISE EXCEPTION '0057 verify: coverage_scores still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'sub_competencies' AND column_name = 'career_target_id') THEN
    RAISE EXCEPTION '0057 verify: sub_competencies.career_target_id still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'sub_competencies' AND column_name = 'display_order') THEN
    RAISE EXCEPTION '0057 verify: sub_competencies.display_order still exists';
  END IF;

  SELECT count(*) INTO n_missing_survivor FROM (
    SELECT DISTINCT p.survivor, p.snapshot_id FROM (
      SELECT competency_id AS survivor, snapshot_id FROM p0b_premerge_survivor_coverage
      UNION
      SELECT m.competency_id AS survivor, c.snapshot_id
        FROM snapshot_competency_coverage c
        JOIN sub_competency_map m ON m.old_sub_competency_id = c.competency_id AND m.old_sub_competency_id <> m.competency_id
    ) p
    JOIN course_capture_snapshots s ON s.id = p.snapshot_id AND s.retired_at IS NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM snapshot_competency_coverage have
      WHERE have.snapshot_id = p.snapshot_id AND have.competency_id = p.survivor)
  ) missing;
  IF n_missing_survivor <> 0 THEN
    RAISE EXCEPTION '0057 verify: % non-retired snapshot(s) are missing a survivor cell for a pre-merge group they had a cell in', n_missing_survivor;
  END IF;

  SELECT count(*) INTO n_tc_actual FROM target_coverage;
  SELECT coalesce(sum(cnt), 0) INTO n_tc_expected FROM (
    SELECT (SELECT count(*) FROM snapshot_competency_coverage c WHERE c.competency_id = r.competency_id) AS cnt
    FROM (SELECT DISTINCT career_target_id, competency_id FROM career_target_requirements) r
  ) x;
  IF n_tc_actual <> n_tc_expected THEN
    RAISE EXCEPTION '0057 verify: target_coverage has % rows, expected % from requirement memberships', n_tc_actual, n_tc_expected;
  END IF;

  SELECT count(*) INTO n_bad_flags FROM faculty_flags
    WHERE flagged_by = 'P0b merge (system)' AND status = 'open'
      AND sub_competency_id NOT IN ('domain-knowledge', 'project-management');
  IF n_bad_flags <> 0 THEN
    RAISE EXCEPTION '0057 verify: % open P0b disagreement flag(s) target a non-survivor competency', n_bad_flags;
  END IF;

  RAISE NOTICE '0057 verify: all checks passed';
END $$;

ROLLBACK;
