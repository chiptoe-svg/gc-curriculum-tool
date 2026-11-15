-- 0068_skill_links.sql — skills, links and roll-ups (spec 2026-11-15-skill-competency-links-design.md).
-- A course's captured skills stay as they are; which catalog competency each skill counts toward is a separate,
-- editable link; how a competency's linked skills combine into one level is a separate, editable roll-up.
-- Also adds the Professional readiness competency (owner, 2026-11-15).
-- Additive: no existing table or row is changed. Live order: backup -> apply (this file) -> verify -> seed links
-- (scripts/catalog/seed-skill-links.ts) -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'skill_competency_links') THEN
    RAISE EXCEPTION '0068: already applied';
  END IF;
END $$;

CREATE TABLE skill_competency_links (
  snapshot_id uuid NOT NULL REFERENCES course_capture_snapshots(id) ON DELETE CASCADE,
  skill_ref text NOT NULL,
  statement text NOT NULL,
  competency_id text NOT NULL REFERENCES sub_competencies(id) ON DELETE CASCADE,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  similarity real,
  note text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_competency_links_pkey PRIMARY KEY (snapshot_id, skill_ref, competency_id),
  CONSTRAINT skill_competency_links_source_check CHECK (source IN ('embedding', 'ai', 'scoring', 'faculty')),
  CONSTRAINT skill_competency_links_status_check CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  CONSTRAINT skill_competency_links_decided_check CHECK ((status = 'proposed') = (decided_at IS NULL))
);
CREATE INDEX idx_skill_competency_links_competency ON skill_competency_links (competency_id);

CREATE TABLE competency_rollups (
  snapshot_id uuid NOT NULL REFERENCES course_capture_snapshots(id) ON DELETE CASCADE,
  competency_id text NOT NULL REFERENCES sub_competencies(id) ON DELETE CASCADE,
  k integer,
  u integer,
  d integer,
  method text NOT NULL,
  rationale text,
  model text,
  decided_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competency_rollups_pkey PRIMARY KEY (snapshot_id, competency_id),
  CONSTRAINT competency_rollups_method_check CHECK (method IN ('ai', 'faculty')),
  CONSTRAINT competency_rollups_levels_check CHECK (
    (k IS NULL OR k BETWEEN 0 AND 5) AND (u IS NULL OR u BETWEEN 0 AND 5) AND (d IS NULL OR d BETWEEN 0 AND 5))
);

-- Professional readiness (owner, 2026-11-15): full K/U/D, in the foundational area. Enters with no career-path
-- membership; program targets cover it, and links bring skills to it.
INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, origin, foundational, scoring)
VALUES (
  'professional-readiness',
  'Professional readiness and career development',
  'Knows the roles, career paths and hiring practices in graphic communications and allied industries: what employers ask for, how qualifications and experience are read, and the tools of a job search (résumé, portfolio, cover letter, interview, professional networks).',
  'Understands how a career is built over time: why particular experiences, credentials and relationships lead to particular roles, and how to read a job posting for the gap between where one is and where one wants to be.',
  'Plans and presents oneself professionally: maps a credible path to a target role, closes qualification gaps through chosen experiences, and produces employer-ready materials (résumé, portfolio, elevator pitch, interview) that represent one''s work accurately.',
  'gc_authored', false, 'direct');
INSERT INTO sub_competency_map (old_sub_competency_id, competency_id, merge_note)
VALUES ('professional-readiness', 'professional-readiness', NULL);
INSERT INTO bundle_cards (competency_id, stratum, includes, excludes, distinctions, positive_examples, negative_examples, status, confirmed_by, confirmed_at)
VALUES (
  'professional-readiness', 'foundational',
  'Career planning toward a target role; reading job postings and qualification gaps; résumé, portfolio, cover letter and interview preparation; elevator pitch and professional self-presentation; professional networking; internship and co-op preparation and reflection.',
  'Professional ethics and integrity (Professional responsibility and ethics); presenting work to clients (Proposal development); general written or spoken communication not aimed at a job search.',
  'About the student''s own career, not a client''s business. Professional responsibility covers how one behaves at work; this covers getting to and growing in the work.',
  ARRAY['Maps a five-year path from two real job postings to the experiences each requires', 'Prepares a résumé and portfolio reviewed against a target posting', 'Delivers a practiced elevator pitch to an employer'],
  ARRAY['Writes a code of ethics for professional practice', 'Presents a proposal to a client'],
  'confirmed', 'owner (wording approved in conversation, 2026-11-15)', now());
COMMIT;
