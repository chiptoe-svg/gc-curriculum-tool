-- 0069_skill_match.sql — required-skill matching on the curriculum map (spec 2026-11-16-map-course-edits-and-required-skills-design.md).
-- skill_match_judgments caches the AI judge's probabilities per (required, supplied, model, prompt version);
-- skill_match_decisions is the append-only record of faculty decisions (rows are only ever inserted);
-- plan_syllabus_drafts keeps the model's structured draft from a syllabus uploaded onto a plan course.
-- Additive: no existing table or row is changed. Live order: backup -> apply (this file) -> verify -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'skill_match_decisions') THEN
    RAISE EXCEPTION '0069: already applied';
  END IF;
END $$;

CREATE TABLE skill_match_judgments (
  required_hash text NOT NULL,
  supplied_hash text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  p_fully real,
  p_partly real,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_match_judgments_pkey PRIMARY KEY (required_hash, supplied_hash, model, prompt_version)
);

CREATE TABLE skill_match_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  required_hash text NOT NULL,
  supplied_hash text NOT NULL,
  required_text text NOT NULL,
  supplied_text text NOT NULL,
  required_course text NOT NULL,
  required_course_title text,
  supplied_course text NOT NULL,
  supplied_course_title text,
  required_snapshot_id uuid,
  supplied_snapshot_id uuid,
  label text NOT NULL,
  draft boolean NOT NULL DEFAULT false,
  plan_id uuid,
  source text NOT NULL,
  reason text,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  judge_model text,
  prompt_version text,
  judge_p_fully real,
  judge_p_partly real,
  CONSTRAINT skill_match_decisions_label_check CHECK (label IN ('fully', 'partly', 'not')),
  CONSTRAINT skill_match_decisions_source_check CHECK (source IN ('map', 'labeling_sheet'))
);
CREATE INDEX idx_skill_match_decisions_pair ON skill_match_decisions (required_hash, supplied_hash, decided_at DESC);

CREATE TABLE plan_syllabus_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES curriculum_plans(id) ON DELETE CASCADE,
  course_ref text NOT NULL,
  file_name text NOT NULL,
  text text NOT NULL,
  model text NOT NULL,
  drafted_by text NOT NULL,
  drafted_at timestamptz NOT NULL DEFAULT now(),
  draft jsonb NOT NULL
);
COMMIT;
