-- Rollback of migration 0056 (competency catalog P0a).
-- Run with the app STOPPED, then deploy the pre-P0a commit.
-- After cutover snapshot_competency_coverage is authoritative, so the old table
-- is rebuilt from it: cells re-scored or invalidated after cutover carry back.
-- One transaction; a failed check changes nothing. Not re-runnable: a second
-- run stops at "0056 is not applied".

BEGIN;

-- Existence-only check first (catalog metadata, no table lock needed) so an
-- un-applied 0056 still fails with the clean message below instead of a raw
-- "relation does not exist" from locking a table that was never created.
DO $$
BEGIN
  IF to_regclass('public.career_target_requirements') IS NULL THEN
    RAISE EXCEPTION 'rollback: 0056 is not applied';
  END IF;
END $$;

-- Lock before any check that reads mutable data, same reasoning as 0056's
-- M-1 fix: a write committed between the post-checks and COMMIT would
-- otherwise be lost.
LOCK TABLE snapshot_competency_coverage, career_target_requirements, sub_competencies IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sub_competencies WHERE career_target_id IS NULL) THEN
    RAISE EXCEPTION 'rollback: a competency has no owning target (created outside P0a); resolve by hand';
  END IF;
  IF EXISTS (
    SELECT competency_id FROM career_target_requirements
    GROUP BY competency_id HAVING count(DISTINCT career_target_id) > 1
  ) THEN
    RAISE EXCEPTION 'rollback: a competency is used by more than one target (P0b data); the old schema cannot hold it';
  END IF;
  IF EXISTS (
    SELECT 1 FROM career_target_requirements r
    JOIN sub_competencies s ON s.id = r.competency_id
    WHERE r.career_target_id <> s.career_target_id
  ) THEN
    RAISE EXCEPTION 'rollback: a requirement names a target other than the competency''s owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM snapshot_competency_coverage c
    WHERE NOT EXISTS (SELECT 1 FROM career_target_requirements r WHERE r.competency_id = c.competency_id)
  ) THEN
    RAISE EXCEPTION 'rollback: a coverage row has no target membership';
  END IF;
END $$;

DELETE FROM snapshot_target_coverage;

INSERT INTO snapshot_target_coverage
  (snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
   evidence_excerpt, confidence, rationale, model, generated_at)
SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
       evidence_excerpt, confidence, rationale, model, generated_at
FROM target_coverage;

UPDATE sub_competencies s
SET display_order = m.display_order
FROM target_sub_competencies m
WHERE m.id = s.id AND s.display_order <> m.display_order;

ALTER TABLE sub_competencies ALTER COLUMN career_target_id SET NOT NULL;

DO $$
BEGIN
  IF (SELECT count(*) FROM snapshot_target_coverage) <> (SELECT count(*) FROM snapshot_competency_coverage) THEN
    RAISE EXCEPTION 'rollback: coverage row count mismatch after rebuild';
  END IF;
END $$;

DROP VIEW IF EXISTS target_coverage;
DROP VIEW IF EXISTS target_sub_competencies;
DROP TABLE IF EXISTS snapshot_competency_coverage;
DROP TABLE IF EXISTS career_target_requirements;

COMMIT;
