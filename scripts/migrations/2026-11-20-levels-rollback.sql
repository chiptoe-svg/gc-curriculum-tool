-- Undo 0072: target_coverage back over the scorer's table (0062's definition), then drop competency_levels.
BEGIN;
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
JOIN career_target_membership m ON m.competency_id = c.competency_id;
DROP VIEW competency_levels;
COMMIT;
