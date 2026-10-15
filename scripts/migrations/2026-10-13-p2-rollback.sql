-- Rollback of migration 0059 (competency catalog P2: bundle membership).
-- Purely subtractive: drops the eight P2 tables. One transaction.
-- Not re-runnable: a second run stops at "rollback: 0059 is not applied".
-- App-code order: revert the app to its pre-P2 build FIRST (the P2 build's
-- /admin/bundles and /api/admin/bundles/* read these tables), then run this
-- file, then redeploy.
-- Refuses while human review work exists (Ruling 14): export or delete
-- confirmed/rejected members and golden picks on purpose first.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF to_regclass('public.bundle_members') IS NULL THEN
    RAISE EXCEPTION 'rollback: 0059 is not applied';
  END IF;
END $$;

DO $$
DECLARE n_reviewed int; n_picks int;
BEGIN
  SELECT count(*) INTO n_reviewed FROM bundle_members WHERE status <> 'proposed';
  SELECT count(*) INTO n_picks FROM bundle_golden_picks;
  IF n_reviewed <> 0 OR n_picks <> 0 THEN
    RAISE EXCEPTION 'rollback: precondition — % reviewed member(s) and % golden pick(s) exist; export or delete them on purpose first', n_reviewed, n_picks;
  END IF;
END $$;

DROP TABLE IF EXISTS bundle_golden_picks;
DROP TABLE IF EXISTS bundle_golden_samples;
DROP TABLE IF EXISTS bundle_mapping_outcomes;
DROP TABLE IF EXISTS bundle_members;
DROP TABLE IF EXISTS bundle_mapping_runs;
DROP TABLE IF EXISTS onet_element_definitions;
DROP TABLE IF EXISTS item_embeddings;
DROP TABLE IF EXISTS bundle_cards;

COMMIT;
