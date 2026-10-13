-- 0058_competency_catalog_p1.sql — P1: occupation mixes + O*NET reference store + catalog origin.
-- Additive only. Plan: docs/superpowers/plans/2026-10-12-competency-catalog-p1.md
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.career_target_occupations') IS NOT NULL THEN
    RAISE EXCEPTION '0058: already applied';
  END IF;
  IF to_regclass('public.sub_competency_map') IS NULL THEN
    RAISE EXCEPTION '0058: precondition — P0b (0057) is not applied';
  END IF;
END $$;

ALTER TABLE sub_competencies ADD COLUMN origin text NOT NULL DEFAULT 'migrated'
  CHECK (origin IN ('migrated', 'gc_authored', 'onet_seeded'));

CREATE TABLE career_target_occupations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  career_target_id text NOT NULL REFERENCES career_targets(id) ON DELETE CASCADE,
  horizon text NOT NULL CHECK (horizon IN ('entry', 'growth')),
  soc_code text NOT NULL CHECK (soc_code ~ '^[0-9]{2}-[0-9]{4}$'),
  onet_soc_code text CHECK (onet_soc_code IS NULL OR onet_soc_code ~ '^[0-9]{2}-[0-9]{4}\.[0-9]{2}$'),
  onet_status text NOT NULL CHECK (onet_status IN ('rated', 'unrated', 'no_fit')),
  count integer NOT NULL CHECK (count > 0),
  share real NOT NULL CHECK (share > 0 AND share <= 1),
  source text NOT NULL CHECK (source IN ('alumni_rule', 'faculty')),
  source_version text NOT NULL,
  as_of date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((onet_status = 'rated') = (onet_soc_code IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (career_target_id, horizon, soc_code, onet_soc_code, source)
);
CREATE INDEX idx_career_target_occupations_target ON career_target_occupations (career_target_id, horizon);

CREATE TABLE onet_release (
  release text PRIMARY KEY,
  published text NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  source_url text NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onet_occupations (
  release text NOT NULL REFERENCES onet_release(release) ON DELETE CASCADE,
  onet_soc_code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  PRIMARY KEY (release, onet_soc_code)
);

CREATE TABLE onet_element_ratings (
  release text NOT NULL,
  onet_soc_code text NOT NULL,
  domain text NOT NULL CHECK (domain IN ('knowledge', 'abilities', 'work_activities', 'essential_skills', 'transferable_skills')),
  element_id text NOT NULL,
  element_name text NOT NULL,
  scale_id text NOT NULL CHECK (scale_id IN ('IM', 'LV')),
  data_value real NOT NULL,
  n integer,
  standard_error real,
  recommend_suppress boolean NOT NULL,
  not_relevant boolean NOT NULL,
  date_text text NOT NULL,
  domain_source text NOT NULL,
  PRIMARY KEY (release, onet_soc_code, domain, element_id, scale_id),
  FOREIGN KEY (release, onet_soc_code) REFERENCES onet_occupations(release, onet_soc_code) ON DELETE CASCADE
);

CREATE TABLE onet_task_statements (
  release text NOT NULL,
  onet_soc_code text NOT NULL,
  task_id text NOT NULL,
  task text NOT NULL,
  task_type text,
  PRIMARY KEY (release, onet_soc_code, task_id),
  FOREIGN KEY (release, onet_soc_code) REFERENCES onet_occupations(release, onet_soc_code) ON DELETE CASCADE
);

CREATE TABLE onet_task_ratings (
  release text NOT NULL,
  onet_soc_code text NOT NULL,
  task_id text NOT NULL,
  scale_id text NOT NULL CHECK (scale_id IN ('IM', 'RT', 'FT')),
  category text NOT NULL DEFAULT '',
  data_value real NOT NULL,
  n integer,
  standard_error real,
  recommend_suppress boolean NOT NULL,
  date_text text NOT NULL,
  domain_source text NOT NULL,
  PRIMARY KEY (release, onet_soc_code, task_id, scale_id, category),
  FOREIGN KEY (release, onet_soc_code, task_id) REFERENCES onet_task_statements(release, onet_soc_code, task_id) ON DELETE CASCADE
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM sub_competencies WHERE origin <> 'migrated') THEN
    RAISE EXCEPTION '0058: post-check — existing competencies must be origin=migrated';
  END IF;
END $$;

COMMIT;
