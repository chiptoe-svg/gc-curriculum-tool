# Draft / Snapshot Clarity + Version Legibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the draft-vs-snapshot model legible — a working-draft status strip, an inputs-drift banner when a forked draft's materials have changed since its source snapshot, an adopt confirm-dialog that names what it replaces, and reworked `/courses` row verbs — anchored by a new `source_snapshot_id` on the draft.

**Architecture:** One additive nullable column (`course_capture_profiles.source_snapshot_id`) records which snapshot a draft was forked from (load-snapshot or adopt), and is **cleared by a fresh AI re-score** (drift resolved) but preserved on edit-save. A pure `diffInputsVsSnapshot` compares the source snapshot's frozen `inputsMeta.materials` against the course's live materials. UI is additive (a status strip + a conditional banner on the capture page, and relabeled verbs on `/courses`); the existing `SnapshotHistoryPanel` is reused unchanged.

**Tech Stack:** TypeScript strict, Drizzle/Postgres (local `127.0.0.1:5433`), Zod, Vitest + jsdom + @testing-library/react, Next.js 15 App Router.

**Spec:** [`2026-07-09-draft-snapshot-clarity-and-version-legibility-design.md`](../specs/2026-07-09-draft-snapshot-clarity-and-version-legibility-design.md).

**Depends on:** #188 adopt (merged to `main` `bc09a7d`, deployed) — `adoptScenario`, `adopted_from_scenario_id`, the enabled `ScenarioCard` Adopt button + `AskTab.handleAdopt` all exist on `main`.

---

## ⚠️ Migration-drift constraint (READ FIRST — affects Task 1)

The drizzle journal is out of sync with disk (tracked as debt #207): the journal records **46** applied migrations but **48** `.sql` files exist on disk (`0046`, `0047` were applied out-of-band by a harness, not via `db:migrate`). **`pnpm db:migrate` is UNSAFE** — it would try to re-run `0046`'s `CREATE TABLE` and fail "already exists."

Therefore Task 1 **generates** the migration file for record-keeping (`pnpm db:generate`) but **applies the column via direct idempotent SQL** (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`), NOT `db:migrate`. Do not run `pnpm db:migrate` anywhere in this plan.

---

## Reused interfaces

- `course_capture_profiles` table (`lib/db/schema.ts:407`) — PK `course_code`, `profile jsonb`, `reviewer_status`, `reviewer_note`, `scale_version`, `created_at`, `updated_at`.
- `getCaptureProfileByCourse` → `CourseCaptureProfileRow`, `upsertCaptureProfile({courseCode, profile, reviewerStatus?, reviewerNote?})` (`lib/db/course-capture-profiles-queries.ts`).
- `loadSnapshotAsDraft(snapshotId)` — atomic `onConflictDoUpdate` write of a snapshot's profile into the draft (`lib/db/capture-snapshots-queries.ts:160`).
- `adoptScenario(scenarioId, expectedCourseCode?)` (`lib/ai/explore/adopt.ts`) — calls `upsertCaptureProfile`; has `scenario.baselineSnapshotId` in scope.
- `InputsMeta` (`lib/db/capture-snapshots-queries.ts:12`) — `.materials: Array<{id, fileName, extractionStatus, sizeBytes, ignored}>`, `.scanPasses: {canvasImportedAt, googleDocsScannedAt}`.
- `listMaterialsByCourse(courseCode) → CourseMaterialRow[]` (`lib/db/course-materials-queries.ts:68`); `CourseMaterialRow = typeof courseMaterials.$inferSelect` (has `id`, `fileName`, `extractionStatus`/indexing fields, `sizeBytes`, `ignored`/`retiredAt`).
- `courses.canvasImportedAt` (`lib/db/schema.ts:117`).
- `getSnapshotById(id) → SnapshotRow` (has `.inputsMeta`, `.caption`, `.createdAt`).
- `SnapshotHistoryPanel` (`app/capture/[code]/SnapshotHistoryPanel.tsx`) — unchanged.
- `CoursesIndex` / `CourseRow` (`app/courses/CoursesIndex.tsx`) — `row.status: CaptureStatus` (`not-started|in-audit|ai-drafted|reviewed|captured`), `row.lastCapturedAt`, builds `captureHref`/`askHref`.

---

## Task 1: `source_snapshot_id` column + schema + query plumbing

**Files:** Modify `lib/db/schema.ts`, `lib/db/course-capture-profiles-queries.ts`; Create `drizzle/0048_*.sql` (generated); Test `tests/lib/db/source-snapshot-id.test.ts`.

- [ ] **Step 1: Add the column to the Drizzle table.** In `lib/db/schema.ts`, in `courseCaptureProfiles` (after `reviewerNote`):
```typescript
  sourceSnapshotId: text('source_snapshot_id'), // nullable — the snapshot a draft was forked from (load/adopt); cleared on fresh re-score
```

- [ ] **Step 2: Generate the migration for record (do NOT migrate).** Run `pnpm db:generate`. Confirm it emits `drizzle/0048_*.sql` containing `ALTER TABLE "course_capture_profiles" ADD COLUMN "source_snapshot_id" text;`. Do NOT run `pnpm db:migrate`.

- [ ] **Step 3: Apply the column directly (idempotent) to the shared dev DB.** Run:
```bash
psql "$DATABASE_URL" -c 'ALTER TABLE course_capture_profiles ADD COLUMN IF NOT EXISTS source_snapshot_id text;'
```
(Take `DATABASE_URL` from `.env.local`; the config has no dotenv loader.) Expected: `ALTER TABLE`. Re-running is a no-op.

- [ ] **Step 4: Thread through the query layer.** In `lib/db/course-capture-profiles-queries.ts`:
  - Add `sourceSnapshotId: string | null;` to `CourseCaptureProfileRow`.
  - In `getCaptureProfileByCourse`'s returned object add `sourceSnapshotId: row.sourceSnapshotId,`.
  - Add to `UpsertCaptureProfileInput`: `sourceSnapshotId?: string | null;` **(undefined = preserve on update; explicit value incl. `null` = set/clear).**
  - In `upsertCaptureProfile`, implement the preserve-vs-set semantics:
```typescript
export async function upsertCaptureProfile({
  courseCode, profile, reviewerStatus = 'ai_drafted', reviewerNote = null, sourceSnapshotId,
}: UpsertCaptureProfileInput): Promise<void> {
  const now = new Date();
  const existing = await db
    .select({ courseCode: courseCaptureProfiles.courseCode })
    .from(courseCaptureProfiles)
    .where(eq(courseCaptureProfiles.courseCode, courseCode))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(courseCaptureProfiles).values({
      courseCode, profile, reviewerStatus, reviewerNote,
      scaleVersion: profile.scale_version,
      sourceSnapshotId: sourceSnapshotId ?? null, // insert: undefined → null
      createdAt: now, updatedAt: now,
    });
  } else {
    await db.update(courseCaptureProfiles)
      .set({
        profile, reviewerStatus, reviewerNote,
        scaleVersion: profile.scale_version,
        updatedAt: now,
        // undefined = preserve existing forked-provenance; explicit (incl null) = set/clear
        ...(sourceSnapshotId !== undefined ? { sourceSnapshotId } : {}),
      })
      .where(eq(courseCaptureProfiles.courseCode, courseCode));
  }
}
```

- [ ] **Step 5: Write the round-trip test** `tests/lib/db/source-snapshot-id.test.ts` (mirror the DB-test pattern in `tests/lib/db/reconciliation-log.test.ts` — same in-memory/pg harness those tests use). Assert: insert with `sourceSnapshotId: 'snap-1'` → `getCaptureProfileByCourse` returns it; update omitting `sourceSnapshotId` preserves `'snap-1'`; update with `sourceSnapshotId: null` clears it. If the repo's DB tests require a live DB and run in a dedicated suite, follow that suite's existing setup exactly.

- [ ] **Step 6: Run** `pnpm vitest run tests/lib/db/source-snapshot-id.test.ts` → PASS; `pnpm tsc --noEmit` clean.
- [ ] **Step 7: Commit** — `git add lib/db/schema.ts lib/db/course-capture-profiles-queries.ts drizzle/0048_*.sql tests/lib/db/source-snapshot-id.test.ts && git commit -m "feat(capture): source_snapshot_id on the working draft (drift baseline)"`

---

## Task 2: Set / clear `source_snapshot_id` at the write sites

**Files:** Modify `lib/db/capture-snapshots-queries.ts` (`loadSnapshotAsDraft`), `lib/ai/explore/adopt.ts` (`adoptScenario`), `app/api/capture/[code]/scores/route.ts` (fresh-score clears; edit-save preserves), `lib/capture/adopt-overlay.ts` if needed; Test `tests/lib/ai/explore/adopt.test.ts` (extend), `tests/lib/db/source-snapshot-id.test.ts` (extend).

- [ ] **Step 1: `loadSnapshotAsDraft` sets it.** In its `fields` object add `sourceSnapshotId: snapshotId,` (it's forked from exactly this snapshot).

- [ ] **Step 2: `adoptScenario` sets it.** In the `upsertCaptureProfile({...})` call add `sourceSnapshotId: scenario.baselineSnapshotId,`.

- [ ] **Step 3: Fresh AI re-score CLEARS it; edit-save PRESERVES it.** In `app/api/capture/[code]/scores/route.ts`:
  - **Mode 1 (fresh score from `generateCaptureProfileV2`, the `preserveAdoptOverlay` site):** pass `sourceSnapshotId: null` to its `upsertCaptureProfile` call — the draft is now scored against current materials, so the fork/drift flag is resolved. **Note:** this is orthogonal to `preserveAdoptOverlay`, which still carries `adopted_from_scenario_id` + `intended_target` across the re-score (the target overlay persists; only the drift flag clears).
  - **Mode 2 (reviewer edit-save):** do NOT pass `sourceSnapshotId` (omit it → preserved) — an edit isn't a re-score.

- [ ] **Step 4: Guard `preserveAdoptOverlay` doesn't resurrect the flag.** `preserveAdoptOverlay` operates on the profile object (`intended_target`, `adopted_from_scenario_id`) and does NOT touch `source_snapshot_id` (a draft-row column, not a profile field). Confirm by reading `lib/capture/adopt-overlay.ts` — no change expected. (If it somehow references the column, leave the column to the query layer.)

- [ ] **Step 5: Extend tests.** In `tests/lib/db/source-snapshot-id.test.ts` add: after a load/adopt sets `source_snapshot_id`, a fresh-score upsert with `sourceSnapshotId: null` clears it, and an edit-save upsert (omitted) preserves it. (The route itself is integration-covered; unit-test the query semantics.)

- [ ] **Step 6: Run** `pnpm vitest run tests/lib/db/ tests/lib/ai/explore/` → green; `pnpm tsc --noEmit` clean.
- [ ] **Step 7: Commit** — `git add -u lib/db/capture-snapshots-queries.ts lib/ai/explore/adopt.ts 'app/api/capture/[code]/scores/route.ts' tests/lib/db/source-snapshot-id.test.ts && git commit -m "feat(capture): stamp source_snapshot_id on fork; clear on re-score, preserve on edit"`

---

## Task 3: Pure `diffInputsVsSnapshot`

**Files:** Create `lib/capture/inputs-drift.ts`; Modify `app/api/capture/[code]/snapshots/route.ts` (freeze canvas timestamp); Test `tests/lib/capture/inputs-drift.test.ts`.

> **Data-source fix (do this first):** the snapshot route currently hardcodes `scanPasses.canvasImportedAt: null` (`app/api/capture/[code]/snapshots/route.ts` ~line 99, comment "not currently tracked"). So no existing snapshot froze the canvas timestamp. **Field names verified:** the same route maps live materials with `m.extractionStatus`/`m.sizeBytes`/`m.ignored`, so those names on `CourseMaterialRow` are correct for `describe()`.

- [ ] **Step 0: Freeze the canvas timestamp on new snapshots.** In `app/api/capture/[code]/snapshots/route.ts`, change the `scanPasses` block to:
```typescript
    scanPasses: {
      canvasImportedAt: course.canvasImportedAt ? course.canvasImportedAt.toISOString() : null,
      googleDocsScannedAt: null, // no live per-course docs-scan timestamp exists to freeze
    },
```
(`course` is already in scope from `getCourseByCode`.) Legacy snapshots keep their frozen `null` → the diff treats null as "unknown, no canvas-drift claim" (Step 3), so no false positives.

- [ ] **Step 1: Write the failing test** `tests/lib/capture/inputs-drift.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { diffInputsVsSnapshot } from '@/lib/capture/inputs-drift';

const mat = (id: string, over: Record<string, unknown> = {}) => ({
  id, fileName: `${id}.pdf`, extractionStatus: 'ready', sizeBytes: 100, ignored: false, retiredAt: null, ...over,
}) as never;
const inputsMat = (id: string, over: Record<string, unknown> = {}) => ({
  id, fileName: `${id}.pdf`, extractionStatus: 'ready', sizeBytes: 100, ignored: false, ...over,
});
const meta = (materials: unknown[], scan = { canvasImportedAt: 'C1', googleDocsScannedAt: 'D1' }) =>
  ({ materials, scanPasses: scan } as never);
const course = (over: Record<string, unknown> = {}) => ({ canvasImportedAt: 'C1', ...over }) as never;

describe('diffInputsVsSnapshot', () => {
  it('reports added / removed / changed and no false drift on identical', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a'), inputsMat('b')]), [mat('a'), mat('b')], course());
    expect(d.available).toBe(true);
    expect(d.added).toHaveLength(0); expect(d.removed).toHaveLength(0); expect(d.changed).toHaveLength(0);
  });
  it('added = present now, absent in snapshot', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a')]), [mat('a'), mat('b')], course());
    expect(d.added.map(m => m.id)).toEqual(['b']);
  });
  it('removed = in snapshot, gone now (or retired)', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a'), inputsMat('b')]), [mat('a')], course());
    expect(d.removed.map(m => m.id)).toEqual(['b']);
  });
  it('changed = same id, status/size/ignored delta', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a', { sizeBytes: 100 })]), [mat('a', { sizeBytes: 250 })], course());
    expect(d.changed.map(c => c.id)).toEqual(['a']);
  });
  it('canvasChanged when the snapshot froze a canvas timestamp that differs now', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a')], { canvasImportedAt: 'C1', googleDocsScannedAt: 'D1' }), [mat('a')], course({ canvasImportedAt: 'C2' }));
    expect(d.canvasChanged).toBe(true);
  });
  it('does NOT claim canvas drift when the snapshot froze null (legacy/unknown)', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a')], { canvasImportedAt: null, googleDocsScannedAt: null }), [mat('a')], course({ canvasImportedAt: 'C9' }));
    expect(d.canvasChanged).toBe(false);
  });
  it('available=false for a legacy snapshot with no frozen materials', () => {
    const d = diffInputsVsSnapshot(meta([]), [mat('a')], course());
    expect(d.available).toBe(false);
  });
  it('treats a retired current material as removed', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a')]), [mat('a', { retiredAt: new Date() })], course());
    expect(d.removed.map(m => m.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `lib/capture/inputs-drift.ts`:**
```typescript
import type { InputsMeta } from '@/lib/db/capture-snapshots-queries';
import type { CourseMaterialRow } from '@/lib/db/course-materials-queries';

export interface MaterialRef { id: string; fileName: string; }
export interface MaterialChange { id: string; fileName: string; was: string; now: string; }
export interface InputsDrift {
  available: boolean;            // false when the snapshot froze no materials list (legacy)
  added: MaterialRef[];
  removed: MaterialRef[];
  changed: MaterialChange[];
  canvasChanged: boolean;
  docsChanged: boolean;
  hasDrift: boolean;             // convenience: any of the above non-empty/true
}

/** Live material is "present" only if not retired. */
function isLive(m: CourseMaterialRow): boolean {
  return (m as { retiredAt?: Date | null }).retiredAt == null;
}
function describe(m: { extractionStatus?: string | null; sizeBytes?: number | null; ignored?: boolean }): string {
  return `${m.extractionStatus ?? '?'}·${m.sizeBytes ?? 0}·${m.ignored ? 'ignored' : 'active'}`;
}

export function diffInputsVsSnapshot(
  inputsMeta: InputsMeta,
  currentMaterials: CourseMaterialRow[],
  course: { canvasImportedAt: string | Date | null },
): InputsDrift {
  const frozen = inputsMeta?.materials ?? [];
  // Only claim canvas drift when the snapshot actually FROZE a timestamp (non-null).
  // Legacy snapshots froze null → unknown → no false "changed". New snapshots (Step 0) freeze it.
  const frozenCanvas = inputsMeta?.scanPasses?.canvasImportedAt ?? null;
  const canvasChanged = frozenCanvas != null && String(frozenCanvas) !== String(course?.canvasImportedAt ?? '');
  const docsChanged = false; // no live per-course googleDocsScannedAt to compare; reserved. See note.

  if (frozen.length === 0) {
    return { available: false, added: [], removed: [], changed: [], canvasChanged, docsChanged, hasDrift: canvasChanged };
  }
  const liveById = new Map(currentMaterials.filter(isLive).map(m => [m.id, m]));
  const frozenById = new Map(frozen.map(f => [f.id, f]));

  const added: MaterialRef[] = [];
  for (const m of liveById.values()) if (!frozenById.has(m.id)) added.push({ id: m.id, fileName: m.fileName });

  const removed: MaterialRef[] = [];
  const changed: MaterialChange[] = [];
  for (const f of frozen) {
    const live = liveById.get(f.id);
    if (!live) { removed.push({ id: f.id, fileName: f.fileName }); continue; }
    const was = describe(f);
    const now = describe(live);
    if (was !== now) changed.push({ id: f.id, fileName: f.fileName, was, now });
  }
  const hasDrift = added.length > 0 || removed.length > 0 || changed.length > 0 || canvasChanged;
  return { available: true, added, removed, changed, canvasChanged, docsChanged, hasDrift };
}
```
**Note on `docsChanged`:** the snapshot freezes `scanPasses.googleDocsScannedAt` but `courses` has no equivalent live column, so a meaningful diff can't be computed today — leave `docsChanged: false` (reserved), documented here. (If a live docs-scan timestamp is added later, wire it then.)

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add lib/capture/inputs-drift.ts 'app/api/capture/[code]/snapshots/route.ts' tests/lib/capture/inputs-drift.test.ts && git commit -m "feat(capture): diffInputsVsSnapshot + freeze canvas timestamp on snapshot"`

---

## Task 4: Draft-status strip on the capture page

**Files:** Create `app/capture/[code]/DraftStatusStrip.tsx`; Modify the capture page/client to mount it (`app/capture/[code]/CaptureClient.tsx` or `page.tsx` — whichever owns the review surface header); Test `tests/app/capture/draft-status-strip.test.tsx`.

- [ ] **Step 1: Identify the mount + available props.** Read `app/capture/[code]/CaptureClient.tsx` + `page.tsx`. The strip needs: `reviewerStatus` (from the draft row), `lastSnapshotAt: string | null` (latest non-retired snapshot's `createdAt` — already fetched for the page, or fetch via `getLatestSnapshotByCourse`), and `forkedFrom: { caption: string | null; createdAt: string } | null` (resolve from the draft's `sourceSnapshotId` via `getSnapshotById`, server-side). Prop-drill from the server page.

- [ ] **Step 2: Write the failing test** `tests/app/capture/draft-status-strip.test.tsx` — render with `reviewerStatus="edited"`, `lastSnapshotAt` a date, `forkedFrom={{caption:'baseline', createdAt:...}}`; assert (scoped with `within` on a `data-testid="draft-status-strip"`) the strip shows "Working draft", "edited", a snapshot date, and "forked from" + "baseline". Add a second case: `forkedFrom={null}` → no "forked from" text. **Use `within(getByTestId(...))` scoped queries — do NOT rely on ambiguous `getByText(/substring/)`.**

- [ ] **Step 3: Implement `DraftStatusStrip.tsx`** — a small `'use client'` (or server) component rendering a muted strip:
```tsx
// props: { reviewerStatus: string; lastSnapshotAt: string | null; forkedFrom: { caption: string | null; createdAt: string } | null }
// <div data-testid="draft-status-strip" className="...muted strip...">
//   Working draft · {reviewerStatus} · last snapshot {lastSnapshotAt ? formatDate : 'never'}
//   {forkedFrom && <> · forked from “{forkedFrom.caption ?? formatDate(forkedFrom.createdAt)}”</>}
// Visible text nodes (not title/aria). Reuse a formatDate helper.
```
Mount it near the top of the review surface.

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean; existing capture tests still green (`pnpm vitest run tests/app/capture/`).
- [ ] **Step 5: Commit** — `git add 'app/capture/[code]/DraftStatusStrip.tsx' <the-mount-file> tests/app/capture/draft-status-strip.test.tsx && git commit -m "feat(capture): working-draft status strip (status · last snapshot · forked-from)"`

---

## Task 5: Inputs-drift banner

**Files:** Create `app/capture/[code]/InputsDriftBanner.tsx`; server-compose the drift in the capture page (draft.sourceSnapshotId → snapshot.inputsMeta vs live materials); Test `tests/app/capture/inputs-drift-banner.test.tsx`.

- [ ] **Step 1: Server-compose the drift.** In the capture server page, when `draft?.sourceSnapshotId` is set: `const snap = await getSnapshotById(draft.sourceSnapshotId); const materials = await listMaterialsByCourse(courseCode); const drift = snap ? diffInputsVsSnapshot(snap.inputsMeta, materials, course) : null;` Pass `drift` (an `InputsDrift | null`) to the client. When `sourceSnapshotId` is null, pass `null` (no banner).

- [ ] **Step 2: Write the failing test** `tests/app/capture/inputs-drift-banner.test.tsx`:
  - drift with `hasDrift:true, available:true` + added/removed/changed → banner renders "Materials have changed", and the roll-down (scoped via `data-testid="inputs-drift-banner"`) lists the added/removed/changed fileNames.
  - drift `null` → nothing renders (`queryByTestId` null).
  - drift with `hasDrift:false` → nothing renders.
  - drift with `available:false` → renders the "inputs record unavailable for this snapshot" note, not a false "everything removed."
  **Scope all assertions with `within(getByTestId('inputs-drift-banner'))`.**

- [ ] **Step 3: Implement `InputsDriftBanner.tsx`** — props `{ drift: InputsDrift | null }`. Returns `null` when `drift` is null or `!drift.hasDrift && drift.available`. When `available:false` → a small amber note. Otherwise an amber banner "Materials have changed since the snapshot this draft was forked from" + a `<details>` roll-down listing Added / Removed / Changed (fileName + was→now) / Canvas re-imported. Visible text; `data-testid="inputs-drift-banner"`.

- [ ] **Step 4: Mount** below the `DraftStatusStrip` on the capture surface.
- [ ] **Step 5: Run, verify PASS**; `pnpm tsc --noEmit` clean; `pnpm vitest run tests/app/capture/` green.
- [ ] **Step 6: Commit** — `git add 'app/capture/[code]/InputsDriftBanner.tsx' <mount-file> tests/app/capture/inputs-drift-banner.test.tsx && git commit -m "feat(capture): inputs-drift banner when a forked draft's materials have changed"`

---

## Task 6: Adopt confirm-dialog names what it replaces

**Files:** Modify `components/AskTab.tsx` (`handleAdopt`); Test — extend `tests/components/ask-tab-scenario.test.tsx` if it can assert the confirm message, else a source assertion.

- [ ] **Step 1: Update the confirm copy** in `AskTab.handleAdopt` (currently generic). Replace the `window.confirm(...)` message with one that names the target + the replace:
```
`Adopt this scenario as ${courseCode}'s next planned version? This replaces your current working draft (snapshots are not affected).`
```
(Keep it a single `window.confirm`; `courseCode` is in scope and already guarded non-empty at the top of `handleAdopt`.)

- [ ] **Step 2: Test.** If `tests/components/ask-tab-scenario.test.tsx` can spy `window.confirm`, add a case: clicking Adopt calls `window.confirm` with a message containing the course code + "replaces your current working draft". Otherwise add a source-text assertion in a small test that the string is present. Keep it minimal.

- [ ] **Step 3: Run** `pnpm vitest run tests/components/` → green; `pnpm tsc --noEmit` clean.
- [ ] **Step 4: Commit** — `git add components/AskTab.tsx tests/components/ask-tab-scenario.test.tsx && git commit -m "feat(explore): adopt confirm names the draft it replaces"`

---

## Task 7: `/courses` row verbs + N-versions count

**Files:** Modify `app/courses/CoursesIndex.tsx`; add a snapshot-count query (`lib/db/capture-status-queries.ts` or a new `lib/db/capture-snapshots-queries.ts` helper) + wire it in `app/courses/page.tsx`; Test `tests/app/courses/course-row-verbs.test.tsx`.

- [ ] **Step 1: Snapshot count per course.** Add `countSnapshotsByCourse(): Promise<Map<string, number>>` (non-retired counts, grouped) in `lib/db/capture-snapshots-queries.ts` (Drizzle `count()` group-by `course_code`, `retired_at IS NULL`). Fetch it in `app/courses/page.tsx` and pass a `snapshotCountByCode: Map<string, number>` into `CoursesIndex` → `CourseRow` (mirror how `dataStateByCode` is threaded).

- [ ] **Step 2: Write the failing test** `tests/app/courses/course-row-verbs.test.tsx` — render `CourseRow` (export it or test via `CoursesIndex`) for:
  - a `captured` row with 3 snapshots → shows **Edit Course** (row link → `/capture`), **View Course** (→ `/view/<code>`), **Explore Changes** (→ `/explore/<code>`), and **3 versions**.
  - a `not-started` row with 0 snapshots → shows **Capture Course**, **Explore Changes**; NO **View Course**, NO versions.
  **Scope with `within` on a per-row testid; assert on `href` attributes + visible labels.**

- [ ] **Step 3: Implement the verbs in `CourseRow`.**
  - Primary label from status: `const isStarted = row.status !== 'not-started'; const primaryLabel = isStarted ? 'Edit Course' : 'Capture Course';` (row-click stays `captureHref`). Render the label as visible text in/next to the row link.
  - **View Course** → `/view/${encodeURIComponent(row.code)}` — render only when `isStarted`.
  - **Explore Changes** → replace the current "💬 Ask" link label/text with "Explore Changes" (keep `askHref` → `/explore/[code]?tab=ask`, or drop `&tab=ask` if the thinking-partner should open on its default surface — **default: keep `?tab=ask` for backward-compatible deep-link**).
  - **N versions** → when `snapshotCountByCode.get(row.code)` > 0, a link to `/capture/${code}?panel=history&slug=…` labeled `${n} versions`.
  - **Prereqs** — keep the existing link but demote (smaller/quieter); do not remove.

- [ ] **Step 4: History deep-link anchor.** In the capture client, read `?panel=history` and scroll/open the `SnapshotHistoryPanel` (e.g. `id="snapshot-history"` + `scrollIntoView` on mount when the param is present). Keep minimal; the panel itself is unchanged.

- [ ] **Step 5: Run** `pnpm vitest run tests/app/courses/ tests/app/capture/` → green; `pnpm tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `git add 'app/courses/CoursesIndex.tsx' app/courses/page.tsx lib/db/capture-snapshots-queries.ts 'app/capture/[code]/CaptureClient.tsx' tests/app/courses/course-row-verbs.test.tsx && git commit -m "feat(courses): row verbs — Capture/Edit Course · View Course · Explore Changes · N versions"`

---

## Task 8: STATE.md + full suite + deploy

**Files:** Modify `docs/STATE.md`.

- [ ] **Step 1: Full suite + typecheck** — `pnpm vitest run` (all green), `pnpm tsc --noEmit` (clean).

- [ ] **Step 2: Update STATE.md** — under Active arc / What's-live: draft/snapshot clarity SHIPPED — `source_snapshot_id` column (applied via direct SQL, migration `0048` generated-not-migrated per the #207 journal drift — record that); `diffInputsVsSnapshot`; the capture-page status strip + inputs-drift banner; adopt confirm-dialog naming; `/courses` row verbs (Capture/Edit Course · View Course · Explore Changes · N versions). Note the accepted v1 caveats (id-as-join-key; content-change-without-size-change; `docsChanged` reserved). Add `source_snapshot_id` to the schema notes and the new `0048` migration to the migrations list. Reconfirm #207 remains open (this plan did NOT run `db:migrate`).

- [ ] **Step 3: Commit** — `git add docs/STATE.md && git commit -m "docs(state): draft/snapshot clarity + version legibility shipped"`

- [ ] **Step 4: Deploy** (when approved) — merge `feat/draft-snapshot-clarity` → `main`, apply the `source_snapshot_id` SQL to the deploy DB if it's a different DB (it is the SAME shared local Postgres, so Step-1-Task-1 already applied it — confirm), `pnpm build` in the deploy worktree, `launchctl kickstart -k gui/501/com.gc.curriculum-tool`, health-check root 200.

---

## Notes for the implementer

- **The `source_snapshot_id` semantics are load-bearing:** set by fork (load/adopt), **cleared by a fresh AI re-score**, **preserved by edit-save**. `undefined` into `upsertCaptureProfile` = preserve; explicit `null` = clear. This keeps the adopt `intended_target` overlay (`adopted_from_scenario_id`, carried by `preserveAdoptOverlay`) alive while the drift banner correctly turns off once the draft is re-scored against current materials.
- **Do NOT run `pnpm db:migrate`** (journal drift #207 — it would re-run 0046 and fail). Apply the column with `ADD COLUMN IF NOT EXISTS` directly; the generated `0048` file is for record only.
- **Shared DB:** dev + deploy use the same local Postgres, so the Task-1 SQL applies once for both. Avoid running any adopt/load smoke against a real faculty course draft without restoring it (as was done for GC 4800 during #188).
- **Component-test discipline:** scope every assertion with `within(getByTestId(...))`; never hide content in `title`/`aria-label` to satisfy an ambiguous `getByText`.
- **Out of scope (spec):** read-only past-version rendering; content-hash change detection; duplicating the versions list on `/courses`.
```
