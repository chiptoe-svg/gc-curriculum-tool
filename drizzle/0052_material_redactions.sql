-- 0052 — privacy scrub redaction counts (spec 2026-10-05).
-- HAND-WRITTEN, applied with psql: drizzle/meta is git-ignored and stale, so
-- drizzle-kit generate/migrate are unsafe here (see docs/STATE.md Deferred /
-- debt). Additive and nullable: the deployed app keeps working. Idempotent.
-- Shape: { "counts": { "student-name": n, "student-id": n, "email": n },
--          "failedReason": string | null }. NULL = written before the scrub.
ALTER TABLE "course_materials" ADD COLUMN IF NOT EXISTS "redactions" jsonb;
