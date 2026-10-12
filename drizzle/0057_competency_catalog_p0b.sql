-- 0057_competency_catalog_p0b.sql — competency merges + P0a scaffolding drop.
-- Apply with the app stopped — run scripts/migrations/2026-10-12-p0b-live-apply.sh.
-- Owner decisions 2026-10-12: domain-knowledge <- gc-production-literacy + domain-grounding;
-- project-management <- timeline-management. Plan: docs/superpowers/plans/2026-10-12-competency-catalog-p0b.md
BEGIN;

LOCK TABLE sub_competencies, career_target_requirements, snapshot_competency_coverage,
  course_intended_coverage, prerequisite_edges, faculty_flags IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.sub_competency_map') IS NOT NULL THEN
    RAISE EXCEPTION '0057: already applied (sub_competency_map exists)';
  END IF;
  IF to_regclass('public.snapshot_target_coverage') IS NULL OR to_regclass('public.target_coverage') IS NULL THEN
    RAISE EXCEPTION '0057: precondition — P0a (0056) is not applied';
  END IF;
  IF (SELECT count(*) FROM sub_competencies
      WHERE id IN ('domain-knowledge','project-management','gc-production-literacy','domain-grounding','timeline-management')
        AND NOT retired) <> 5 THEN
    RAISE EXCEPTION '0057: precondition — a merge competency is missing or already retired';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('gc-production-literacy','account-management'), ('domain-grounding','ai-workflow'),
      ('timeline-management','production-operations'), ('domain-knowledge','production-operations'),
      ('project-management','production-operations')) e(cid, tid)
    WHERE (SELECT array_agg(DISTINCT career_target_id) FROM career_target_requirements WHERE competency_id = e.cid)
          IS DISTINCT FROM ARRAY[e.tid]) THEN
    RAISE EXCEPTION '0057: precondition — a merge competency is not in exactly its expected target';
  END IF;
END $$;

CREATE TEMP TABLE merge_plan (old_id text PRIMARY KEY, survivor text NOT NULL, note text NOT NULL) ON COMMIT DROP;
INSERT INTO merge_plan VALUES
  ('gc-production-literacy', 'domain-knowledge',  'Owner merge #1 (2026-10-12): production domain knowledge'),
  ('domain-grounding',       'domain-knowledge',  'Owner merge #1 (2026-10-12): production domain knowledge'),
  ('timeline-management',    'project-management','Owner merge #2 (2026-10-12): scheduling folded into project management');

CREATE TEMP TABLE merge_group ON COMMIT DROP AS
  SELECT survivor, old_id AS member FROM merge_plan
  UNION SELECT DISTINCT survivor, survivor FROM merge_plan;

-- 1. New catalog columns and tables.
ALTER TABLE sub_competencies ADD COLUMN merged_into text REFERENCES sub_competencies(id) ON DELETE RESTRICT;
ALTER TABLE sub_competencies ADD CONSTRAINT sub_competencies_merged_into_retired_check
  CHECK (merged_into IS NULL OR retired);
CREATE TABLE sub_competency_map (
  old_sub_competency_id text PRIMARY KEY REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  competency_id text NOT NULL REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  merge_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE p0b_premerge_survivor_coverage AS
  SELECT c.* FROM snapshot_competency_coverage c
  WHERE c.competency_id IN (SELECT DISTINCT survivor FROM merge_plan);

-- 2. Survivor descriptors (owner-approved text, 2026-10-12).
UPDATE sub_competencies SET
  name = 'Production domain knowledge: processes, substrates, materials and equipment',
  know_descriptor = 'Knows what print, packaging and brand production processes can and cannot do — substrates, inks, finishing, and the equipment and technology involved — well enough to judge whether a design, specification, workflow or AI output is producible and fit for purpose.',
  understand_descriptor = 'Understands why material, process and equipment constraints shape what is creatively and commercially possible, and why advice or systems built without this knowledge look right but fail at the point of production.',
  do_descriptor = 'Uses this knowledge on real production decisions: specifies substrate and finishing for a job, briefs a production team or a sales engineer accurately, or shows with specific production reasons where a workflow, template or AI step would succeed or fail. (Color management — profiles, calibration, process control — is scored under Color management, not here.)',
  updated_at = now()
WHERE id = 'domain-knowledge';
UPDATE sub_competencies SET
  know_descriptor = 'Knows the project life cycle (scope, plan, schedule, budget, risk, change control, close-out) and its tools — work breakdown, dependencies, critical path, status reporting — and the lead-time structure of print and packaging production at varying complexity.',
  understand_descriptor = 'Understands why projects fail at scope and handoff rather than at execution, why schedule slippage compounds and early warning signals matter more than aggressive deadlines, and why a plan has to be re-baselined when scope, budget or dates change.',
  do_descriptor = 'Plans and runs a real creative or production project from brief to delivery: defines scope, builds the schedule and budget across vendors or teams, surfaces timeline risk early enough to act, tracks changes, reports status, and closes out with a lessons-learned record.',
  updated_at = now()
WHERE id = 'project-management';

-- 3. Coverage carry (Ruling 3). Merged-away cells stay as history. Runs
-- BEFORE the disagreement flags below, because flagged_context (Ruling 4,
-- amended 2026-10-12) needs the CARRIED survivor cell, not the pre-merge one.
WITH ranked AS (
  SELECT g.survivor, c.*,
         row_number() OVER (PARTITION BY g.survivor, c.snapshot_id ORDER BY
           c.d_depth DESC, coalesce(c.u_depth,-1) DESC, coalesce(c.k_depth,-1) DESC,
           CASE c.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           (c.competency_id = g.survivor) DESC, c.competency_id) AS rn
  FROM merge_group g JOIN snapshot_competency_coverage c ON c.competency_id = g.member
)
INSERT INTO snapshot_competency_coverage (snapshot_id, competency_id, k_depth, u_depth, d_depth,
  matched_competency, evidence_excerpt, confidence, rationale, model, generated_at)
SELECT snapshot_id, survivor, k_depth, u_depth, d_depth, matched_competency, evidence_excerpt, confidence,
       CASE WHEN competency_id = survivor THEN rationale
            ELSE '[P0b merge: carried from ' || competency_id || '] ' || rationale END,
       model, generated_at
FROM ranked WHERE rn = 1
ON CONFLICT (snapshot_id, competency_id) DO UPDATE SET
  k_depth = EXCLUDED.k_depth, u_depth = EXCLUDED.u_depth, d_depth = EXCLUDED.d_depth,
  matched_competency = EXCLUDED.matched_competency, evidence_excerpt = EXCLUDED.evidence_excerpt,
  confidence = EXCLUDED.confidence, rationale = EXCLUDED.rationale, model = EXCLUDED.model,
  generated_at = EXCLUDED.generated_at;

-- 4. Disagreement flags (Ruling 4, amended 2026-10-12 — see plan amendment
-- under Ruling 4). Flag condition unchanged: one open flag per (course,
-- survivor) where some non-retired snapshot's group cells differ by 2+ on
-- any axis. The note and flagged_context both come from ONE representative
-- snapshot per (course, survivor) — the course's latest non-retired
-- snapshot with group cells (created_at DESC, then id DESC) — and
-- flagged_context is built from that snapshot's CARRIED survivor cell
-- (hence this runs after step 3 above). The gap/detail condition itself
-- must stay on the PRE-merge member cells (unchanged from before this
-- amendment) — step 3 already overwrote the survivor's own row in
-- snapshot_competency_coverage by this point, so the survivor's pre-merge
-- cell comes from p0b_premerge_survivor_coverage (captured in step 1,
-- before the overwrite) instead; the merged-away members' rows are never
-- touched by the carry (Ruling 2), so they are read as-is.
WITH group_cells AS (
  SELECT g.survivor, g.member, c.snapshot_id, c.k_depth, c.u_depth, c.d_depth
  FROM merge_group g
  JOIN snapshot_competency_coverage c ON c.competency_id = g.member
  WHERE g.member <> g.survivor
  UNION ALL
  SELECT p.competency_id AS survivor, p.competency_id AS member, p.snapshot_id, p.k_depth, p.u_depth, p.d_depth
  FROM p0b_premerge_survivor_coverage p
),
snap_gap AS (
  SELECT gc.survivor, s.course_code, gc.snapshot_id, s.created_at,
         greatest(max(coalesce(gc.k_depth,0)) - min(coalesce(gc.k_depth,0)),
                  max(coalesce(gc.u_depth,0)) - min(coalesce(gc.u_depth,0)),
                  max(gc.d_depth) - min(gc.d_depth)) AS gap,
         string_agg(gc.member || ' K' || coalesce(gc.k_depth::text,'-') || '/U' || coalesce(gc.u_depth::text,'-') || '/D' || gc.d_depth,
                    '; ' ORDER BY gc.member) AS detail
  FROM group_cells gc
  JOIN course_capture_snapshots s ON s.id = gc.snapshot_id AND s.retired_at IS NULL
  GROUP BY gc.survivor, s.course_code, gc.snapshot_id, s.created_at
),
course_summary AS (
  SELECT survivor, course_code, count(*) AS n_captures, max(gap) AS max_gap
  FROM snap_gap GROUP BY 1, 2
),
representative AS (
  SELECT survivor, course_code,
         (array_agg(snapshot_id ORDER BY created_at DESC, snapshot_id DESC))[1] AS snapshot_id,
         (array_agg(detail ORDER BY created_at DESC, snapshot_id DESC))[1] AS detail
  FROM snap_gap GROUP BY survivor, course_code
)
INSERT INTO faculty_flags (target_kind, course_code, career_target_id, sub_competency_id, note, flagged_by, flagged_context)
SELECT 'coverage_cell'::flag_target_kind, r.course_code, 'production-operations', r.survivor,
       'Before the P0b merge into ' || r.survivor || ', the merged competencies disagreed by 2+ levels for this course: '
         || r.detail || '. Largest gap across ' || cs.n_captures || ' captures: ' || cs.max_gap
         || '. Re-scored against the merged descriptor; please check the new reading.',
       'P0b merge (system)',
       jsonb_build_object('k', sc.k_depth, 'u', sc.u_depth, 'd', sc.d_depth,
                           'matchedCompetency', sc.matched_competency, 'rationale', sc.rationale)
FROM representative r
JOIN course_summary cs ON cs.survivor = r.survivor AND cs.course_code = r.course_code
JOIN snapshot_competency_coverage sc ON sc.snapshot_id = r.snapshot_id AND sc.competency_id = r.survivor
WHERE cs.max_gap >= 2;

-- 5. Intended coverage: carry the best group row to the survivor, remove merged-away rows.
WITH ranked AS (
  SELECT g.survivor, i.*,
         row_number() OVER (PARTITION BY g.survivor, i.course_code ORDER BY
           coalesce(i.intended_d,-1) DESC, coalesce(i.intended_u,-1) DESC, coalesce(i.intended_k,-1) DESC,
           CASE i.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           (i.sub_competency_id = g.survivor) DESC, i.sub_competency_id) AS rn
  FROM merge_group g JOIN course_intended_coverage i ON i.sub_competency_id = g.member
)
INSERT INTO course_intended_coverage (course_code, sub_competency_id, intended_k, intended_u, intended_d,
  confidence, rationale, model, generated_at)
SELECT course_code, survivor, intended_k, intended_u, intended_d, confidence, rationale, model, generated_at
FROM ranked WHERE rn = 1
ON CONFLICT (course_code, sub_competency_id) DO UPDATE SET
  intended_k = EXCLUDED.intended_k, intended_u = EXCLUDED.intended_u, intended_d = EXCLUDED.intended_d,
  confidence = EXCLUDED.confidence, rationale = EXCLUDED.rationale, model = EXCLUDED.model,
  generated_at = EXCLUDED.generated_at;
DELETE FROM course_intended_coverage WHERE sub_competency_id IN (SELECT old_id FROM merge_plan);

-- 6. Prerequisite edges: keep the best edge per (focal, prereq, survivor); confirmed beats depth.
WITH ranked AS (
  SELECT e.id, g.survivor,
         row_number() OVER (PARTITION BY e.focal_course_code, e.prereq_course_code, g.survivor ORDER BY
           e.confirmed DESC, coalesce(e.expected_d,-1) DESC, coalesce(e.expected_u,-1) DESC,
           coalesce(e.expected_k,-1) DESC, CASE e.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           (e.sub_competency_id = g.survivor) DESC, e.sub_competency_id) AS rn
  FROM merge_group g JOIN prerequisite_edges e ON e.sub_competency_id = g.member
)
DELETE FROM prerequisite_edges WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
UPDATE prerequisite_edges e SET sub_competency_id = m.survivor, updated_at = now()
FROM merge_plan m WHERE e.sub_competency_id = m.old_id;

-- 7. Faculty flags: re-point.
UPDATE faculty_flags f SET sub_competency_id = m.survivor
FROM merge_plan m WHERE f.sub_competency_id = m.old_id;

-- 8. Requirements (Ruling 6).
INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight, weight_source,
  required_k, required_u, required_d, depth_source, status, note, contributing_position_ids, display_order)
SELECT r.career_target_id, m.survivor, r.horizon, r.weight, r.weight_source, r.required_k, r.required_u,
       r.required_d, r.depth_source, r.status, r.note, r.contributing_position_ids, r.display_order
FROM career_target_requirements r JOIN merge_plan m ON m.old_id = r.competency_id
ON CONFLICT ON CONSTRAINT career_target_requirements_unique DO NOTHING;
DELETE FROM career_target_requirements WHERE competency_id IN (SELECT old_id FROM merge_plan);

-- 9. Retire merged-away competencies; record the map.
UPDATE sub_competencies s SET retired = true, merged_into = m.survivor, updated_at = now()
FROM merge_plan m WHERE s.id = m.old_id;
INSERT INTO sub_competency_map (old_sub_competency_id, competency_id, merge_note)
SELECT s.id, coalesce(m.survivor, s.id), m.note
FROM sub_competencies s LEFT JOIN merge_plan m ON m.old_id = s.id;

-- 10. Drop P0a scaffolding (Ruling 8).
DROP TABLE snapshot_target_coverage;
DROP TABLE coverage_scores;
ALTER TABLE sub_competencies DROP COLUMN career_target_id;
ALTER TABLE sub_competencies DROP COLUMN display_order;

-- 11. Post-checks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM career_target_requirements r JOIN sub_competencies s ON s.id = r.competency_id
             WHERE s.merged_into IS NOT NULL) THEN
    RAISE EXCEPTION '0057: a merged-away competency still has requirements';
  END IF;
  IF (SELECT count(*) FROM career_target_requirements) <> 35 THEN
    RAISE EXCEPTION '0057: expected 35 requirement rows, found %', (SELECT count(*) FROM career_target_requirements);
  END IF;
  IF (SELECT count(*) FROM sub_competency_map) <> (SELECT count(*) FROM sub_competencies) THEN
    RAISE EXCEPTION '0057: sub_competency_map does not cover every competency';
  END IF;
  IF EXISTS (
    SELECT g.survivor, c.snapshot_id FROM merge_group g JOIN snapshot_competency_coverage c ON c.competency_id = g.member
    EXCEPT SELECT competency_id, snapshot_id FROM snapshot_competency_coverage
           WHERE competency_id IN ('domain-knowledge','project-management')) THEN
    RAISE EXCEPTION '0057: a snapshot lost its survivor cell';
  END IF;
  IF EXISTS (SELECT 1 FROM course_intended_coverage i JOIN merge_plan m ON m.old_id = i.sub_competency_id)
     OR EXISTS (SELECT 1 FROM prerequisite_edges e JOIN merge_plan m ON m.old_id = e.sub_competency_id)
     OR EXISTS (SELECT 1 FROM faculty_flags f JOIN merge_plan m ON m.old_id = f.sub_competency_id) THEN
    RAISE EXCEPTION '0057: a reference still points at a merged-away competency';
  END IF;
END $$;

COMMIT;
