-- 0055 — Faculty access panel addendum: full Clemson catalog course info
-- (spec: owner-approved 2026-10-07, docs/superpowers/specs/2026-10-07-access-panel-add-course-addendum.md).
-- HAND-WRITTEN, applied with psql — drizzle/meta is git-ignored and stale
-- here (see docs/STATE.md Deferred/debt), same convention as 0051-0054.
-- Additive + nullable: existing rows (written by sync-catalog-prereqs.ts,
-- GC + tracked courses only) keep description/credits NULL until
-- scripts/catalog/sync-catalog-courses.ts --apply backfills them. Idempotent.

ALTER TABLE course_catalog_entries ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE course_catalog_entries ADD COLUMN IF NOT EXISTS credits text;
