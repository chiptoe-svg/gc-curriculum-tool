-- 2026-10-19-blind-verify.sql — fail-closed verification for migration 0061.
-- Run read-only right after applying 0061. Printed rows first, then a DO block
-- re-derives every check and RAISEs on the first failure.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT 'item_embeddings_kind_check allows onet_element (expect t)' AS item, (EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'item_embeddings_kind_check'
    AND conrelid = 'public.item_embeddings'::regclass
    AND pg_get_constraintdef(oid) LIKE '%onet_element%'))::text AS value
UNION ALL SELECT 'item_embeddings rows by kind: onet_element (0 right after apply, 161 after embed-items --apply)', count(*)::text
  FROM item_embeddings WHERE kind = 'onet_element'
UNION ALL SELECT 'item_embeddings rows of every other kind (unchanged by 0061)', count(*)::text
  FROM item_embeddings WHERE kind <> 'onet_element';

DO $$
DECLARE def text; k text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname = 'item_embeddings_kind_check' AND conrelid = 'public.item_embeddings'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION '0061 verify: item_embeddings_kind_check is missing';
  END IF;
  FOREACH k IN ARRAY ARRAY['bundle_card', 'onet_task', 'onet_element', 'course_skill', 'esco_skill'] LOOP
    IF def NOT LIKE '%' || k || '%' THEN
      RAISE EXCEPTION '0061 verify: item_embeddings_kind_check does not allow %', k;
    END IF;
  END LOOP;
  RAISE NOTICE '0061 verify: all checks passed';
END $$;

ROLLBACK;
