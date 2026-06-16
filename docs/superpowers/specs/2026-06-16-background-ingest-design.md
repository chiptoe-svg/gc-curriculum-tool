# Background Material Ingest — Design

> **Status:** approved-in-conversation 2026-06-16; written for review.
> **Scope:** Background the shared indexing stage (`finalizeExtraction`) across all ingest paths so uploads/imports return fast and heavy work drains through a concurrency-bounded in-process worker. **Sequencing: build the queue + worker, convert the PDF-upload path first (proving ground), then convert the other six paths in the same effort.**

---

## Goal

Material ingest must never block the request that triggers it, and a burst of ingests must never saturate the box. Today the slow stage (Docling extraction + digest + per-chunk contextualize + embed + Weaviate upsert) runs **synchronously inside the HTTP handler**, so a PDF upload blocks 10–25 s and a Canvas import 85 s — and when several run at once the box saturates (the 2026-06-16 GC 2400 incident: a PDF upload 500'd as a victim of a concurrent v2-backfill (104 s) + canvas-import (85 s) + scan-linked-docs (35 s)).

Backgrounding the shared `finalizeExtraction` stage fixes the whole class: the triggering request returns immediately with a `queued` status, and a single worker drains the queue with **bounded concurrency**, so heavy work is serialized rather than stampeding.

---

## Current state

Seven routes call `finalizeExtraction` synchronously: `materials` POST, `materials/compress`, `canvas-import`, `scan-linked-docs`, `canvas-reextract`, `imscc-import`, and admin `v2-backfill`. The `course_materials` row already carries the state the worker needs:

- `blobUrl` — local-disk key for uploaded files (PDF/DOCX/…).
- `extractedText` — populated at insert time by the fetch-based paths (Canvas assemble, Drive fetch) which already have the text in hand.
- `extractionStatus` (`pending|ok|low_text|failed`), `extractionMethod`, `pageCount`.
- `indexingStatus` (`pending|indexing|ready|failed|skipped`), `indexedAt`.

So the **row is already the job record** — no new table. We add one state (`queued`) and a worker that claims and drains.

---

## Design overview

```
Route (POST/import)                 In-process worker loop (concurrency-capped)
  validate + store/fetch              claim a 'queued' row (FOR UPDATE SKIP LOCKED)
  insert/update row → 'queued'  ──►   processMaterial(row):
  ensureWorker(); return fast            if extractedText null + has blob:
  { id, indexingStatus:'queued' }          readLocal(blob) → extractText → persist
                                          finalizeExtraction(...)   (digest+chunk+ctx+embed+upsert)
                                        mark 'ready' | 'failed'
        shared Postgres queue  ◄────────────────────────────────────────
        (course_materials.indexing_status)
```

The worker is an **in-process singleton loop** (the chosen v1 model — simplest, no new launchd service). It is lazy-started on the first `enqueue` and self-sustains while `queued`/`indexing` rows remain, then idles. Tradeoff accepted: it dies if the web server restarts (you are currently in `next dev`), mitigated by **boot recovery** (below). There is a clean upgrade path to a separate launchd worker later — the queue (Postgres) and `processMaterial` are unchanged by that move.

---

## Data model

Add `'queued'` to the documented `indexingStatus` set: `pending | queued | indexing | ready | failed | skipped`. No migration — it's a free-text column with a default; only the schema comment and the `updateIndexingStatus` callers change. `'pending'` remains the at-insert default for rows not yet enqueued; `enqueue` flips `pending → queued`.

The worker reconstructs each job's inputs from the row, so no job payload is stored:
- **File-backed (uploads):** `extractedText` is null and `blobUrl` is a local key → the worker reads bytes via `readLocal(keyFromLocalUrl(blobUrl))`, runs `extractText`, persists `extractedText`/`extractionStatus`/`extractionMethod`/`pageCount`, then runs `finalizeExtraction`.
- **Text-backed (Canvas/Drive/IMSCC):** `extractedText` is already present → the worker skips extraction and runs `finalizeExtraction` directly.

---

## Components

### 1. `lib/capture/ingest-queue.ts` (new)

- **`enqueue(materialId)`** — `UPDATE course_materials SET indexing_status='queued' WHERE id=$1`, then `ensureWorker()`. Idempotent.
- **`ensureWorker()`** — starts the loop if not already running (module-level singleton flag).
- **`claimNext()`** — atomic claim, safe even if the loop ever overlaps:
  ```sql
  UPDATE course_materials SET indexing_status='indexing'
  WHERE id = (
    SELECT id FROM course_materials
    WHERE indexing_status='queued'
    ORDER BY uploaded_at LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
  ```
- **worker loop** — while there is capacity (`inFlight < MAX_CONCURRENCY`) and `claimNext()` returns a row, run `processMaterial(row)` without awaiting (tracked in an in-flight counter); when the queue drains, idle (stop the loop; the next `enqueue` restarts it).
- **`recoverStuck()`** — on first `ensureWorker()` after process start, `UPDATE course_materials SET indexing_status='queued' WHERE indexing_status='indexing'` (a row left `indexing` can only be from a crash/restart, since a live worker never leaves one stuck). Runs once per process.

`MAX_CONCURRENCY` default **2** (one ingest can run while another starts; low enough not to stampede Docling/embeddings). A single constant, easy to tune.

### 2. `processMaterial(row)` (in `lib/capture/ingest-queue.ts`, delegating to existing code)

Pure-ish orchestration over existing functions:
1. If `row.extractedText` is null and `row.blobUrl` is a local key → `readLocal` → `extractText` → persist extraction columns. (If the blob is missing/unreadable → mark `failed`, reason logged.)
2. Call the existing `finalizeExtraction({...})` with the row's text + `createVectorStore()`.
3. `finalizeExtraction` already sets `ready|failed|skipped` — the worker just catches throws and marks `failed` as a backstop.

`finalizeExtraction` itself is unchanged (it already owns digest/chunk/contextualize/embed/upsert + the stage-timing logs added 2026-06-16).

### 3. Route changes

Each route's heavy tail (`await extractText(...)` + `await finalizeExtraction(...)`) is replaced by **store/fetch + insert/update row + `enqueue(id)` + return fast**. The response carries `indexingStatus: 'queued'` instead of the final indexing result.

**Upload-first sequencing:**
- **Phase A (proving ground):** `materials` POST only. Returns `{ id, fileName, blobUrl, indexingStatus: 'queued' }` immediately after storing the file + inserting the row. The faculty sees "Uploaded — indexing in the background."
- **Phase B (same effort, after A is verified):** convert `canvas-import`, `scan-linked-docs`, `imscc-import`, `materials/compress`, `canvas-reextract`, and admin `v2-backfill`. Each keeps its own synchronous I/O (Canvas API fetch, Drive fetch, cartridge parse, etc.) and inserts rows with `extractedText` populated + `indexing_status='queued'`, then enqueues. Their summary responses report counts as "queued for indexing" rather than "indexed."

---

## Status surfacing (UI)

The materials panel already renders `ready` / `indexing` / `failed` and has an "Index now" affordance. Changes:
- Render `queued` as "Queued — indexing in background" (same family as `indexing`).
- The panel already polls course context/material status; ensure it keeps polling while any row is `queued`/`indexing` and stops when all are `ready`/`failed`/`skipped`.
- "Index now" calls `enqueue(id)` (re-queue), replacing any direct synchronous re-index.
- Upload affordance: on a successful POST, show a transient "Uploaded — indexing in the background; you can keep working" message rather than waiting for extraction.

No change to how the audit agent consumes materials: it reads indexed chunks, so a `queued`/`indexing` material simply isn't retrievable yet — already the semantics today for an unfinished material.

---

## Error handling & retry

- A throw in `processMaterial` (blob missing, Docling error, finalize error) → row marked `failed` with the reason logged; the worker continues to the next row (one bad material never blocks the queue).
- Retry is **manual** in v1: "Index now" re-queues a `failed` row. (No automatic retry loop — avoids hammering a persistently-failing material; can add bounded auto-retry later if needed.)
- Boot recovery (above) is the crash-safety net.

---

## Dev-mode caveat

The in-process worker lives in the `next dev` server process, so an HMR reload or service restart drops the loop. `recoverStuck()` re-queues anything left `indexing` on the next start, so **no material is lost** — it just resumes. This is the accepted v1 tradeoff for "no new launchd service." Moving the parent app to a production build (`next start`) — already flagged separately — makes this materially more stable, and a dedicated launchd worker is the eventual robust form.

---

## Testing

- **`claimNext` atomicity** — two concurrent claims never return the same row (`FOR UPDATE SKIP LOCKED`); a unit/integration test against the test DB.
- **`processMaterial` branches** — file-backed (extract-then-finalize) vs text-backed (finalize-only); mock `readLocal`/`extractText`/`finalizeExtraction` and assert the right path runs.
- **`recoverStuck`** — a row left `indexing` is reset to `queued` on worker start.
- **enqueue → ready** — end-to-end: enqueue a seeded row, let the worker drain, assert it reaches `ready` and `finalizeExtraction` was called once.
- **Route returns fast** — `materials` POST returns `indexingStatus: 'queued'` without calling `extractText`/`finalizeExtraction` on the request path (they move to the worker).
- **Concurrency cap** — never more than `MAX_CONCURRENCY` `processMaterial` runs in flight.

---

## What this does NOT include

- **No external queue** (Redis/BullMQ) — Postgres + the existing row is the queue; correct scale for a single local box.
- **No separate worker process** in v1 — in-process loop (chosen). Launchd worker is a later upgrade, behind the same queue.
- **The chunk-LLM provider bake-off** (campus-120B vs `gpt-5.4-mini`) is a **separate, parallel workstream** — it changes *which model* the indexing stage calls, orthogonal to *when/where* indexing runs. Tracked separately; if it lands, the worker benefits automatically (it just calls `finalizeExtraction`).

---

## Files touched

| File | Change |
|---|---|
| `lib/capture/ingest-queue.ts` | **New** — `enqueue`, `ensureWorker`, `claimNext`, worker loop, `recoverStuck`, `processMaterial` |
| `lib/db/course-materials-queries.ts` | `claimNextQueued()` (atomic claim), `resetStuckIndexing()`, persist-extraction helper if not present |
| `lib/db/schema.ts` | Comment: add `queued` to the `indexing_status` value list (no migration) |
| `app/api/courses/[code]/materials/route.ts` | Phase A — POST enqueues + returns `queued` |
| `app/capture/[code]/MaterialsPanel.tsx` (+ status chips) | Render `queued`; keep polling; "Index now" re-queues; upload shows background message |
| `app/api/courses/[code]/{canvas-import,scan-linked-docs,imscc-import,canvas-reextract,materials/compress}/route.ts`, `app/api/admin/v2-backfill/route.ts` | Phase B — enqueue instead of awaiting `finalizeExtraction` |
| Tests | queue atomicity, processMaterial branches, recoverStuck, enqueue→ready, route-returns-fast, concurrency cap |

---

## Related / not blocking this spec

- Three ingest fixes are committed on `dev` and staged for the next coordinated restart: `..`-filename 503, the materials body-locked 500 (middleware exclusion + self-auth), and the Drive-PDF magic-byte detection. Background ingest builds on top of them.
- The dev→production-mode switch (`next start`) is a separate deployment improvement that makes the in-process worker more stable.
