-- 0056 — Competency catalog, phase P0a: structure only, no behavior change.
-- Spec: docs/superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md (§3, §4, §8 P0a)
-- Plan: docs/superpowers/plans/2026-10-11-competency-catalog-p0a.md
-- HAND-WRITTEN, applied with psql (same convention as 0051-0055: drizzle/meta is
-- git-ignored and stale here — see docs/STATE.md Deferred / debt).
--
-- One transaction; any failed check rolls everything back.
--   * sub_competencies becomes the shared catalog: career_target_id loses NOT
--     NULL (kept and still written as a deprecated mirror; nothing reads it).
--     Ids are unchanged, so prerequisite_edges, course_intended_coverage and
--     faculty_flags are untouched.
--   * career_target_requirements records which targets use each competency.
--     Seeded with one row per (target, sub-competency) pair, retired ones
--     included: horizon 'entry', weight NULL, weight_source 'faculty', status
--     'draft' — nothing silently gains a weight.
--   * snapshot_competency_coverage, keyed (snapshot, competency): every
--     snapshot_target_coverage row copied unchanged (1:1 — no merges in P0a).
--   * Views target_sub_competencies and target_coverage rebuild the old
--     per-target shapes through career_target_requirements.
--   * snapshot_target_coverage stays as a read-only backup (dropped in P0b).
--     career_target_demand and coverage_scores (0 rows) are left as they are.
--
-- Safe to re-run while the new table still equals the backup (a no-op). Once
-- the new code has written coverage, a re-run stops at the divergence check and
-- changes nothing. Rollback: scripts/migrations/2026-10-11-p0a-rollback.sql.
-- Apply with the app stopped — run scripts/migrations/2026-10-11-p0a-live-apply.sh.

BEGIN;

-- Lock before any check: a write committed between the post-checks and COMMIT
-- (e.g. an UPDATE on an existing coverage cell) would otherwise be lost —
-- found by adversarial review 2026-10-11 (I-1/M-1), reproduced with a
-- pg_sleep before COMMIT. SHARE ROW EXCLUSIVE blocks other writers to these
-- two tables for the rest of the transaction without blocking readers.
LOCK TABLE snapshot_target_coverage, sub_competencies IN SHARE ROW EXCLUSIVE MODE;

-- 1. Preconditions ------------------------------------------------------------
DO $$
DECLARE
  diverged boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM snapshot_target_coverage c
    JOIN sub_competencies s ON s.id = c.sub_competency_id
    WHERE s.career_target_id IS DISTINCT FROM c.career_target_id
  ) THEN
    RAISE EXCEPTION '0056: a snapshot_target_coverage row is filed under a target that does not own its sub-competency; the 1:1 carry-over is not valid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM snapshot_target_coverage
    GROUP BY snapshot_id, sub_competency_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0056: a (snapshot, sub-competency) pair has coverage under more than one target';
  END IF;

  -- After cutover the new code writes only snapshot_competency_coverage, so any
  -- row there that differs from the backup in ANY column (or is missing from
  -- it, or a backup row missing from it) means the new code is live. Compare
  -- every column, not just generated_at (M-2, adversarial review case 1c: a
  -- depth-only change with generated_at unchanged used to pass this guard and
  -- only fail later, at the post-check, with a confusing message). The
  -- message itself stays neutral: either side could have written the change
  -- (case 1g: the OLD code writing the backup after an apply looks identical
  -- from here), so this never claims to know which code is live.
  IF to_regclass('public.snapshot_competency_coverage') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM snapshot_competency_coverage n
        LEFT JOIN snapshot_target_coverage o
          ON o.snapshot_id = n.snapshot_id AND o.sub_competency_id = n.competency_id
        WHERE o.snapshot_id IS NULL
           OR o.k_depth IS DISTINCT FROM n.k_depth
           OR o.u_depth IS DISTINCT FROM n.u_depth
           OR o.d_depth IS DISTINCT FROM n.d_depth
           OR o.matched_competency IS DISTINCT FROM n.matched_competency
           OR o.evidence_excerpt IS DISTINCT FROM n.evidence_excerpt
           OR o.confidence IS DISTINCT FROM n.confidence
           OR o.rationale IS DISTINCT FROM n.rationale
           OR o.model IS DISTINCT FROM n.model
           OR o.generated_at IS DISTINCT FROM n.generated_at
      ) OR EXISTS (
        SELECT 1 FROM snapshot_target_coverage o
        LEFT JOIN snapshot_competency_coverage n
          ON n.snapshot_id = o.snapshot_id AND n.competency_id = o.sub_competency_id
        WHERE n.snapshot_id IS NULL
      )
    $q$ INTO diverged;
    IF diverged THEN
      RAISE EXCEPTION '0056: the two coverage tables differ — do not re-run this migration';
    END IF;
  END IF;
END $$;

-- 2. The catalog: career_target_id no longer means ownership -------------------
ALTER TABLE sub_competencies ALTER COLUMN career_target_id DROP NOT NULL;

-- 3. Target requirements -------------------------------------------------------
CREATE TABLE IF NOT EXISTS career_target_requirements (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  career_target_id          text NOT NULL,
  competency_id             text NOT NULL,
  horizon                   text NOT NULL,
  weight                    real,
  weight_source             text NOT NULL,
  required_k                integer,
  required_u                integer,
  required_d                integer,
  depth_source              text,
  status                    text NOT NULL DEFAULT 'draft',
  note                      text,
  contributing_position_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order             integer NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_target_requirements_target_fk FOREIGN KEY (career_target_id)
    REFERENCES career_targets(id) ON DELETE CASCADE,
  CONSTRAINT career_target_requirements_competency_fk FOREIGN KEY (competency_id)
    REFERENCES sub_competencies(id) ON DELETE CASCADE,
  CONSTRAINT career_target_requirements_unique
    UNIQUE (career_target_id, competency_id, horizon, weight_source),
  CONSTRAINT career_target_requirements_horizon_check CHECK (horizon IN ('entry', 'growth')),
  CONSTRAINT career_target_requirements_weight_check CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
  CONSTRAINT career_target_requirements_weight_source_check CHECK (weight_source IN ('onet', 'employer', 'faculty')),
  CONSTRAINT career_target_requirements_depth_source_check CHECK (depth_source IS NULL OR depth_source IN ('onet', 'employer', 'faculty')),
  CONSTRAINT career_target_requirements_depth_check CHECK (
    (required_k IS NULL OR required_k BETWEEN 0 AND 5) AND
    (required_u IS NULL OR required_u BETWEEN 0 AND 5) AND
    (required_d IS NULL OR required_d BETWEEN 0 AND 5)),
  CONSTRAINT career_target_requirements_status_check CHECK (status IN ('draft', 'confirmed'))
);
CREATE INDEX IF NOT EXISTS idx_career_target_requirements_competency
  ON career_target_requirements (competency_id);

INSERT INTO career_target_requirements
  (career_target_id, competency_id, horizon, weight, weight_source, status, display_order)
SELECT s.career_target_id, s.id, 'entry', NULL, 'faculty', 'draft', s.display_order
FROM sub_competencies s
WHERE s.career_target_id IS NOT NULL
ON CONFLICT ON CONSTRAINT career_target_requirements_unique DO NOTHING;

-- 4. Per-competency coverage ----------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshot_competency_coverage (
  snapshot_id        uuid NOT NULL,
  competency_id      text NOT NULL,
  k_depth            integer,
  u_depth            integer,
  d_depth            integer NOT NULL,
  matched_competency text,
  evidence_excerpt   text,
  confidence         text NOT NULL,
  rationale          text NOT NULL,
  model              text NOT NULL,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snapshot_competency_coverage_pk PRIMARY KEY (snapshot_id, competency_id),
  CONSTRAINT snapshot_competency_coverage_snapshot_fk FOREIGN KEY (snapshot_id)
    REFERENCES course_capture_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT snapshot_competency_coverage_competency_fk FOREIGN KEY (competency_id)
    REFERENCES sub_competencies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snapshot_competency_coverage_competency
  ON snapshot_competency_coverage (competency_id);

INSERT INTO snapshot_competency_coverage
  (snapshot_id, competency_id, k_depth, u_depth, d_depth, matched_competency, evidence_excerpt,
   confidence, rationale, model, generated_at)
SELECT snapshot_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency, evidence_excerpt,
       confidence, rationale, model, generated_at
FROM snapshot_target_coverage
ON CONFLICT ON CONSTRAINT snapshot_competency_coverage_pk DO NOTHING;

-- 5. Views: the old per-target shapes, through career_target_requirements ------
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

-- 6. Post-checks ---------------------------------------------------------------
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM sub_competencies s
  WHERE s.career_target_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM target_sub_competencies m
      WHERE m.id = s.id AND m.career_target_id = s.career_target_id AND m.display_order = s.display_order);
  IF n > 0 THEN
    RAISE EXCEPTION '0056: % sub-competencies have no matching target membership', n;
  END IF;

  IF EXISTS (
    SELECT competency_id FROM career_target_requirements
    GROUP BY competency_id HAVING count(DISTINCT career_target_id) > 1
  ) THEN
    RAISE EXCEPTION '0056: a competency belongs to more than one target (not expected in P0a)';
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
           matched_competency, evidence_excerpt, confidence, rationale, model, generated_at
    FROM snapshot_target_coverage
    EXCEPT ALL
    SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
           matched_competency, evidence_excerpt, confidence, rationale, model, generated_at
    FROM target_coverage
  ) missing;
  IF n > 0 THEN
    RAISE EXCEPTION '0056: % coverage rows did not carry over unchanged', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
           matched_competency, evidence_excerpt, confidence, rationale, model, generated_at
    FROM target_coverage
    EXCEPT ALL
    SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
           matched_competency, evidence_excerpt, confidence, rationale, model, generated_at
    FROM snapshot_target_coverage
  ) extra;
  IF n > 0 THEN
    RAISE EXCEPTION '0056: % coverage rows in the new table have no identical old row', n;
  END IF;
END $$;

COMMIT;
