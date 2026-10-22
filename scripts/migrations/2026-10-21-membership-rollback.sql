-- 2026-10-21-membership-rollback.sql — undo migration 0062.
-- Refuses while hidden rows exist (the old check would reject them) or while
-- onet/employer weight rows exist (under the old views they would become memberships).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regclass('public.career_target_membership') IS NULL THEN
    RAISE EXCEPTION 'rollback refused: 0062 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM career_target_requirements WHERE status = 'hidden') THEN
    RAISE EXCEPTION 'rollback refused: hidden rows exist; clear them first';
  END IF;
  IF EXISTS (SELECT 1 FROM career_target_requirements WHERE weight_source <> 'faculty') THEN
    RAISE EXCEPTION 'rollback refused: weight rows exist; run the P3 rollback note in STATE first';
  END IF;
END $$;

CREATE OR REPLACE VIEW target_sub_competencies AS
SELECT r.career_target_id,
       s.id,
       s.name,
       s.know_descriptor,
       s.understand_descriptor,
       s.do_descriptor,
       min(r.display_order) AS display_order,
       s.retired,
       s.updated_at
FROM career_target_requirements r
JOIN sub_competencies s ON s.id = r.competency_id
GROUP BY r.career_target_id, s.id;

CREATE OR REPLACE VIEW target_coverage AS
SELECT c.snapshot_id,
       m.career_target_id,
       c.competency_id AS sub_competency_id,
       c.k_depth,
       c.u_depth,
       c.d_depth,
       c.matched_competency,
       c.evidence_excerpt,
       c.confidence,
       c.rationale,
       c.model,
       c.generated_at
FROM snapshot_competency_coverage c
JOIN (SELECT DISTINCT career_target_id, competency_id FROM career_target_requirements) m
  ON m.competency_id = c.competency_id;

DROP TABLE career_target_membership;
ALTER TABLE career_target_requirements DROP CONSTRAINT career_target_requirements_status_check;
ALTER TABLE career_target_requirements ADD CONSTRAINT career_target_requirements_status_check
  CHECK (status IN ('draft', 'confirmed'));
COMMIT;
