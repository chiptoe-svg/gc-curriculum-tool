-- Read-only verification for migration 0056 (P0a). Run right after applying.
-- Every "expect 0" row must be 0; counts must match as noted.
-- Reference values at plan time (2026-10-11): 36 sub-competencies (34 active +
-- 2 retired), 36 requirements, 764 coverage rows in each of the three places.
BEGIN READ ONLY;

SELECT 'sub_competencies total'            AS item, count(*) AS value FROM sub_competencies
UNION ALL SELECT 'sub_competencies retired',          count(*) FROM sub_competencies WHERE retired
UNION ALL SELECT 'sub_competencies without target (expect 0)', count(*) FROM sub_competencies WHERE career_target_id IS NULL
UNION ALL SELECT 'requirements (expect = sub_competencies total)', count(*) FROM career_target_requirements
UNION ALL SELECT 'requirements with a weight (expect 0)', count(*) FROM career_target_requirements WHERE weight IS NOT NULL
UNION ALL SELECT 'requirements not entry/faculty/draft (expect 0)', count(*) FROM career_target_requirements
  WHERE horizon <> 'entry' OR weight_source <> 'faculty' OR status <> 'draft'
UNION ALL SELECT 'competencies with no membership (expect 0)', count(*) FROM sub_competencies s
  WHERE NOT EXISTS (SELECT 1 FROM career_target_requirements r WHERE r.competency_id = s.id)
UNION ALL SELECT 'memberships under a different target (expect 0)', count(*) FROM target_sub_competencies m
  JOIN sub_competencies s ON s.id = m.id WHERE m.career_target_id <> s.career_target_id
UNION ALL SELECT 'display_order differences (expect 0)', count(*) FROM target_sub_competencies m
  JOIN sub_competencies s ON s.id = m.id WHERE m.display_order <> s.display_order
UNION ALL SELECT 'competencies in more than one target (expect 0)', count(*) FROM (
  SELECT competency_id FROM career_target_requirements GROUP BY competency_id
  HAVING count(DISTINCT career_target_id) > 1) x
UNION ALL SELECT 'snapshot_target_coverage rows', count(*) FROM snapshot_target_coverage
UNION ALL SELECT 'snapshot_competency_coverage rows (expect = old)', count(*) FROM snapshot_competency_coverage
UNION ALL SELECT 'target_coverage rows (expect = old)', count(*) FROM target_coverage
UNION ALL SELECT 'old rows missing or changed in the view (expect 0)', count(*) FROM (
  SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
         evidence_excerpt, confidence, rationale, model, generated_at FROM snapshot_target_coverage
  EXCEPT ALL
  SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
         evidence_excerpt, confidence, rationale, model, generated_at FROM target_coverage) x
UNION ALL SELECT 'view rows with no identical old row (expect 0 right after apply)', count(*) FROM (
  SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
         evidence_excerpt, confidence, rationale, model, generated_at FROM target_coverage
  EXCEPT ALL
  SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
         evidence_excerpt, confidence, rationale, model, generated_at FROM snapshot_target_coverage) x
UNION ALL SELECT 'snapshots that lost a competency (expect 0)', count(*) FROM (
  SELECT DISTINCT snapshot_id, sub_competency_id FROM snapshot_target_coverage
  EXCEPT
  SELECT DISTINCT snapshot_id, competency_id FROM snapshot_competency_coverage) x
UNION ALL SELECT 'career_target_demand rows (left as is)', count(*) FROM career_target_demand
UNION ALL SELECT 'coverage_scores rows (left as is)', count(*) FROM coverage_scores;

ROLLBACK;
