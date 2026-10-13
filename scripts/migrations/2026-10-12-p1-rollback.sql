-- Rollback of migration 0058 (competency catalog P1: occupation mixes,
-- O*NET reference store, catalog origin). Purely additive migration, so the
-- rollback is purely subtractive: drop the six new tables (dependency order)
-- and the origin column. One transaction; a failed check changes nothing.
-- Not re-runnable: a second run stops at "rollback: 0058 is not applied".
--
-- App-code order (hostile-review fix wave, I-1, controller ruling —
-- corrects the claim this file used to make; recorded in STATE.md, not the
-- append-only plan): the DEPLOYED app's Drizzle schema names
-- sub_competencies.origin in every unprojected select/insert, so dropping
-- that column while the P1-era app is still running 500s the same two live
-- routes I-1 found for the forward migration. "Nothing outside P1 ever
-- reads these objects" is still true for the SIX NEW TABLES this file
-- drops — nothing but P1 reads career_target_occupations/onet_* — but it
-- was never true for the origin COLUMN once the app's schema named it.
-- Before running this rollback live: revert the app to its pre-P1 build
-- (or stop it) FIRST, then run this file, then redeploy.

BEGIN;

-- Final whole-branch review, I-3: same reasoning as 0058's own m5 fix —
-- DROP COLUMN takes AccessExclusiveLock until COMMIT. Fail fast rather
-- than stall readers; retry if this times out.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.career_target_occupations') IS NULL THEN
    RAISE EXCEPTION 'rollback: 0058 is not applied';
  END IF;
END $$;

-- Refuse if any competency would lose its provenance: a gc_authored or
-- onet_seeded row's origin is information that exists ONLY in this column —
-- dropping it would silently erase where that competency came from. Remove
-- (or re-origin, by hand) those rows first, on purpose.
DO $$
DECLARE
  n_protected int;
BEGIN
  SELECT count(*) INTO n_protected FROM sub_competencies WHERE origin IN ('gc_authored', 'onet_seeded');
  IF n_protected <> 0 THEN
    RAISE EXCEPTION 'rollback: precondition — % competency row(s) have origin gc_authored/onet_seeded and would lose their provenance; remove or re-origin them first', n_protected;
  END IF;
END $$;

-- Dependency order: children before parents (FKs use ON DELETE CASCADE, but
-- dropping children first means no CASCADE is ever exercised here).
DROP TABLE IF EXISTS onet_task_ratings;
DROP TABLE IF EXISTS onet_task_statements;
DROP TABLE IF EXISTS onet_element_ratings;
DROP TABLE IF EXISTS onet_occupations;
DROP TABLE IF EXISTS onet_release;
DROP TABLE IF EXISTS career_target_occupations;

ALTER TABLE sub_competencies DROP COLUMN origin;

COMMIT;
