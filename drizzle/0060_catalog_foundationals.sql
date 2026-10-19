-- 0060_catalog_foundationals.sql — catalog learns D-only foundationals and derived (never-scored) competencies.
-- Spec: docs/superpowers/specs/2026-10-19-catalog-foundationals-and-problem-solving-design.md
-- Live order: backup -> apply (this file) -> verify -> THEN deploy the build that names the new columns.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sub_competencies' AND column_name = 'foundational') THEN
    RAISE EXCEPTION '0060: already applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sub_competencies' AND column_name = 'origin') THEN
    RAISE EXCEPTION '0060: precondition — 0058 is not applied';
  END IF;
END $$;
ALTER TABLE sub_competencies ADD COLUMN foundational boolean NOT NULL DEFAULT false;
ALTER TABLE sub_competencies ADD COLUMN scoring text NOT NULL DEFAULT 'direct';
ALTER TABLE sub_competencies ADD CONSTRAINT sub_competencies_scoring_check CHECK (scoring IN ('direct', 'derived'));
ALTER TABLE sub_competencies ALTER COLUMN know_descriptor DROP NOT NULL;
ALTER TABLE sub_competencies ALTER COLUMN understand_descriptor DROP NOT NULL;
ALTER TABLE sub_competencies ADD CONSTRAINT sub_competencies_foundational_ku_check
  CHECK ((foundational AND know_descriptor IS NULL AND understand_descriptor IS NULL)
      OR (NOT foundational AND know_descriptor IS NOT NULL AND understand_descriptor IS NOT NULL));
COMMIT;
