-- 0059_competency_catalog_p2.sql — P2: bundle membership (cards, embeddings cache,
-- O*NET element definitions, mapping runs/outcomes, members, blind golden sample).
-- Additive only: eight new tables, nothing altered or dropped. No existing
-- route or query reads these tables, so the running app is unaffected while
-- this applies. Plan: docs/superpowers/plans/2026-10-13-competency-catalog-p2.md
-- Spec: docs/superpowers/specs/2026-10-13-bundle-membership-p2-design.md
--
-- bundle_members deliberately has NO foreign key to any onet_* table:
-- scripts/onet/load-onet.ts reloads a release by deleting onet_occupations
-- (children cascade), and an FK here would silently wipe reviewed members.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF to_regclass('public.bundle_members') IS NOT NULL THEN
    RAISE EXCEPTION '0059: already applied';
  END IF;
  IF to_regclass('public.onet_release') IS NULL THEN
    RAISE EXCEPTION '0059: precondition — P1 (0058) is not applied';
  END IF;
END $$;

CREATE TABLE bundle_cards (
  competency_id text NOT NULL,
  stratum text NOT NULL,
  includes text NOT NULL,
  excludes text NOT NULL,
  distinctions text NOT NULL,
  positive_examples text[] NOT NULL,
  negative_examples text[] NOT NULL,
  status text NOT NULL,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_cards_pkey PRIMARY KEY (competency_id),
  CONSTRAINT bundle_cards_competency_id_fkey FOREIGN KEY (competency_id) REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_cards_stratum_check CHECK (stratum IN ('foundational', 'technical', 'business', 'workflow_ai')),
  CONSTRAINT bundle_cards_status_check CHECK (status IN ('draft', 'confirmed')),
  CONSTRAINT bundle_cards_confirmed_check CHECK ((status = 'confirmed') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE TABLE item_embeddings (
  kind text NOT NULL,
  ref text NOT NULL,
  model text NOT NULL,
  text_hash text NOT NULL,
  vector real[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_embeddings_pkey PRIMARY KEY (kind, ref, model, text_hash),
  CONSTRAINT item_embeddings_kind_check CHECK (kind IN ('bundle_card', 'onet_task', 'course_skill', 'esco_skill')),
  CONSTRAINT item_embeddings_vector_check CHECK (cardinality(vector) > 0)
);

CREATE TABLE onet_element_definitions (
  release text NOT NULL,
  domain text NOT NULL,
  element_id text NOT NULL,
  element_name text NOT NULL,
  description text NOT NULL,
  CONSTRAINT onet_element_definitions_pkey PRIMARY KEY (release, element_id),
  CONSTRAINT onet_element_definitions_release_fkey FOREIGN KEY (release) REFERENCES onet_release(release) ON DELETE CASCADE,
  CONSTRAINT onet_element_definitions_domain_check CHECK (domain IN ('knowledge', 'abilities', 'work_activities', 'essential_skills', 'transferable_skills'))
);

CREATE TABLE bundle_mapping_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  model text NOT NULL,
  prompt_version text NOT NULL,
  task_shortlist_k integer NOT NULL,
  bundle_count integer NOT NULL,
  cost_usd_cents integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT bundle_mapping_runs_pkey PRIMARY KEY (id),
  CONSTRAINT bundle_mapping_runs_k_check CHECK (task_shortlist_k > 0),
  CONSTRAINT bundle_mapping_runs_cost_check CHECK (cost_usd_cents >= 0)
);

CREATE TABLE bundle_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bundle_id text NOT NULL,
  source text NOT NULL,
  external_id text NOT NULL,
  external_label text NOT NULL,
  onet_soc_code text,
  release text,
  position text NOT NULL,
  ai_position text,
  status text NOT NULL,
  proposed_by text NOT NULL,
  rationale text,
  run_id uuid,
  confirmed_by text,
  confirmed_at timestamptz,
  bulk_confirmed boolean NOT NULL DEFAULT false,
  review_note text,
  centroid_distance real,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_members_pkey PRIMARY KEY (id),
  CONSTRAINT bundle_members_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_members_run_id_fkey FOREIGN KEY (run_id) REFERENCES bundle_mapping_runs(id) ON DELETE SET NULL,
  CONSTRAINT bundle_members_source_check CHECK (source IN ('onet_element', 'onet_task', 'course_skill', 'esco_skill')),
  CONSTRAINT bundle_members_position_check CHECK (position IN ('core', 'related', 'fringe')),
  CONSTRAINT bundle_members_ai_position_check CHECK (ai_position IS NULL OR ai_position IN ('core', 'related', 'fringe')),
  CONSTRAINT bundle_members_status_check CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  CONSTRAINT bundle_members_soc_check CHECK ((source = 'onet_task') = (onet_soc_code IS NOT NULL)),
  CONSTRAINT bundle_members_release_check CHECK ((source IN ('onet_element', 'onet_task')) = (release IS NOT NULL)),
  CONSTRAINT bundle_members_decision_check CHECK ((status = 'proposed') = (confirmed_by IS NULL AND confirmed_at IS NULL)),
  CONSTRAINT bundle_members_reviewer_added_check CHECK (proposed_by <> 'reviewer' OR (ai_position IS NULL AND status <> 'proposed')),
  CONSTRAINT bundle_members_item_key UNIQUE NULLS NOT DISTINCT (bundle_id, source, release, external_id, onet_soc_code)
);
CREATE INDEX idx_bundle_members_bundle_status ON bundle_members (bundle_id, status);

CREATE TABLE bundle_mapping_outcomes (
  run_id uuid NOT NULL,
  bundle_id text NOT NULL,
  status text NOT NULL,
  no_clean_match boolean NOT NULL,
  note text,
  cost_usd_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_mapping_outcomes_pkey PRIMARY KEY (run_id, bundle_id),
  CONSTRAINT bundle_mapping_outcomes_run_id_fkey FOREIGN KEY (run_id) REFERENCES bundle_mapping_runs(id) ON DELETE CASCADE,
  CONSTRAINT bundle_mapping_outcomes_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_mapping_outcomes_status_check CHECK (status IN ('ok', 'failed')),
  CONSTRAINT bundle_mapping_outcomes_failed_check CHECK (status = 'ok' OR no_clean_match = false)
);

CREATE TABLE bundle_golden_samples (
  bundle_id text NOT NULL,
  stratum text NOT NULL,
  sample_seed text NOT NULL,
  candidates jsonb NOT NULL,
  reviewer text,
  submitted_at timestamptz,
  reset_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_golden_samples_pkey PRIMARY KEY (bundle_id),
  CONSTRAINT bundle_golden_samples_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_golden_samples_stratum_check CHECK (stratum IN ('foundational', 'technical', 'business', 'workflow_ai')),
  CONSTRAINT bundle_golden_samples_submitted_check CHECK (submitted_at IS NULL OR reviewer IS NOT NULL)
);

CREATE TABLE bundle_golden_picks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bundle_id text NOT NULL,
  reviewer text NOT NULL,
  source text,
  external_id text,
  onet_soc_code text,
  release text,
  position text,
  no_clean_match boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_golden_picks_pkey PRIMARY KEY (id),
  CONSTRAINT bundle_golden_picks_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES bundle_golden_samples(bundle_id) ON DELETE CASCADE,
  CONSTRAINT bundle_golden_picks_source_check CHECK (source IS NULL OR source IN ('onet_element', 'onet_task')),
  CONSTRAINT bundle_golden_picks_position_check CHECK (position IS NULL OR position IN ('core', 'related', 'fringe')),
  CONSTRAINT bundle_golden_picks_shape_check CHECK (
    (no_clean_match AND source IS NULL AND external_id IS NULL AND position IS NULL AND onet_soc_code IS NULL AND release IS NULL)
    OR (NOT no_clean_match AND source IS NOT NULL AND external_id IS NOT NULL AND position IS NOT NULL AND release IS NOT NULL
        AND (source = 'onet_task') = (onet_soc_code IS NOT NULL))
  ),
  CONSTRAINT bundle_golden_picks_item_key UNIQUE NULLS NOT DISTINCT (bundle_id, reviewer, source, external_id, onet_soc_code)
);

COMMIT;
