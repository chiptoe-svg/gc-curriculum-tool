-- Rollback of migration 0058 (competency catalog P1: occupation mixes,
-- O*NET reference store, catalog origin). Purely additive migration, so the
-- rollback is purely subtractive: drop the six new tables (dependency order)
-- and the origin column. Nothing outside P1 ever reads these objects, so no
-- app stop or data carry is needed, unlike 0056/0057's rollbacks.
-- One transaction; a failed check changes nothing. Not re-runnable: a
-- second run stops at "rollback: 0058 is not applied".

BEGIN;

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
