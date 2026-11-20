-- 0072: competency_levels — one rule for a course version's level on a competency (spec 2026-11-20-links-drive-coverage-design.md).
-- Order: a faculty level, else an AI level, else the scorer's cell unless faculty rejected a link here and confirmed
-- none ('rejected', 0), else 'needs_level' (a faculty/AI-backed link but no level, 0). Foundational: K/U null.
-- The scorer's own proposed link counts only while its cell is above 0 and never outweighs a faculty rejection
-- (whole-branch review I-1, I-2).
-- Scorer rows pass through unfiltered, exactly as target_coverage read them before (day one is identical);
-- rows that exist only through links or roll-ups need a live snapshot and an active competency.
-- target_coverage keeps its columns and now reads competency_levels. Views only; no table or row changes.
BEGIN;

CREATE OR REPLACE VIEW competency_levels AS
WITH lk AS (
  SELECT snapshot_id, competency_id,
         -- a judgment that stands on its own: confirmed, or proposed by an AI judge or by faculty
         bool_or(status = 'confirmed' OR (status = 'proposed' AND source IN ('ai', 'faculty'))) AS judged,
         -- the scorer's own proposal: counts only while the scorer's cell is above 0 and faculty rejected nothing here
         bool_or(status = 'proposed' AND source = 'scoring') AS scorer_proposed,
         bool_or(status = 'rejected') AS any_rejected,
         max(coalesce(decided_at, created_at)) AS last_at
  FROM skill_competency_links
  GROUP BY snapshot_id, competency_id
),
pairs AS (
  SELECT snapshot_id, competency_id FROM snapshot_competency_coverage
  UNION
  SELECT r.snapshot_id, r.competency_id FROM competency_rollups r
    JOIN course_capture_snapshots s ON s.id = r.snapshot_id AND s.retired_at IS NULL
    JOIN sub_competencies sc ON sc.id = r.competency_id AND NOT sc.retired
  UNION
  SELECT l.snapshot_id, l.competency_id FROM lk l
    JOIN course_capture_snapshots s ON s.id = l.snapshot_id AND s.retired_at IS NULL
    JOIN sub_competencies sc ON sc.id = l.competency_id AND NOT sc.retired
  WHERE l.judged
),
j AS (
  SELECT p.snapshot_id, p.competency_id, sc.foundational, c.snapshot_id IS NOT NULL AS scored,
         c.k_depth AS ck, c.u_depth AS cu, c.d_depth AS cd, c.matched_competency, c.evidence_excerpt,
         c.confidence AS cconf, c.rationale AS crat, c.model AS cmodel, c.generated_at AS cat,
         r.method AS rmethod, r.k AS rk, r.u AS ru, r.d AS rd, r.rationale AS rrat, r.model AS rmodel,
         r.decided_by AS rby, r.created_at AS rat,
         coalesce(l.judged, false)
           OR (coalesce(l.scorer_proposed, false) AND NOT coalesce(l.any_rejected, false)
               AND c.snapshot_id IS NOT NULL AND greatest(coalesce(c.k_depth, 0), coalesce(c.u_depth, 0), c.d_depth) > 0) AS counting,
         coalesce(l.any_rejected, false) AS any_rejected, l.last_at
  FROM pairs p
  JOIN sub_competencies sc ON sc.id = p.competency_id
  LEFT JOIN snapshot_competency_coverage c ON c.snapshot_id = p.snapshot_id AND c.competency_id = p.competency_id
  LEFT JOIN competency_rollups r ON r.snapshot_id = p.snapshot_id AND r.competency_id = p.competency_id
  LEFT JOIN lk l ON l.snapshot_id = p.snapshot_id AND l.competency_id = p.competency_id
),
m AS (
  SELECT j.*,
    CASE
      WHEN rmethod = 'faculty' THEN 'faculty'
      WHEN rmethod = 'ai' THEN 'ai'
      WHEN any_rejected AND NOT counting THEN 'rejected'
      WHEN scored AND greatest(coalesce(ck, 0), coalesce(cu, 0), cd) > 0 THEN 'scoring'
      WHEN counting THEN 'needs_level'
      ELSE 'scoring'
    END AS method
  FROM j
)
SELECT snapshot_id, competency_id,
  CASE WHEN method = 'scoring' THEN ck WHEN foundational THEN NULL WHEN method IN ('faculty', 'ai') THEN rk ELSE 0 END AS k_depth,
  CASE WHEN method = 'scoring' THEN cu WHEN foundational THEN NULL WHEN method IN ('faculty', 'ai') THEN ru ELSE 0 END AS u_depth,
  CASE WHEN method = 'scoring' THEN cd WHEN method IN ('faculty', 'ai') THEN coalesce(rd, 0) ELSE 0 END AS d_depth,
  method,
  matched_competency,
  evidence_excerpt,
  CASE WHEN method = 'scoring' THEN cconf ELSE 'medium' END AS confidence,
  CASE method
    WHEN 'scoring' THEN crat
    WHEN 'faculty' THEN coalesce(rrat, 'Set by hand in the course builder')
    WHEN 'ai' THEN coalesce(rrat, 'AI judgment')
    WHEN 'rejected' THEN 'Rejected by faculty'
    ELSE 'Linked by faculty; needs a level'
  END AS rationale,
  CASE method
    WHEN 'scoring' THEN cmodel
    WHEN 'faculty' THEN 'faculty:' || rby
    WHEN 'ai' THEN coalesce(rmodel, 'ai')
    ELSE 'links'
  END AS model,
  CASE WHEN method = 'scoring' THEN cat WHEN method IN ('faculty', 'ai') THEN rat ELSE coalesce(last_at, cat) END AS generated_at,
  rrat AS rollup_rationale
FROM m;

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
FROM competency_levels c
JOIN career_target_membership m ON m.competency_id = c.competency_id;

COMMIT;
