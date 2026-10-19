-- 0061_item_embeddings_onet_element.sql — item_embeddings.kind also allows 'onet_element'
-- (O*NET element definitions embedded so the blind list can shortlist elements by cosine).
-- Also adds bundle_golden_samples.shown_items (jsonb, null for older submissions): what the blind reviewer was shown
-- (element ids + task-row map), written at submit, so agreement can leave AI elements outside the list out of precision.
-- Decision: docs/STATE.md, "P2 blind-check instrument narrowed after the first bundle" (2026-10-19).
-- Live order: backup -> apply (this file) -> verify -> embed elements -> THEN deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regclass('public.item_embeddings') IS NULL THEN
    RAISE EXCEPTION '0061: precondition — 0059 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'item_embeddings_kind_check'
               AND conrelid = 'public.item_embeddings'::regclass
               AND pg_get_constraintdef(oid) LIKE '%onet_element%')
     OR EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'bundle_golden_samples' AND column_name = 'shown_items') THEN
    RAISE EXCEPTION '0061: already applied';
  END IF;
END $$;
ALTER TABLE item_embeddings DROP CONSTRAINT item_embeddings_kind_check;
ALTER TABLE item_embeddings ADD CONSTRAINT item_embeddings_kind_check
  CHECK (kind IN ('bundle_card', 'onet_task', 'onet_element', 'course_skill', 'esco_skill'));
ALTER TABLE bundle_golden_samples ADD COLUMN shown_items jsonb;
COMMIT;
