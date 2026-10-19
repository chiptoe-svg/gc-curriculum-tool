-- Forward fix: remove the 2026-10-19 catalog additions (the 11 new competencies)
-- and everything that references them. One transaction; a failed check changes
-- nothing. Use this when 0060 is applied and the additions were inserted but
-- must come back out (the rollback file 2026-10-19-ca-rollback.sql refuses
-- while those rows exist).
--
-- Removes, for the 11 ids: bundle_cards, bundle_members,
-- snapshot_competency_coverage, career_target_requirements (if any),
-- bundle_golden_samples, bundle_mapping_outcomes (both RESTRICT-reference
-- sub_competencies), sub_competency_map, then the sub_competencies rows.
-- The tables that CASCADE from sub_competencies (career_target_demand,
-- course_intended_coverage, faculty_flags, prerequisite_edges) hold target- or
-- faculty-scoped data; the new competencies are unlinked, so the script refuses
-- if any such row exists rather than silently cascading it away.
--
-- REFUSES if any of the ids has a REVIEWED bundle_members row (status
-- confirmed or rejected) or any bundle_golden_picks row: that is human work.
--
-- It does NOT restore the two revised descriptors. Their prior texts are
-- below; restore them by hand (UPDATE sub_competencies SET know_descriptor =
-- ..., understand_descriptor = ..., do_descriptor = ... WHERE id = ...) or by
-- restoring the step-1 dump. Source of truth:
-- docs/superpowers/specs/2026-10-19-catalog-additions.json (prior* fields).
--
-- Prior texts:
-- ai-tool-direction
--   know_descriptor:       Knows the capabilities and failure modes of major generative AI tools across image, copy, and video, and how to script or assemble a lightweight personal AI workflow or tool (a prompt chain, a small automation) to speed their own work.
--   understand_descriptor: Understands why AI outputs require iteration grounded in human judgment about what good looks like, and why building a small tool for one's own workflow is now baseline fluency for this target — distinct from building a system other people run, which is target 5's job.
--   do_descriptor:         Directs an AI workflow from prompt through final output that meets brand quality standards, and, where useful, builds or configures a small AI tool or automation for their own workflow and documents it well enough to reuse.
-- quality-frameworks
--   know_descriptor:       Knows the dimensions on which creative, production, and AI-assisted output is evaluated — brand, legal/regulatory, and print-quality standards — and where each kind of check belongs in a workflow.
--   understand_descriptor: Understands why quality and compliance checking requires domain expertise and can't be fully automated, and why someone must stay accountable for AI-assisted output specifically.
--   do_descriptor:         Builds or operates a quality/compliance review step in a real workflow — a brand check, a legal/regulatory check, or a print-quality check — that catches failure modes consistently, including checks on AI-assisted output.
--
-- Whether to roll back 0060 afterwards: run 2026-10-19-ca-rollback.sql
-- (after reverting the app build, see its header).

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE ca_ids (id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO ca_ids (id) VALUES
    ('ai-literacy'),
    ('ai-strategy-change-leadership'),
    ('agency'),
    ('attention-to-detail'),
    ('resilience'),
    ('curiosity'),
    ('written-communication'),
    ('spoken-communication'),
    ('collaboration'),
    ('professional-responsibility'),
    ('problem-solving');

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM bundle_members
    WHERE bundle_id IN (SELECT id FROM ca_ids) AND status IN ('confirmed', 'rejected');
  IF n > 0 THEN
    RAISE EXCEPTION 'remove-additions: % reviewed (confirmed/rejected) bundle_members row(s) exist for these ids - refusing', n;
  END IF;
  SELECT count(*) INTO n FROM bundle_golden_picks WHERE bundle_id IN (SELECT id FROM ca_ids);
  IF n > 0 THEN
    RAISE EXCEPTION 'remove-additions: % bundle_golden_picks row(s) exist for these ids - refusing', n;
  END IF;
  SELECT
    (SELECT count(*) FROM career_target_demand       WHERE sub_competency_id IN (SELECT id FROM ca_ids))
  + (SELECT count(*) FROM course_intended_coverage   WHERE sub_competency_id IN (SELECT id FROM ca_ids))
  + (SELECT count(*) FROM faculty_flags              WHERE sub_competency_id IN (SELECT id FROM ca_ids))
  + (SELECT count(*) FROM prerequisite_edges         WHERE sub_competency_id IN (SELECT id FROM ca_ids))
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'remove-additions: % target/faculty-scoped row(s) (demand, intended coverage, flags, prerequisite edges) reference these ids - refusing', n;
  END IF;
END $$;

DELETE FROM bundle_golden_samples         WHERE bundle_id     IN (SELECT id FROM ca_ids);
DELETE FROM bundle_mapping_outcomes       WHERE bundle_id     IN (SELECT id FROM ca_ids);
DELETE FROM bundle_cards                  WHERE competency_id IN (SELECT id FROM ca_ids);
DELETE FROM bundle_members                WHERE bundle_id     IN (SELECT id FROM ca_ids);
DELETE FROM snapshot_competency_coverage  WHERE competency_id IN (SELECT id FROM ca_ids);
DELETE FROM career_target_requirements    WHERE competency_id IN (SELECT id FROM ca_ids);
DELETE FROM sub_competency_map            WHERE old_sub_competency_id IN (SELECT id FROM ca_ids)
                                             OR competency_id         IN (SELECT id FROM ca_ids);
DELETE FROM sub_competencies              WHERE id            IN (SELECT id FROM ca_ids);

COMMIT;
