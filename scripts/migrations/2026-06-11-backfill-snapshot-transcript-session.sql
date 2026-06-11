-- 2026-06-11 — Backfill course_capture_snapshots.transcript_session_id
--
-- Companion to the fix in lib/db/capture-snapshots-queries.ts + the snapshots
-- route (commit 7bf6cbd): createSnapshot never set transcript_session_id, so
-- every existing v2 snapshot was missing its producing-session link and the
-- wiki raw-transcript layer never fired for them.
--
-- This faithfully reconstructs what getLatestSessionId() would have linked at
-- snapshot time: the session containing the most recent capture_messages row
-- at or before the snapshot's created_at. Idempotent — only fills NULLs, and
-- re-running is a no-op once populated. Ran once against 127.0.0.1:5433/
-- gc_curriculum (the single local Postgres shared by dev + deploy) on
-- 2026-06-11; updated 6 rows.
--
-- Reversible: `UPDATE course_capture_snapshots SET transcript_session_id = NULL
-- WHERE id IN (...)` for the affected ids if a mislink is found.

UPDATE course_capture_snapshots s
SET transcript_session_id = (
  SELECT m.session_id FROM capture_messages m
  WHERE m.course_code = s.course_code AND m.created_at <= s.created_at
  ORDER BY m.created_at DESC LIMIT 1
)
WHERE s.retired_at IS NULL
  AND s.transcript_session_id IS NULL
  AND EXISTS (
    SELECT 1 FROM capture_messages m
    WHERE m.course_code = s.course_code AND m.created_at <= s.created_at
  );
