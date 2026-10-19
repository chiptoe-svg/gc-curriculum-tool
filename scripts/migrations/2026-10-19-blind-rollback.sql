-- Rollback of migration 0061 (item_embeddings.kind allows 'onet_element').
-- One transaction. Not re-runnable: a second run stops at "rollback: 0061 is not applied".
-- onet_element rows are a free cache (re-created by scripts/catalog/embed-items.ts),
-- so this file DELETES them before restoring the old check.
-- App-code order: revert the app to its pre-0061 build FIRST (the new embed-items
-- and blind list read/write kind 'onet_element'), then run this file.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'item_embeddings_kind_check'
                   AND conrelid = 'public.item_embeddings'::regclass
                   AND pg_get_constraintdef(oid) LIKE '%onet_element%') THEN
    RAISE EXCEPTION 'rollback: 0061 is not applied';
  END IF;
END $$;

DELETE FROM item_embeddings WHERE kind = 'onet_element';
ALTER TABLE item_embeddings DROP CONSTRAINT item_embeddings_kind_check;
ALTER TABLE item_embeddings ADD CONSTRAINT item_embeddings_kind_check
  CHECK (kind IN ('bundle_card', 'onet_task', 'course_skill', 'esco_skill'));

COMMIT;
