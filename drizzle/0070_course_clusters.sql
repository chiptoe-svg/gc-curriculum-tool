-- 0070_course_clusters.sql — course cluster map (spec 2026-11-17-course-cluster-map-design.md).
-- curriculum_clusters mirrors curriculum_plans (state holds ClusterState); course_what_ifs gains a skills sketch;
-- skill_match_decisions accepts source 'cluster'; plan_syllabus_drafts may belong to a cluster instead of a plan;
-- skill_set_judgments caches the set-level judge (which candidates together meet a target skill).
-- Alters three existing tables (no rows changed or removed). Live order: backup -> apply (this file) -> verify -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'curriculum_clusters') THEN
    RAISE EXCEPTION '0070: already applied';
  END IF;
END $$;

CREATE TABLE curriculum_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  owner_grant_id text NOT NULL,
  owner_kind text NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_clusters_owner_kind_check CHECK (owner_kind IN ('personal', 'department')),
  CONSTRAINT curriculum_clusters_version_check CHECK (version >= 1)
);
CREATE INDEX idx_curriculum_clusters_updated ON curriculum_clusters (updated_at);

ALTER TABLE course_what_ifs ADD COLUMN skills jsonb;

ALTER TABLE skill_match_decisions DROP CONSTRAINT skill_match_decisions_source_check;
ALTER TABLE skill_match_decisions ADD CONSTRAINT skill_match_decisions_source_check
  CHECK (source IN ('map', 'labeling_sheet', 'cluster'));

ALTER TABLE plan_syllabus_drafts ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE plan_syllabus_drafts ADD COLUMN cluster_id uuid REFERENCES curriculum_clusters(id) ON DELETE CASCADE;
ALTER TABLE plan_syllabus_drafts ADD CONSTRAINT plan_syllabus_drafts_owner_check
  CHECK ((plan_id IS NULL) <> (cluster_id IS NULL));

CREATE TABLE skill_set_judgments (
  target_hash text NOT NULL,
  pool_hash text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  p_any real,
  picked text[] NOT NULL,
  kept text[] NOT NULL,
  p_together real,
  p_combining real,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_set_judgments_pkey PRIMARY KEY (target_hash, pool_hash, model, prompt_version)
);
COMMIT;
