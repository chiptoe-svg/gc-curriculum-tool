# Add a File During the Interview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Add a file" button beside Voice in the interview. The file becomes a course material, marked "Added during the interview", and is read in full at once. The interviewer is told about it on the instructor's turn and must search it before answering.

**Architecture:**
- **Upload:** reuses `POST /api/courses/[code]/materials` with one new form field, `sessionId`. When it is present, the route records provenance (new column `course_materials.added_in_session`, migration 0075), sets tier `high` and enqueues the material at once. It skips the list-mode triage wait and the course-wide ingest cooldown; the daily cost cap still applies in the worker.
- **Status:** the chat panel polls the existing course `ingest-status` route for that material.
- **Instructor's turn:** carries a fixed marker line. `needsMaterialSearch` treats that marker as a required search on both loops.

**Tech Stack:** Next.js 15, TypeScript strict, Drizzle/Postgres 17, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-19-interview-add-file-design.md` (owner chose A on 2026-11-19; approved to proceed on 2026-11-20).

## Global Constraints

- Same upload limits and allowed types as Materials: `MAX_SIZE_BYTES` (100 MB) and `ALLOWED_MIME_TYPES` in the materials route. Same auth (`gateGrant` + `authorizeCourseWrite`). The daily cost cap applies to processing.
- **Reading:** a file added in the interview is read in full (tier `high`). Pictures go through the same extractor and image-description path as any image material. No new extraction pipeline and no new vision model.
- **Model input:** the interview model never receives the file itself; it searches the material like any other.
- **Both loops:** it works the same on the current loop and on Pi, and on every interview model.
- **Button only:** no drag-and-drop or image paste in this version.
- **Phone width:** the button and the chip fit the reply row with no sideways scroll.
- **Marker line**, exactly: `[Instructor added a file: <name> (id=<material id>) — search it before answering.]` When reading failed: `[Instructor added a file: <name> (id=<material id>) — it could not be read; ask for the key part pasted instead.]`
- **Live database:** migration 0075 is applied to live only after a backup and the owner's yes.
- **Writing:** US spelling and plain language.

## Review Focus

1. **A second file added within 60 seconds of the first.** Expected: it processes at once; the course-wide ingest cooldown does not block it. Tested in Task 2 (`two interview files back to back both enqueue`).
2. **The instructor sends while the file is still being read.** Expected: the note goes at once, the marker says the file is still being read, and the marker is not sent twice when it becomes ready. Tested in Task 4 (`sends now with the file pending`).
3. **A file with the same name and size as one already in Materials.** Expected: no second upload. The chip says "Already in your materials", and the marker points at the existing material id. Tested in Task 4 (`duplicate points at the existing file`).
4. **Removing the chip before sending.** Expected: the material is deleted through the existing `DELETE /api/courses/[code]/materials/[id]`, and nothing is sent. Tested in Task 4.
5. **The marker on the Pi loop.** Expected: Pi forces a search on that turn just as the current loop does. Tested in Task 3 (`marker forces a search`), since both loops call `needsMaterialSearch`.

---

### Task 1: Migration 0075 and provenance

**Files:**
- Create: `drizzle/0075_material_added_in_session.sql`, `scripts/migrations/2026-11-20-added-in-session-live-apply.sh`
- Modify: `lib/db/schema.ts` (`courseMaterials` gains `addedInSession: uuid('added_in_session')`, FK `capture_sessions.session_id ON DELETE SET NULL`); `lib/db/course-materials-queries.ts` (`InsertMaterialInput.addedInSession?: string | null`, written by `insertMaterial`, returned on the row)
- Modify: `app/capture/[code]/MaterialsPanel.tsx`: rows with `addedInSession` show "Added during the interview"
- Test: `lib/db/__tests__/course-materials-schema.test.ts` (extend), `tests/app/capture/materials-panel-added.test.tsx`

**Migration rules:**
- One transaction.
- `RAISE EXCEPTION '0075: already applied'` if the column exists.
- It only does `ALTER TABLE course_materials ADD COLUMN added_in_session uuid REFERENCES capture_sessions(session_id) ON DELETE SET NULL`. No data changes.
- It does not depend on 0074: either plan can ship first.

- [ ] **Step 1: Write the failing tests:**
  - the migration text guards a second apply, is one transaction and contains no `UPDATE|DELETE|DROP`;
  - the `courseMaterials` config has column `added_in_session`;
  - `MaterialsPanel` shows "Added during the interview" for a row with `addedInSession` set, and not for one without.
- [ ] **Step 2: Run them.**
Run `pnpm vitest run lib/db/__tests__/course-materials-schema.test.ts tests/app/capture/materials-panel-added.test.tsx`.
Expected: FAIL.
- [ ] **Step 3: Implement.** Write the live-apply script as in the skill tree plan: a v17 `pg_dump` backup, `ON_ERROR_STOP`, `|| exit 1` on each step and a column check at the end. Do not run it.
- [ ] **Step 4: Run them.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(capture): course_materials.added_in_session (0075) and its Materials label`.

---

### Task 2: The upload path for an interview file

**Files:**
- Modify: `app/api/courses/[code]/materials/route.ts` (POST)
- Modify: `app/api/capture/[code]/ingest-status/route.ts`: with `?id=<material id>` it returns `{ id, indexingStatus, extractionStatus }` for that material of this course (404 if none). Without `id`, the counts are unchanged.
- Test: `app/api/courses/[code]/materials/__tests__/` (add `interview-upload.test.ts`, mocking as the existing tests in that folder do)

**Interfaces:**
- Consumes: `insertMaterial({... addedInSession })`, `updateMaterialTier(id, 'high')`, `enqueue(id)`.
- Produces: the response gains `addedInSession` and `duplicateOf: string | null`.

**Behavior when `form.get('sessionId')` is a UUID:**
- **Session check:** the session must exist in `capture_sessions` with this course's `course_code`. Otherwise return 400 "That interview session is not for this course."
- **Duplicates:** if a non-ignored material of this course has the same `fileName` and `sizeBytes`, return 200 `{ id: <existing id>, duplicateOf: <existing id>, indexingStatus: <its status> }` and store nothing.
- **Otherwise:** store as today with `addedInSession`, `await updateMaterialTier(id, 'high')`, then `await enqueue(id)` even when triage is enabled, and return `indexingStatus: 'queued'`.
  - This path does not run the background tier classifier.
  - It goes straight to the worker, which has no course cooldown; the 60-second cooldown lives only in the course `ingest` route, which this path does not call.
  - It keeps the IP rate limit and the cost cap.

Without `sessionId`, behavior is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `an interview file is stored with its session, tier high, and enqueued even with triage on`;
  - `a session from another course is refused`;
  - `duplicate points at the existing file and stores nothing`;
  - `two interview files back to back both enqueue`;
  - `an upload without a session behaves as before` (triage on: no enqueue);
  - `ingest-status with an id reports that material, and 404 for another course's`.
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, plus the folder's existing tests.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(capture): materials upload from the interview is read in full at once`.

---

### Task 3: The marker and the forced search

**Files:**
- Modify: `lib/ai/agent/interview-controls.ts`: export `fileAddedMarker(name: string, id: string, readable: boolean): string`, which builds the exact Global Constraints lines. `needsMaterialSearch` returns `{ required: true, reason: 'the instructor added a file' }` when the message contains `[Instructor added a file:` and the readable form (`search it before answering`).
- Modify: `lib/ai/prompts/capture-chat-agent.md`, lines 795–806. Replace the "cannot receive a file here … Never ask the instructor to upload or attach a file in the chat." passage with: the instructor can add a file with the "Add a file" button beside Voice. When a needed document isn't in the materials, ask for it that way, or for the key part pasted. A line `[Instructor added a file: … (id=…)]` means the file is now a course material: search it before answering. If the line says it could not be read, ask for the key part pasted.
- Test: `lib/ai/agent/__tests__/interview-controls.test.ts` (extend), plus the prompt test if one pins this text (`grep -rl "Never ask the instructor to upload" tests lib`).

- [ ] **Step 1: Write the failing tests:**
  - `fileAddedMarker builds the exact readable and unreadable lines`;
  - `marker forces a search` (`needsMaterialSearch('here is the rubric\n' + marker, [])` returns required with that reason);
  - `the unreadable marker does not force a search`;
  - `the prompt no longer forbids asking for a file and names the button`.
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, plus `lib/ai/agent/__tests__` in full** (both loops' tests).
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(interview): the interviewer may ask for a file; an added file forces a search`.

---

### Task 4: The button and chip in the chat

**Files:**
- Create: `app/capture/[code]/AddFileButton.tsx`
- Modify: `app/capture/[code]/CaptureChatPanel.tsx`: render `AddFileButton` beside `VoiceRecorder` (line ~562); keep the attached files in state; `handleSend` appends one marker line per file
- Test: `tests/app/capture/add-file-button.test.tsx`

**Interfaces:**
- Consumes: Task 2's response; `fileAddedMarker` (Task 3); `GET /api/capture/[code]/ingest-status?id=` (Task 2), polled every 3 seconds; `DELETE /api/courses/[code]/materials/[id]`.
- Produces: `export function AddFileButton(props: { courseCode: string; slug: string; sessionId: string | null; disabled: boolean; files: AttachedFile[]; onChange: (files: AttachedFile[]) => void })` and `export interface AttachedFile { id: string; name: string; state: 'uploading' | 'reading' | 'ready' | 'failed' | 'duplicate' }`.

**Behavior:**
- The file input `accept` attribute lists the materials route's types. The button is disabled until there is a `sessionId`.
- **Chip text:**
  - "Uploading…", then "Reading your file…", then "Ready".
  - "Already in your materials" for a duplicate, which counts as ready.
  - "Could not read this file" when it fails, or after 120 seconds without ready.
  - Each chip has a remove "×". Remove calls DELETE, except for duplicates, which are only dropped from the chip list.
- **Send** is allowed at any time.
  - Ready or duplicate files get the readable marker.
  - Failed files get the unreadable marker.
  - Files still uploading or reading get the readable marker plus ` (still being read)`. The interviewer's search simply finds nothing yet, and the turn is not held.
  - After sending, the chips clear. A file is never marked twice.

- [ ] **Step 1: Write the failing tests** (mock `fetch`):
  - `uploads with the session and shows reading then ready`;
  - `duplicate points at the existing file` (the marker carries the existing id);
  - `sends now with the file pending` (the message carries `(still being read)` and the chips clear);
  - `a failed file sends the could-not-be-read marker`;
  - `removing a chip deletes the material and sends nothing`;
  - `disabled without a session`.
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, plus the existing `CaptureChatPanel` tests.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(interview): Add a file button beside Voice`.

---

### Task 5: The spec's check on campus models (free), STATE and the hand-off

- [ ] **Step 1:** Replay GC 3400 turn 1 on a campus interview model with the rubric CSV added through the new path, using the existing replay harness under `scripts/bench/` on `gc_curriculum_builder_scratch`. Do the same for a photo of a student print with a note, and for a forced failed extraction. Record in the commit message whether the interviewer searched and cited the file each time.
Expected: it searches and cites in cases 1–2, and asks for the key part pasted in case 3. Campus models only, so there is no cost.

- [ ] **Step 2:** Run `pnpm vitest run > .superpowers/sdd/add-file-suite.log 2>&1; tail -5 .superpowers/sdd/add-file-suite.log` and `pnpm tsc --noEmit`.
Expected: all pass.

- [ ] **Step 3:** In `docs/STATE.md`, add "Add a file during the interview" (built; 0075 not applied to live). Add a Deferred / debt line for drag-and-drop and image paste (non-goals for v1). Commit `docs(state): add a file during the interview built; 0075 awaiting the owner's yes`.

## Rulings made in this plan (owner to check)

- **Sending is never held for the file.** The spec offered "wait until ready, or send now marked pending". I chose always-send so the instructor is never stuck; the interviewer is told the file is still being read. If wrong, add a "wait" choice to the chip.
- **The duplicate check is by name and size**, as the spec says. A same-name file with new contents uploads normally.
- **Status comes from polling the `ingest-status` route (new `?id=` form) every 3 seconds**, not streaming.
