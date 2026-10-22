-- 0062_career_target_membership.sql — which competencies a career target shows, decided by
-- pins, hides and importance weight (spec 2026-10-21-p3-membership-from-weights-design.md).
-- Membership is no longer "any career_target_requirements row": it is the derived table
-- career_target_membership, rewritten by rebuildMembership() (lib/db/membership-queries.ts).
-- Today's rows are all faculty links, so every existing pair becomes a pin (owner decision 2).
-- Live order: backup -> apply (this file) -> verify -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regclass('public.career_target_requirements') IS NULL THEN
    RAISE EXCEPTION '0062: precondition — 0056 is not applied';
  END IF;
  IF to_regclass('public.career_target_membership') IS NOT NULL THEN
    RAISE EXCEPTION '0062: already applied';
  END IF;
END $$;

ALTER TABLE career_target_requirements DROP CONSTRAINT career_target_requirements_status_check;
ALTER TABLE career_target_requirements ADD CONSTRAINT career_target_requirements_status_check
  CHECK (status IN ('draft', 'confirmed', 'hidden'));

CREATE TABLE career_target_membership (
  career_target_id text NOT NULL REFERENCES career_targets(id) ON DELETE CASCADE,
  competency_id text NOT NULL REFERENCES sub_competencies(id) ON DELETE CASCADE,
  basis text NOT NULL CHECK (basis IN ('pinned', 'weight')),
  effective_weight real CHECK (effective_weight IS NULL OR (effective_weight >= 0 AND effective_weight <= 1)),
  display_order integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (career_target_id, competency_id)
);
CREATE INDEX idx_career_target_membership_competency ON career_target_membership (competency_id);

INSERT INTO career_target_membership (career_target_id, competency_id, basis, effective_weight, display_order)
SELECT career_target_id, competency_id, 'pinned', NULL, min(display_order)
FROM career_target_requirements GROUP BY career_target_id, competency_id;

CREATE OR REPLACE VIEW target_sub_competencies AS
SELECT m.career_target_id,
       s.id,
       s.name,
       s.know_descriptor,
       s.understand_descriptor,
       s.do_descriptor,
       m.display_order,
       s.retired,
       s.updated_at
FROM career_target_membership m
JOIN sub_competencies s ON s.id = m.competency_id;

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
COMMIT;
