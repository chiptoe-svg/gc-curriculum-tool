-- 0074_skill_tree.sql — the department skill tree, phase 1 (spec 2026-11-20-skill-tree-design.md; plan 2026-11-20-skill-tree-phase1).
-- Four new tables (skill_nodes, skill_leaves, node_depths, skill_tree_events) and four new string_points columns.
-- Backfill in the same transaction: one master node per sub_competencies row, one leaf per distinct
-- (course, skill, competency) link on a live snapshot, one depth per competency_rollups row on a live snapshot.
-- Nothing existing is deleted or rewritten; competency_levels is untouched. Live order: backup -> apply (this file) -> verify -> deploy.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'skill_nodes') THEN
    RAISE EXCEPTION '0074: already applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'app_settings') THEN
    RAISE EXCEPTION '0074: precondition — 0073 not applied';
  END IF;
END $$;

CREATE TABLE skill_nodes (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  parent_id text REFERENCES skill_nodes(id) ON DELETE RESTRICT,
  competency_id text UNIQUE REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  foundational boolean NOT NULL DEFAULT false,
  weight real NOT NULL DEFAULT 1,
  weight_source text NOT NULL DEFAULT 'default',
  merged_into text REFERENCES skill_nodes(id) ON DELETE RESTRICT,
  retired boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_nodes_weight_check CHECK (weight > 0),
  CONSTRAINT skill_nodes_weight_source_check CHECK (weight_source IN ('default', 'faculty', 'onet', 'employer')),
  CONSTRAINT skill_nodes_master_parent_check CHECK ((competency_id IS NULL) = (parent_id IS NOT NULL) OR retired),
  CONSTRAINT skill_nodes_merged_into_retired_check CHECK (merged_into IS NULL OR retired)
);

CREATE TABLE skill_leaves (
  course_code text NOT NULL,
  skill_ref text NOT NULL,
  node_id text NOT NULL REFERENCES skill_nodes(id) ON DELETE RESTRICT,
  statement text NOT NULL,
  share real,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_leaves_pkey PRIMARY KEY (course_code, skill_ref, node_id),
  CONSTRAINT skill_leaves_share_check CHECK (share IS NULL OR share > 0),
  CONSTRAINT skill_leaves_source_check CHECK (source IN ('embedding', 'ai', 'scoring', 'faculty')),
  CONSTRAINT skill_leaves_status_check CHECK (status IN ('proposed', 'confirmed', 'rejected'))
);
CREATE INDEX idx_skill_leaves_node ON skill_leaves (node_id);

CREATE TABLE node_depths (
  node_id text NOT NULL REFERENCES skill_nodes(id) ON DELETE RESTRICT,
  course_code text NOT NULL,
  instructor text NOT NULL DEFAULT '',
  k smallint,
  u smallint,
  d smallint,
  method text NOT NULL,
  leaves_signature text NOT NULL,
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_depths_pkey PRIMARY KEY (node_id, course_code, instructor),
  CONSTRAINT node_depths_k_check CHECK (k IS NULL OR k BETWEEN 0 AND 5),
  CONSTRAINT node_depths_u_check CHECK (u IS NULL OR u BETWEEN 0 AND 5),
  CONSTRAINT node_depths_d_check CHECK (d IS NULL OR d BETWEEN 0 AND 5),
  CONSTRAINT node_depths_method_check CHECK (method IN ('faculty', 'ai'))
);

CREATE TABLE skill_tree_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id text,
  course_code text,
  skill_ref text,
  kind text NOT NULL,
  by text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  before jsonb,
  after jsonb,
  CONSTRAINT skill_tree_events_kind_check CHECK (kind IN ('migrated', 'created', 'renamed', 'described', 'reparented', 'merged', 'split', 'weight', 'leaf_placed', 'leaf_confirmed', 'leaf_rejected', 'leaf_moved', 'leaf_share', 'leaf_retargeted', 'depth_set', 'depth_cleared'))
);
CREATE INDEX idx_skill_tree_events_node_at ON skill_tree_events (node_id, at DESC);

ALTER TABLE string_points
  ADD COLUMN node_id text REFERENCES skill_nodes(id) ON DELETE RESTRICT,
  ADD COLUMN need_k smallint,
  ADD COLUMN need_u smallint,
  ADD COLUMN need_d smallint,
  ADD CONSTRAINT string_points_node_requires_check CHECK (node_id IS NULL OR role = 'requires'),
  ADD CONSTRAINT string_points_need_k_check CHECK (need_k IS NULL OR need_k BETWEEN 0 AND 5),
  ADD CONSTRAINT string_points_need_u_check CHECK (need_u IS NULL OR need_u BETWEEN 0 AND 5),
  ADD CONSTRAINT string_points_need_d_check CHECK (need_d IS NULL OR need_d BETWEEN 0 AND 5);

-- Masters: one per catalog competency, same id.
INSERT INTO skill_nodes (id, name, competency_id, foundational, retired, merged_into, created_by)
SELECT id, name, id, foundational, retired, merged_into, 'migration-0074' FROM sub_competencies;

-- Leaves: one per distinct (course, skill, competency) over live snapshots; the most decided row wins, then the newest.
INSERT INTO skill_leaves (course_code, skill_ref, node_id, statement, source, status, decided_by, decided_at)
SELECT DISTINCT ON (s.course_code, l.skill_ref, l.competency_id)
  s.course_code, l.skill_ref, l.competency_id, l.statement, l.source, l.status, l.decided_by, l.decided_at
FROM skill_competency_links l
JOIN course_capture_snapshots s ON s.id = l.snapshot_id
WHERE s.retired_at IS NULL
ORDER BY s.course_code, l.skill_ref, l.competency_id,
  CASE l.status WHEN 'confirmed' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
  l.created_at DESC;

-- Hand-set depths: one per rollup on a live snapshot (newest wins if two live snapshots share a course and instructor).
INSERT INTO node_depths (node_id, course_code, instructor, k, u, d, method, leaves_signature, set_by, set_at)
SELECT DISTINCT ON (r.competency_id, s.course_code, coalesce(s.instructor_name, ''))
  r.competency_id, s.course_code, coalesce(s.instructor_name, ''), r.k, r.u, r.d, r.method, 'migrated', r.decided_by, r.created_at
FROM competency_rollups r
JOIN course_capture_snapshots s ON s.id = r.snapshot_id
WHERE s.retired_at IS NULL
ORDER BY r.competency_id, s.course_code, coalesce(s.instructor_name, ''), r.created_at DESC;

INSERT INTO skill_tree_events (kind, by, after)
SELECT 'migrated', 'migration-0074', jsonb_build_object(
  'masters', (SELECT count(*) FROM skill_nodes),
  'leaves', (SELECT count(*) FROM skill_leaves),
  'depths', (SELECT count(*) FROM node_depths));

COMMIT;
