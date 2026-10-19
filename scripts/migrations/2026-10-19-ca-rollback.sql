-- Rollback of migration 0060 (catalog foundationals: foundational flag,
-- derived scoring, nullable K/U descriptors). One transaction; a failed check
-- changes nothing. Not re-runnable: a second run stops at
-- "rollback: 0060 is not applied".
--
-- App-code order (same reason as the P1 rollback's I-1 note): the deployed app's
-- Drizzle schema names sub_competencies.foundational / .scoring in every
-- unprojected select/insert, so dropping those columns while the 0060-era
-- build is still running 500s its routes. Before running this rollback live:
-- revert the app to its pre-0060 build (or stop it) FIRST, then run this
-- file, then redeploy.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sub_competencies' AND column_name = 'foundational') THEN
    RAISE EXCEPTION 'rollback: 0060 is not applied';
  END IF;
END $$;

-- Restoring NOT NULL over null descriptors is impossible, and derived rows
-- carry meaning only in the dropped column. Remove those rows first, on purpose.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sub_competencies WHERE foundational OR scoring = 'derived') THEN
    RAISE EXCEPTION 'rollback: foundational or derived rows exist — run scripts/migrations/2026-10-19-ca-remove-additions.sql first (it removes the 2026-10-19 additions; it does not restore the two revised descriptors)';
  END IF;
END $$;

ALTER TABLE sub_competencies DROP CONSTRAINT sub_competencies_foundational_ku_check;
ALTER TABLE sub_competencies DROP CONSTRAINT sub_competencies_scoring_check;
ALTER TABLE sub_competencies ALTER COLUMN know_descriptor SET NOT NULL;
ALTER TABLE sub_competencies ALTER COLUMN understand_descriptor SET NOT NULL;
ALTER TABLE sub_competencies DROP COLUMN foundational;
ALTER TABLE sub_competencies DROP COLUMN scoring;

COMMIT;
