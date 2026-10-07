-- 0054 — Faculty access panel: email on access_grants (spec: owner-approved
-- 2026-10-07, docs/superpowers/specs/2026-10-07-faculty-access-panel-design.md).
-- HAND-WRITTEN, applied with psql — drizzle/meta is git-ignored and stale here
-- (see docs/STATE.md Deferred/debt), same convention as 0051-0053. Additive +
-- nullable: existing CLI-minted grants keep an empty email. Idempotent.

ALTER TABLE access_grants ADD COLUMN IF NOT EXISTS email text;
