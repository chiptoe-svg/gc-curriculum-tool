-- P0a characterization fixture — SCRATCH DB ONLY. prerequisite_edges is empty
-- in production, so without this the gap engine's measured path (the one P0a
-- re-points) would never run in the characterization test. Idempotent.
DO $$ BEGIN
  IF current_database() <> 'gc_curriculum_p0a_scratch' THEN
    RAISE EXCEPTION 'scratch fixture refused: connected to %', current_database();
  END IF;
END $$;

WITH latest AS (
  SELECT DISTINCT ON (course_code) id, course_code
  FROM course_capture_snapshots
  WHERE retired_at IS NULL
  ORDER BY course_code, created_at DESC
), cov AS (
  SELECT l.course_code, c.sub_competency_id, s.retired,
         row_number() OVER (PARTITION BY s.retired ORDER BY l.course_code, c.sub_competency_id) AS rn
  FROM latest l
  JOIN snapshot_target_coverage c ON c.snapshot_id = l.id
  JOIN sub_competencies s ON s.id = c.sub_competency_id
), picked AS (
  SELECT course_code, sub_competency_id FROM cov
  WHERE (NOT retired AND rn <= 2) OR (retired AND rn = 1)
), focal AS (
  SELECT code FROM courses
  WHERE code NOT IN (SELECT course_code FROM picked)
    AND code IN (SELECT course_code FROM latest)
  ORDER BY code
  LIMIT 1
)
INSERT INTO prerequisite_edges
  (focal_course_code, prereq_course_code, sub_competency_id, expected_k, expected_u, expected_d,
   source, confidence, confirmed, rationale)
SELECT f.code, p.course_code, p.sub_competency_id, 2, 2, 3,
       'faculty', 'high', true, 'P0a characterization fixture (scratch DB only)'
FROM picked p CROSS JOIN focal f
ON CONFLICT ON CONSTRAINT uq_prerequisite_edges_focal_prereq_subcomp DO NOTHING;

SELECT count(*) AS fixture_edges FROM prerequisite_edges
WHERE rationale = 'P0a characterization fixture (scratch DB only)';
