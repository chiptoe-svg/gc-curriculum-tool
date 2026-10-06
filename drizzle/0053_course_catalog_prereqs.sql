-- 0053 — Clemson catalog prerequisites (spec: owner-approved 2026-10-06 brief;
-- see docs/STATE.md "Catalog prerequisites").
-- HAND-WRITTEN, applied with psql: drizzle/meta is git-ignored and stale, so
-- drizzle-kit generate/migrate are unsafe here (see docs/STATE.md Deferred /
-- debt). Additive only: the deployed app keeps working without it (the
-- prerequisite map falls back to the course sheet while these tables are
-- missing). Idempotent.
--
-- Filled by scripts/catalog/sync-catalog-prereqs.ts --apply from the
-- clemson-advising project's catalog.db (read-only). The app never reads that
-- SQLite file or the MCP at runtime — only these tables.

-- One row per catalog course we synced. A row here with no prerequisite
-- edges means "the catalog lists none" — the map then does NOT fall back to
-- the course sheet for that course.
CREATE TABLE IF NOT EXISTS "course_catalog_entries" (
  "course_code"   text PRIMARY KEY,
  "title"         text,
  "prereq_text"   text,
  "coreq_text"    text,
  -- Non-course conditions from prereq_text ("Graphic Communications major",
  -- "Junior standing", "one of: … or any 2000-level AGRB course").
  "notes"         jsonb NOT NULL DEFAULT '[]'::jsonb,
  "catalog_year"  text NOT NULL,          -- e.g. '2026-2027'
  "source_url"    text,
  "catalog_last_synced" text,             -- the advising DB's own last_synced
  "synced_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "course_catalog_prereqs" (
  "course_code"   text NOT NULL,
  "prereq_code"   text NOT NULL,
  -- prereq = must be completed before; concurrent_ok = "Preq or concurrent
  -- enrollment" (before or alongside); coreq = taken together (labs).
  "kind"          text NOT NULL CHECK ("kind" IN ('prereq', 'concurrent_ok', 'coreq')),
  -- NULL = required on its own; equal numbers within one course_code = any
  -- one of those courses satisfies the requirement.
  "any_of_group"  smallint,
  "catalog_year"  text NOT NULL,
  "synced_at"     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("course_code", "prereq_code", "kind")
);

CREATE INDEX IF NOT EXISTS "idx_course_catalog_prereqs_prereq" ON "course_catalog_prereqs" ("prereq_code");
