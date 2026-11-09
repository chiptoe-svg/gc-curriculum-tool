# Course Revision Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When faculty reopen an approved course, they explicitly choose *A few specific things changed*, *Re-check the whole course*, or *Start over*. The re-score then shows every rating that moved, each labeled as backed by new evidence or as likely AI variation.

**Architecture:**
- A new `capture_sessions` row stores each session's mode and its baseline snapshot.
- Generate reads that row, anchors the scorer on the baseline snapshot, and runs a pure `buildRevisionChanges` to attach a `revision` block to the draft. Evidence classifiers decide which citations are new.
- The review panel renders `revision` and applies Keep/Undo through the existing reviewer-edit persist.
- Snapshots strip `revision` and start freezing a per-file text hash.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle on Postgres 17, Zod, Vitest (jsdom for components).

**Spec:** `docs/superpowers/specs/2026-11-08-course-revision-modes-labels-design.md`

## Global Constraints

- Owner-approved copy, verbatim:
  - Heading: "What's changed in this course since it was approved?"
  - **A few specific things changed:** "Tell us what changed. Every rating is checked again; any rating that moves without new evidence is set back to the approved version for you. You'll see each change and approve it before it counts."
  - **Re-check the whole course:** "The approved version is the starting point, but every rating is checked again against your current materials and this conversation. You'll see what moved before approving."
  - **Start over:** "Build a new profile from your current materials and the catalog, as if for the first time. The approved version stays in place until you approve the new one."
- Other fixed strings, verbatim:
  - Retired-baseline refusal: "The approved version this revision started from was withdrawn. Start over to revise the current version."
  - Approve blocked: "Decide on each change above first."
  - Review headings: "Changes with new evidence", "Changes without new evidence — likely AI variation", "Evidence no longer in use — check these".
  - Section tag: "Changed since the approved version"; its button: "Restore approved version".
  - Change-row buttons: "Keep change", "Undo".
  - No-evidence group button: "Keep all as set back" (targeted) and "Undo all" (recheck).
- US spelling and plain language in all faculty copy.
- Mode ids are `'targeted' | 'recheck' | 'fresh'`.
- No extra AI calls. Program views, the wiki and the program index are untouched.
- Snapshots stay immutable; `revision` never reaches a snapshot.
- Tests:
  - Run vitest with `env -u DATABASE_URL`, except real-DB tests, which run against the scratch DB URL from `~/.local/state/gc-curriculum-tool/bench-2026-11/converse/run.sh`. Never print that URL.
  - Never run anything against live.
- Migration: hand-written SQL under `drizzle/`, in the style of `0063_weight_source_ai.sql` (BEGIN, `SET LOCAL lock_timeout = '5s'`, precondition DO-block, COMMIT). It is applied to the scratch DB only. The live apply is owner-gated at deploy.
- Every regression test is red-proofed: shown failing with only its fix reverted.

## Review Focus

1. **A session resumed after a reload** keeps its mode. The chooser does not reappear, and Generate still uses the stored mode (Task 6 test `resumed session shows its stored mode`).
2. **The scorer rewords a competency** (case or spacing only): it pairs with its baseline twin, no false added/removed pair appears, and course-emphasis references keep the baseline wording (Task 3 test `normalized match keeps baseline wording and rewrites references`).
3. **A Canvas re-import refreshes the syllabus row in place** with the same size but different text: its chunk citations count as new evidence (Task 2 test `same size, different text counts as changed`; Task 4 test `chunk from a re-imported material is new`).
4. **A course approved before this ships** (no `capture_sessions` row, snapshot without `textHash`): the review shows no change list, and the drift falls back to status and size without throwing (Task 5 test `session without a row behaves as today`; Task 2 test `baseline without textHash falls back`).
5. **The faculty member undoes, then keeps, then hand-edits a competency** and then approves: the snapshot has no `revision` key and holds the edited competency (Task 3 test `undo then keep restores after`; Task 7 test `snapshot strips revision`).

---

### Task 1: `capture_sessions` table and queries

**Files:**
- Create: `drizzle/0064_capture_sessions.sql`
- Modify: `lib/db/schema.ts` (add `captureSessions` after `captureMessages`)
- Create: `lib/db/capture-sessions-queries.ts`
- Test: `tests/lib/db/capture-sessions-queries.test.ts` (real DB, `describe.skipIf(!process.env.DATABASE_URL)`)

**Interfaces:**
- Produces:
  - `type RevisionMode = 'targeted' | 'recheck' | 'fresh'`, exported from `lib/db/capture-sessions-queries.ts`.
  - `recordSessionMode(input: { sessionId: string; courseCode: string; revisionMode: RevisionMode; baselineSnapshotId: string | null }): Promise<void>`. Implemented as `INSERT … ON CONFLICT (session_id) DO NOTHING`.
  - `getSessionMode(sessionId: string): Promise<{ revisionMode: RevisionMode; baselineSnapshotId: string | null } | null>`.

**SQL:**
- Columns: `session_id uuid PRIMARY KEY`, `course_code text NOT NULL REFERENCES courses(code) ON DELETE CASCADE`, `revision_mode text NOT NULL CHECK (revision_mode IN ('targeted','recheck','fresh'))`, `baseline_snapshot_id uuid NULL REFERENCES course_capture_snapshots(id)`, `created_at timestamptz NOT NULL DEFAULT now()`.
- Precondition: raise `'0064: already applied'` if `to_regclass('public.capture_sessions')` is not null.

- [ ] **Step 1: Write the failing tests**
  - `records a mode and reads it back`: record (targeted, a real snapshot id), then `getSessionMode` returns the same.
  - `a second record for the same session is ignored`: record `recheck`, then `fresh`; get returns `recheck`.
  - `unknown session returns null`.
  - Course `ZZ 9310`; a snapshot inserted via `createSnapshot`; clean up in `afterAll`.
- [ ] **Step 2:** Run with the scratch `DATABASE_URL`. Expected: FAIL, the module is missing.
- [ ] **Step 3:** Write the migration, the Drizzle table and the queries. Apply the migration to the scratch DB with a node `pg` script that reads the URL from `run.sh` and never prints it.
- [ ] **Step 4:** Run. Expected: PASS (3/3).
- [ ] **Step 5:** Commit: `capture: capture_sessions table stores each session's revision mode and baseline`.

### Task 2: Text fingerprint in snapshots; drift uses it

**Files:**
- Create: `lib/capture/text-hash.ts`
- Modify: `lib/db/capture-snapshots-queries.ts:21-27` (`InputsMeta.materials[]` gains `textHash?: string | null`)
- Modify: `app/api/capture/[code]/snapshots/route.ts:89-95` (freeze `textHash: hashText(m.extractedText)`)
- Modify: `lib/capture/inputs-drift.ts`
- Test: `tests/lib/capture/inputs-drift-hash.test.ts`

**Interfaces:**
- Produces:
  - `hashText(text: string | null | undefined): string | null`: sha256 hex of the text, or null for null or empty input.
  - `diffInputsVsSnapshot`: unchanged signature. A frozen material with a non-null `textHash` counts as `changed` when `hashText(live.extractedText) !== textHash` (and still on the existing status, size and ignored comparison). Without `textHash`, it uses today's comparison only.

- [ ] **Step 1: Write the failing tests**
  - `same size, different text counts as changed`: frozen `{sizeBytes: 10, textHash: hashText('a')}`; live `{sizeBytes: 10, extractedText: 'b'}`. Expect `changed` to include the id.
  - `same text is not changed`.
  - `baseline without textHash falls back`: no `textHash`, same status and size, different text. Expect `changed` to be empty.
- [ ] **Step 2:** Run with `env -u DATABASE_URL npx vitest run tests/lib/capture/inputs-drift-hash.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `hashText` with `node:crypto`. Use it in the drift and in the snapshot route.
- [ ] **Step 4:** Run the new test plus `tests/app/capture/inputs-drift-banner.test.tsx`. Expected: PASS.
- [ ] **Step 5:** Commit: `capture: snapshots freeze a text fingerprint per file; drift catches same-size edits`.

### Task 3: `revision` schema field and pure change builder

**Files:**
- Modify: `lib/ai/capture/schema.ts`: add `revisionSchema` and `revision: revisionSchema.nullable().optional()` on `captureProfileSchema`. Do not add it to any schema sent to the model.
- Create: `lib/capture/revision-changes.ts`
- Test: `tests/lib/capture/revision-changes.test.ts`

**Interfaces:**
- Consumes: `CaptureProfile`, `CaptureCompetency` and `CaptureProfileCitationType` from `lib/ai/capture/schema.ts`.
- Produces:
  - `revisionSchema`, the spec's shape. One ruling against the spec: `changed_sections` is `Array<{ section: string; before: unknown }>`, not `string[]`, because "Restore approved version" needs the baseline value. Ledger it.
  - `type Revision = z.infer<typeof revisionSchema>`.
  - `normalizeStatement(s: string): string`: trim, lowercase, collapse whitespace.
  - `buildRevisionChanges(input: { mode: 'targeted' | 'recheck'; baselineSnapshotId: string; baseline: CaptureProfile; scored: CaptureProfile; isNewCitation: (c: CaptureProfileCitationType) => boolean; isStaleCitation: (c: CaptureProfileCitationType) => boolean }): CaptureProfile`. It returns `scored` with matched statements and references set to the baseline wording, `revision` attached, and the competency array reflecting the initial decisions.
  - `applyRevisionDecision(profile: CaptureProfile, statement: string, decision: 'kept' | 'undone'): CaptureProfile`. Kept puts `after` back (or removes the competency for `removed`); undone puts `before` back (or removes it for `added`). It sets the entry's `decision`.
  - `restoreSection(profile: CaptureProfile, section: string): CaptureProfile`. It puts `before` back and removes that entry from `changed_sections`.
- Sections compared: `summary`, `incoming_expectations`, `major_projects`, `productive_failure_conditions`, `course_emphasis`, `revised_objectives_draft`. Read the exact keys from `captureProfileSchema` and include each one that exists. Compare with `JSON.stringify` after the reference rewrite.
- Initial decisions (spec): `targeted` with label `no_new_evidence` → `undone`; `targeted` with `new_evidence` → `pending`; `recheck` → `pending`.

- [ ] **Step 1: Write the failing tests**
  - `unchanged ratings produce no change`.
  - `moved with a new citation is labeled new_evidence and pending in targeted`. Assert `label`, `decision: 'pending'`, `new_citations` holds only the new ones, and the profile shows `after`.
  - `moved without new evidence is set back in targeted`. Assert `decision: 'undone'` and that the competency deep-equals the baseline's.
  - `recheck leaves every change pending`, including the no-evidence ones, and the profile shows `after`.
  - `added and removed competencies are listed`, with kinds `added` and `removed`. In targeted mode, a no-evidence `added` change is left out of the competencies and a `removed` one is kept.
  - `normalized match keeps baseline wording and rewrites references`: scored `"  Color  Management"` against baseline `"Color management"`. Expect no added/removed pair; the `course_emphasis[].competency` and major-project `competencies` entries read `"Color management"`.
  - `stale citations are listed`: a kept competency whose citation passes `isStaleCitation` appears in `stale_evidence`.
  - `changed sections carry the baseline value`.
  - `undo then keep restores after`: `applyRevisionDecision` twice gives the `after` competency and `decision: 'kept'`.
  - `restoreSection puts the baseline back`.
  - `schema accepts a profile with revision and one without`: `captureProfileSchema.parse` on both.
  - Fixtures: build from `tests/app/capture/fixtures/override-profile.ts` where it fits.
- [ ] **Step 2:** Run. Expected: FAIL, the module is missing.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new test and `tests/lib/ai` capture-schema tests (`npx vitest run tests/lib/ai -t schema`). Expected: PASS.
- [ ] **Step 5:** Commit: `capture: revision block and pure change builder (labels, initial decisions, undo/keep)`.

### Task 4: Evidence classifiers

**Files:**
- Create: `lib/capture/revision-evidence.ts`
- Test: `tests/lib/capture/revision-evidence.test.ts` (in-memory vector store; mock `@/lib/db/capture-messages-queries`)

**Interfaces:**
- Consumes:
  - `getSessionMessages(courseCode, sessionId)`; each row has `id`.
  - `diffInputsVsSnapshot` (Task 2).
  - `isSentToAI`.
  - `VectorStore.fetchChunkById`.
  - `tenantForCourse`.
- Produces: `buildCitationClassifiers(input: { courseCode: string; sessionId: string; baseline: SnapshotRow; materials: CourseMaterialRow[]; course: { canvasImportedAt: string | Date | null }; scored: CaptureProfile; store?: VectorStore }): Promise<{ isNewCitation: (c) => boolean; isStaleCitation: (c) => boolean }>`.
  - It prefetches every distinct `chunkId` across `scored` and `baseline.profile` once, then returns synchronous predicates.
  - New:
    - an instructor citation whose `messageId` equals a session message id or is its 8-character prefix;
    - or a chunk citation whose material id is in the drift's `added` or `changed`.
  - Stale: a chunk citation whose chunk is missing, whose material is missing, whose material fails `isSentToAI`, or whose material is in the drift's `removed`.
  - A failed lookup is not new, and it is stale.

- [ ] **Step 1: Write the failing tests**
  - `instructor citation from this session is new`, testing both the full UUID and the 8-character prefix.
  - `instructor citation from an older session is not new`.
  - `chunk from an added material is new`.
  - `chunk from a re-imported material is new`: same id, `textHash` differs.
  - `chunk from an unchanged material is not new`.
  - `chunk from a retired material is stale`.
  - `missing chunk is stale and not new`.
  - `each chunk id is looked up once`: spy on `fetchChunkById`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `capture: classify citations as new or stale against the baseline snapshot`.

### Task 5: Generate uses the stored mode

**Files:**
- Modify: `app/api/capture/[code]/scores/route.ts` (mode-1 branch, lines ~82–185)
- Test: `app/api/capture/[code]/scores/__tests__/revision-modes.test.ts`, following the mocking style of `no-brief.test.ts`

**Interfaces:**
- Consumes: `getSessionMode` (Task 1), `getSnapshotById`, `buildCitationClassifiers` (Task 4), `buildRevisionChanges` (Task 3).
- Behavior (spec table):
  - **No row:** today's behavior, byte for byte.
  - **`fresh`:** `priorCaptureProfile: null`, and no `preserveAdoptOverlay`.
  - **`targeted` and `recheck`:**
    1. Load the baseline by id. If it is missing or `retiredAt` is set, return 409 `{ error: 'baseline_withdrawn', message: <fixed refusal string> }`.
    2. Set `priorCaptureProfile` to the baseline profile, generate, then run `preserveAdoptOverlay(draft)` as today.
    3. Build the classifiers and run `buildRevisionChanges` with `scored` = the overlaid profile.
    4. Upsert.

- [ ] **Step 1: Write the failing tests**
  - `session without a row behaves as today`: the prior profile is the draft, and the result has no `revision`.
  - `fresh passes no prior profile and drops the adopt overlay`.
  - `recheck anchors on the baseline snapshot, not the draft`: assert the `generateCaptureProfileV2` context's `priorCaptureProfile` equals the snapshot profile.
  - `targeted attaches a revision block`.
  - `retired baseline returns 409 with the fixed message`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new test and the existing `scores/__tests__`. Expected: PASS.
- [ ] **Step 5:** Commit: `capture: Generate anchors on the stored baseline and attaches the change list`.

### Task 6: Chat records the mode; interviewer's targeted opening; landing chooser

**Files:**
- Modify: `app/api/capture/[code]/chat/route.ts`:
  - Accept `revisionMode`.
  - Before the agent runs, when a mode is given, call `recordSessionMode` with `baselineSnapshotId` set to `(await getLatestSnapshotByCourse(courseCode))?.id ?? null` for targeted and recheck, and null for fresh.
  - Then derive `includePriorSessions` from `getSessionMode(sessionId)` when a row exists (`fresh` → false). Otherwise keep the body flag.
  - Pass `revisionMode` to the agent.
- Modify: `lib/ai/agent/audit-agent.ts`:
  - `AuditAgentInput` gains `revisionMode?: RevisionMode | null`.
  - When it is `targeted`, `buildAgentCall` adds a block titled `# Approved profile (what this revision starts from)`. It lists `statement — K/U/D` for each competency of the latest snapshot's profile, one line each.
  - It also adds the instruction that the interviewer opens by asking what changed since approval and keeps questions on the changes and their knock-on effects.
  - The exact prompt wording is the builder's call.
- Modify:
  - `app/capture/[code]/CaptureHero.tsx`: replace the "Start mode" fieldset with the three options and the Global Constraints copy. The heading plus the muted "instructor · date" line. `mode: RevisionMode | null`, with no default.
  - `CaptureClient.tsx`: `chooserMode` becomes `RevisionMode | null`, initial `null` when a snapshot exists. The start control is disabled while it is null and a snapshot exists.
  - `CaptureChatPanel.tsx`: send `revisionMode` and keep `includePriorSessions` for no-snapshot courses.
- Modify: `app/capture/[code]/page.tsx`. When resuming a saved session, read `getSessionMode(latestSessionId)` and pass `resumedMode`. When set, CaptureHero shows the stored mode's label as fixed text in place of the radios.
- Test:
  - `app/api/capture/[code]/chat/__tests__/revision-mode.test.ts`
  - `tests/lib/ai/agent/audit-agent.test.ts` (add cases)
  - `tests/app/capture/revision-mode-chooser.test.tsx`

**Interfaces:**
- Consumes: `RevisionMode`, `recordSessionMode` and `getSessionMode` (Task 1).
- Produces: the `CaptureHero` props `mode: RevisionMode | null`, `onModeChange(v: RevisionMode)` and `resumedMode?: RevisionMode | null`.

- [ ] **Step 1: Write the failing tests**
  - Route:
    - `records the mode before the agent runs`: the call order shows `recordSessionMode` before `streamAuditAgent` or `runAuditAgent`.
    - `fresh session turns prior sessions off`.
    - `no mode leaves today's behavior`.
  - Agent:
    - `targeted adds the approved profile block and the what-changed instruction`.
    - `recheck and no mode add neither`.
  - Component:
    - `shows the three options with the approved wording` (exact strings).
    - `nothing is selected and start is disabled until a choice`.
    - `resumed session shows its stored mode`: no radios, the label text is shown.
    - `no snapshot shows no chooser`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new tests, the existing chat `__tests__`, `tests/lib/ai/agent/` and `tests/app/capture/instructor-select.test.tsx`. Expected: PASS.
- [ ] **Step 5:** Commit: `capture: three revision choices on reopening an approved course; mode stored on the first turn`.

### Task 7: Review panel change list; approval gate; snapshot strip

**Files:**
- Create: `app/capture/[code]/RevisionChanges.tsx`
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx`:
  - Render `RevisionChanges` at the top when `working.revision` is set.
  - Keep/Undo/Restore update `working` through `applyRevisionDecision` and `restoreSection`, then save through the existing reviewer-edit persist.
  - Disable approve, with the fixed message, while any change is `pending`.
  - Add the "Changed since the approved version" tag and the "Restore approved version" button on each section listed in `changed_sections`.
- Modify: `app/api/capture/[code]/snapshots/route.ts`: freeze `profile` with the `revision` key removed.
- Test:
  - `tests/app/capture/revision-changes.test.tsx`
  - `tests/app/api/snapshots-strip-revision.test.ts`, in the style of `snapshots-clear-raw.test.ts`

**Interfaces:**
- Consumes: `Revision`, `applyRevisionDecision` and `restoreSection` (Task 3).
- Produces: `RevisionChanges({ revision, mode, onDecide(statement, decision), onDecideGroup(decision) })`.

**UI requirements:**
- Row content:
  - Each row shows the statement and each moved dimension as `K 3 → 2`.
  - A new citation to an interview answer shows its excerpt; a citation to a file shows the file name, resolved through the existing chunk route `/api/capture/[code]/chunks/[chunkId]`. If that route is not reachable from the panel, show the excerpt.
- Tooltip on Undo: "Restores the approved version of this competency, replacing any edits you made to it."

- [ ] **Step 1: Write the failing tests**
  - `lists changes in the three groups with the fixed headings`.
  - `undo restores the approved competency and keep restores the new one`.
  - `approve is disabled while a change is pending`, showing the fixed message, and enabled once every change is decided.
  - `targeted no-evidence changes count as decided`.
  - `group button applies to the no-evidence group only`.
  - `restore approved version puts a changed section back`.
  - `snapshot strips revision`: the `createSnapshot` mock receives a profile without a `revision` key.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new tests and `tests/app/capture/` (the review-panel suites). Expected: PASS.
- [ ] **Step 5:** Commit: `capture: review lists every moved rating with its label; approve waits for decisions`.

### Task 8: Full verification and STATE.md

**Files:**
- Modify: `docs/STATE.md`:
  - Replace the "Course revision modes — designed, not built" Deferred bullet with a built-not-deployed entry.
  - Add `capture_sessions` and migration 0064 under the schema notes.
  - Add the live deploy order: backup → apply 0064 → verify the table exists → build and deploy.

- [ ] **Step 1:** Run `env -u DATABASE_URL npx vitest run > .superpowers/suite.log 2>&1` and read the tail. Expected: 0 failed.
- [ ] **Step 2:** Run the real-DB tests from Task 1 against the scratch DB. Expected: PASS.
- [ ] **Step 3:** Run `npx tsc --noEmit -p .`, then `npx eslint` on the changed files. Expected: no errors.
- [ ] **Step 4:** Commit: `docs(state): course revision modes built (not deployed); 0064 live order`.
