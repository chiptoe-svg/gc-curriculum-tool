# Capture-Surface OKF Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "↓ Markdown" download affordance to the faculty `/capture/[code]` review surface that exports the course's last-saved snapshot by linking to the already-shipped public `/view/[code]/okf` route.

**Architecture:** UI-only. No new server code — the public `/view/[code]/okf` route and `profileToOkfMarkdown` serializer (both shipped) are reused as-is. A `hasSnapshot` boolean flows from `page.tsx` (which already loads `latestSnapshot`) → `CaptureClient` → `ProfileReviewPanel`, which renders an `<a download>` link to the OKF route when a snapshot exists (or one was just captured this session).

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), React client components, Vitest + @testing-library/react.

**Branch:** `feat/capture-okf-download` (already created off `dev`; spec already committed).

**Spec:** `docs/superpowers/specs/2026-06-14-capture-surface-okf-download-design.md`

---

## File Structure

- `app/capture/[code]/ProfileReviewPanel.tsx` (modify) — owns the rendering. Adds optional `hasSnapshot?: boolean` prop, one `okfHref` constant, one `showOkfDownload` predicate, and the `<a download>` link in two places (header status row + post-snapshot success card).
- `app/capture/[code]/CaptureClient.tsx` (modify) — pure pass-through: accepts `hasSnapshot?: boolean` and forwards it to `<ProfileReviewPanel>`.
- `app/capture/[code]/page.tsx` (modify) — derives `hasSnapshot={latestSnapshot != null}` (authoritative — same query the OKF route uses) and passes it to `<CaptureClient>`.
- `tests/app/capture/profile-review-okf-download.test.tsx` (create) — RTL test asserting link presence/absence + href, mirroring the harness in `tests/app/capture/review-step2-order.test.tsx`.
- `docs/STATE.md` (modify) — flip the "capture-surface download" item from deferred to DONE.

The `hasSnapshot` prop is **optional** (`?: boolean`) in both `Props` interfaces so existing test render-helpers and callers that don't pass it still typecheck (matching the file's existing optional props `reconciliationLog?` / `priorBriefings?`); a falsy/undefined value simply hides the link.

---

### Task 1: Render the download link in ProfileReviewPanel (TDD)

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx` (Props ~line 242-260; render after `isCaptured` ~line 1096; header status row ~line 1129-1148; success-card row ~line 1183-1202)
- Test: `tests/app/capture/profile-review-okf-download.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/app/capture/profile-review-okf-download.test.tsx`. This mirrors the mocked-children harness from `review-step2-order.test.tsx` (the heavy child components must be mocked or the panel won't render in jsdom):

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({
  VerificationSummary: () => <div data-testid="verification-summary" />,
}));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({
  CourseOverview: () => <div data-testid="course-overview" />,
}));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({
  ClassStructureSection: () => <div data-testid="class-structure" />,
}));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({
  MajorProjectsSection: () => <div data-testid="major-projects" />,
}));
vi.mock('@/app/capture/[code]/StressTestPanel', () => ({
  StressTestPanel: React.forwardRef((_props: unknown, _ref: unknown) => null),
}));
vi.mock('@/app/capture/[code]/StressTestBadge', () => ({ StressTestBadge: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

function makeProfile(): CaptureProfile {
  const comp = (statement: string) => ({
    statement, type: 'technical' as const,
    k_depth: 2, u_depth: 2, d_depth: 2,
    evidence_k: 'k evidence', evidence_u: 'u evidence', evidence_d: 'd evidence',
    rationale: 'rationale', source: 'materials' as const,
    citations: [{ type: 'chunk' as const, chunkId: 'c1', messageId: null, excerpt: 'ex' }],
  });
  return {
    competencies: [comp('Color management')],
    incoming_expectations: [],
    verification_summary: {
      overall_shape: 'Balanced', strongest_evidence: 'Rubric', dimensional_patterns: 'Aligned',
      catalog_vs_evidence: 'Consistent', foundationals_at_a_glance: 'Agency present',
      source: 'materials' as const, citations: [],
    },
    audit_notes: {
      prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [],
      suggested_objective_revisions: [], source: 'inferred' as const, citations: [],
    },
    course_emphasis: [], generated_at: new Date().toISOString(), scale_version: 'v2',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}

function renderPanel(hasSnapshot?: boolean) {
  return render(
    <ProfileReviewPanel
      profile={makeProfile()}
      reviewerStatus="ai_drafted"
      initialReviewerNote={null}
      telemetry={null}
      onSave={async () => {}}
      onResumeChat={() => {}}
      courseCode="GC 3800"
      courseTitle="Junior Seminar"
      slug="test-slug"
      onSnapshotCreated={() => {}}
      hasSnapshot={hasSnapshot}
    />,
  );
}

describe('ProfileReviewPanel — OKF download link', () => {
  it('shows a "↓ Markdown" download link to the OKF route when a snapshot exists', () => {
    renderPanel(true);
    const link = screen.getByRole('link', { name: /markdown/i });
    expect(link.getAttribute('href')).toBe('http://130.127.162.180:3000/view/GC%203800/okf');
    expect(link.getAttribute('download')).not.toBeNull();
  });

  it('hides the download link when no snapshot exists', () => {
    renderPanel(false);
    expect(screen.queryByRole('link', { name: /markdown/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/app/capture/profile-review-okf-download.test.tsx`
Expected: FAIL — `hasSnapshot` is not yet a prop (TypeScript error or no link found: "Unable to find role 'link'").

- [ ] **Step 3: Add the `hasSnapshot` prop to the Props interface**

In `app/capture/[code]/ProfileReviewPanel.tsx`, add to the `Props` interface (after `reconciliationLog?: ReconciliationLogEntry[];`, ~line 259):

```tsx
  /**
   * True when a non-retired snapshot exists for this course (computed in
   * page.tsx from getLatestSnapshotByCourse — the same query the
   * /view/[code]/okf route uses, so it matches exactly when that route
   * returns 200 vs 404). Gates the "↓ Markdown" OKF download link.
   */
  hasSnapshot?: boolean;
```

Add `hasSnapshot` to the destructured params (after `reconciliationLog,` ~line 896):

```tsx
  reconciliationLog,
  hasSnapshot,
}: Props) {
```

- [ ] **Step 4: Define the href + predicate**

In the function body, immediately after the `isCaptured` definition (`const isCaptured = lastSavedStatus === 'confirmed';`, ~line 1096), add:

```tsx
  // Portable OKF markdown of the last-saved snapshot. Absolute LAN origin
  // matches this file's other /view links (so the downloaded file is the
  // public LAN projection). The route sets Content-Disposition: attachment,
  // so it downloads even cross-origin where the `download` attr is ignored.
  const okfHref = `http://130.127.162.180:3000/view/${encodeURIComponent(courseCode)}/okf`;
  // hasSnapshot: a snapshot existed at page load. snapshotMessage ok: one was
  // just captured this session (exists now even though it didn't at load).
  const showOkfDownload = Boolean(hasSnapshot) || snapshotMessage?.kind === 'ok';
```

- [ ] **Step 5: Render the link in the header status row**

In the header `flex shrink-0 items-center gap-2` cluster, after the "← Back to the interview" `<button>` closing tag (~line 1147, before the `</div>` at line 1148), add:

```tsx
            {showOkfDownload && (
              <a
                href={okfHref}
                download
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                title="Download this course's saved profile as portable Markdown (OKF)"
              >
                ↓ Markdown
              </a>
            )}
```

- [ ] **Step 6: Render the link in the post-snapshot success card**

In the success-card action row (`<div className="mt-3 flex flex-wrap items-center gap-3 text-xs">`, ~line 1183), after the "View the public profile →" `<a>` closing tag (~line 1189), add (this card only renders when `snapshotMessage?.kind === 'ok'`, so no extra guard needed):

```tsx
            <a
              href={okfHref}
              download
              className="rounded-md border border-green-700 bg-white px-3 py-1.5 font-medium text-green-900 hover:bg-green-100 dark:bg-transparent dark:text-green-200"
            >
              ↓ Download Markdown
            </a>
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/app/capture/profile-review-okf-download.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add app/capture/[code]/ProfileReviewPanel.tsx tests/app/capture/profile-review-okf-download.test.tsx
git commit -m "feat(capture): OKF '↓ Markdown' download on the review surface

Links the faculty /capture review surface to the public /view/<code>/okf
route to download the last-saved snapshot's portable OKF markdown. Shown
when a snapshot exists (hasSnapshot) or one was just captured this session.
Two placements: persistent header status row + post-snapshot success card.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Thread `hasSnapshot` through CaptureClient

**Files:**
- Modify: `app/capture/[code]/CaptureClient.tsx` (Props ~line 19-36; destructure ~line 49-63; `<ProfileReviewPanel>` ~line 469-481)

- [ ] **Step 1: Add `hasSnapshot` to CaptureClient's Props**

In `app/capture/[code]/CaptureClient.tsx`, add to the `Props` interface (after `catalogSyncedAt: string | null;`, ~line 35):

```tsx
  /** True when a non-retired snapshot exists — gates the OKF download link on the review panel. */
  hasSnapshot?: boolean;
```

- [ ] **Step 2: Destructure it**

Add `hasSnapshot,` to the destructured params (after `catalogSyncedAt,`, ~line 62):

```tsx
  catalogSyncedAt,
  hasSnapshot,
}: Props) {
```

- [ ] **Step 3: Forward it to ProfileReviewPanel**

In the `<ProfileReviewPanel … />` usage (~line 469-481), add the prop after `reconciliationLog={reconciliationLog}`:

```tsx
            reconciliationLog={reconciliationLog}
            hasSnapshot={hasSnapshot}
          />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add app/capture/[code]/CaptureClient.tsx
git commit -m "feat(capture): thread hasSnapshot through CaptureClient to the review panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the page + update STATE.md

**Files:**
- Modify: `app/capture/[code]/page.tsx` (`<CaptureClient … />` ~line 162-176; `latestSnapshot` is already loaded ~line 47)
- Modify: `docs/STATE.md` (line ~390 — the OKF deferred entry)

- [ ] **Step 1: Pass `hasSnapshot` from the page**

In `app/capture/[code]/page.tsx`, in the `<CaptureClient … />` usage, add after `priorSnapshotInfo={priorSnapshotInfo}`:

```tsx
          priorSnapshotInfo={priorSnapshotInfo}
          hasSnapshot={latestSnapshot != null}
```

(`latestSnapshot` is already destructured from the `Promise.all` at the top of the component — no new query.)

- [ ] **Step 2: Typecheck + run the capture test suite**

Run: `pnpm exec tsc --noEmit && pnpm vitest run tests/app/capture/`
Expected: PASS — no type errors; all capture tests green (including the new OKF download test).

- [ ] **Step 3: Update STATE.md — flip the deferred item to DONE**

In `docs/STATE.md`, find the OKF deferred entry (the long line ending with the "STILL deferred" list, ~line 390). Replace this fragment:

```
STILL deferred: whole-curriculum **bundle zip** (all courses' .md + index.md, reuses the serializer); a **capture-surface download** (would reflect the latest snapshot, not the in-progress draft); the broader **wiki-frontmatter OKF-v0.1 alignment**; and the **`/wiki/graph`** view.
```

with:

```
**Capture-surface OKF download — DONE 2026-06-14** (`feat/capture-okf-download`): the faculty `/capture/<code>` review surface now has a "↓ Markdown" link to `/view/<code>/okf` (last-saved snapshot), shown when a snapshot exists or was just captured; UI-only, reuses the shipped route + serializer. Spec [`2026-06-14-capture-surface-okf-download-design.md`](./superpowers/specs/2026-06-14-capture-surface-okf-download-design.md). STILL deferred: whole-curriculum **bundle zip** (all courses' .md + index.md, reuses the serializer); the broader **wiki-frontmatter OKF-v0.1 alignment** (Increment #2 — its own brainstorm→spec→plan); and the **`/wiki/graph`** view.
```

- [ ] **Step 4: Commit**

```bash
git add app/capture/[code]/page.tsx docs/STATE.md
git commit -m "feat(capture): pass hasSnapshot from capture page; mark OKF capture-download DONE

Wires hasSnapshot={latestSnapshot != null} from /capture/[code]/page.tsx
(no new query) and flips the capture-surface-download deferred item to DONE
in STATE.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Full suite green:** `pnpm test` — expect all tests pass (632+ including the 2 new).
- [ ] **Build sanity:** `pnpm exec tsc --noEmit` — no type errors.
- [ ] Manual (deploy-time): on `/capture/<code>?slug=…` for a captured course, the header shows "↓ Markdown"; clicking downloads `<slug>.md`. For an un-captured course, no link until after "Approve & capture", at which point both the header link and the success-card link appear.

## Self-Review notes (author)
- **Spec coverage:** page→client→panel threading (Components 1–3) → Tasks 3/2/1; `okfHref` absolute-LAN convention → Task 1 Step 4; OR predicate → Task 1 Step 4; two placements → Task 1 Steps 5–6; `download`-attr note → comment in Step 4; testing → Task 1 + Final. ✓
- **No placeholders:** all steps carry exact code/commands. ✓
- **Type consistency:** `hasSnapshot?: boolean` identical in both Props interfaces; `okfHref`/`showOkfDownload` referenced consistently; test passes `hasSnapshot` matching the new optional prop. ✓
