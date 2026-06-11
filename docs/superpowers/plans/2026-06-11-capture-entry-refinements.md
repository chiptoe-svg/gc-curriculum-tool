# CourseCapture Entry Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim the capture header, and enrich Step 1 with the GC-curriculum-sheet catalog source (+ re-sync), honest+actionable material readability (+ Index now), and Canvas-list unroll.

**Architecture:** Mostly additive UI on the existing Step-1 component + the capture page header. Pure helpers carry decisions; a small shared materials-fetch helper is extracted so "Index now" can refresh status. Reuses existing endpoints (`sync-from-sheet`, `v2-backfill`, `/capture/[code]/context`).

**Tech Stack:** Next.js 15 client components, TypeScript strict (`noUncheckedIndexedAccess`), Vitest + `@testing-library/react` (jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-11-capture-entry-refinements-design.md`

---

## Background the implementer must know

- The Step-1 component is `app/capture/[code]/CaptureMaterialsStep.tsx` (already live). It imports helpers from `lib/capture/material-display.ts` and reuses `MaterialsPanel`/`IndexingStatusDot` from `./MaterialsPanel`.
- Provenance is filename-prefix based (`materialProvenance`). `CaptureMaterial` has `indexingStatus`, `extractedText`, `ignored`, `autoSetAside`, `setAsideReason`, `ignoredItems`, `indexedAt`.
- `@/lib/canvas/parseCanvasBlob` exports `parseCanvasBlob(text): CanvasItem[]` (`{title, body}`) and `isCanvasListMaterial(fileName): boolean`.
- `POST /api/courses/[code]/sync-from-sheet?slug=` returns `{ course: { code,title,description,prerequisites,learningObjectives,majorProjects,skillsRequired,lastSyncedAt } }`; 404 if the course has no sheet tab.
- `POST /api/admin/v2-backfill?slug=` `{courseCode, slug}` re-indexes the course's materials. The capture page is already behind the same Basic Auth this route requires; `checkAdminAuth` accepts the slug.
- `MaterialsPanel.refetchMaterialsFromContext` (around line 738) fetches `GET /api/capture/[code]/context?slug=` and maps the JSON to `CaptureMaterial[]`. Task 2 extracts that fetch+map into a shared helper.
- Run one test: `pnpm vitest run <path>`. Typecheck: `pnpm exec tsc --noEmit`. Component test precedent: `components/__tests__/CourseDetails.test.tsx`.

---

### Task 1: Step-1 decision/display helpers

**Files:** Modify `lib/capture/material-display.ts`; Modify `lib/capture/__tests__/material-display.test.ts`.

- [ ] **Step 1: Append failing tests** to `lib/capture/__tests__/material-display.test.ts`:

```ts
import {
  catalogContributionSummary, materialReadability, relativeTimeFromNow, hasFixablyUnindexed,
} from '@/lib/capture/material-display';

describe('catalogContributionSummary', () => {
  it('lists only non-empty fields', () => {
    expect(catalogContributionSummary({ description: 'd', learningObjectives: ['a','b'], prerequisites: '', majorProjects: ['p'], skillsRequired: [] }))
      .toBe('description · 2 learning objectives · 1 major project');
  });
  it('falls back when everything is empty', () => {
    expect(catalogContributionSummary({ description: '', learningObjectives: [], prerequisites: '', majorProjects: [], skillsRequired: [] }))
      .toBe('no catalog details synced yet');
  });
});

describe('materialReadability', () => {
  it('marks ready readable', () => {
    expect(materialReadability({ indexingStatus: 'ready' })).toEqual({ readable: true, label: 'ready' });
  });
  it('marks pending not-readable', () => {
    expect(materialReadability({ indexingStatus: 'pending' })).toMatchObject({ readable: false, label: 'not indexed yet' });
  });
  it('explains skipped with a reason', () => {
    expect(materialReadability({ indexingStatus: 'skipped', setAsideReason: null }).reason).toMatch(/no extractable content/i);
    expect(materialReadability({ indexingStatus: 'skipped', setAsideReason: 'not shared' }).reason).toBe('not shared');
  });
  it('explains failed', () => {
    expect(materialReadability({ indexingStatus: 'failed' })).toMatchObject({ readable: false, reason: 'extraction failed' });
  });
});

describe('relativeTimeFromNow', () => {
  const now = 1_000_000_000_000;
  it('handles null + recency', () => {
    expect(relativeTimeFromNow(null, now)).toBe('not synced yet');
    expect(relativeTimeFromNow(new Date(now - 30_000).toISOString(), now)).toBe('just now');
    expect(relativeTimeFromNow(new Date(now - 5*60_000).toISOString(), now)).toBe('5m ago');
    expect(relativeTimeFromNow(new Date(now - 3*3_600_000).toISOString(), now)).toBe('3h ago');
    expect(relativeTimeFromNow(new Date(now - 2*86_400_000).toISOString(), now)).toBe('2d ago');
  });
});

describe('hasFixablyUnindexed', () => {
  it('true when a non-ignored pending/failed exists', () => {
    expect(hasFixablyUnindexed([{ indexingStatus: 'ready' }, { indexingStatus: 'pending' }])).toBe(true);
    expect(hasFixablyUnindexed([{ indexingStatus: 'pending', ignored: true }])).toBe(false);
    expect(hasFixablyUnindexed([{ indexingStatus: 'skipped' }, { indexingStatus: 'ready' }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run lib/capture/__tests__/material-display.test.ts` → FAIL (new exports missing).

- [ ] **Step 3: Append to `lib/capture/material-display.ts`:**

```ts
export interface CatalogCourseFields {
  description?: string;
  prerequisites?: string;
  learningObjectives?: string[];
  majorProjects?: string[];
  skillsRequired?: string[];
}

/** One-line summary of the catalog fields the auditor reads (non-empty only). */
export function catalogContributionSummary(c: CatalogCourseFields): string {
  const parts: string[] = [];
  if (c.description && c.description.trim()) parts.push('description');
  const lo = c.learningObjectives?.length ?? 0;
  if (lo) parts.push(`${lo} learning objective${lo === 1 ? '' : 's'}`);
  if (c.prerequisites && c.prerequisites.trim()) parts.push('prerequisites');
  const mp = c.majorProjects?.length ?? 0;
  if (mp) parts.push(`${mp} major project${mp === 1 ? '' : 's'}`);
  const sk = c.skillsRequired?.length ?? 0;
  if (sk) parts.push(`${sk} skill${sk === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'no catalog details synced yet';
}

export interface Readability { readable: boolean; label: string; reason?: string; }

/** Whether the auditor can actually read a material, plus a human label + reason. */
export function materialReadability(m: { indexingStatus: string; setAsideReason?: string | null }): Readability {
  switch (m.indexingStatus) {
    case 'ready': return { readable: true, label: 'ready' };
    case 'indexing': return { readable: false, label: 'indexing…' };
    case 'pending': return { readable: false, label: 'not indexed yet' };
    case 'failed': return { readable: false, label: "couldn't be read", reason: 'extraction failed' };
    case 'skipped': return { readable: false, label: 'not readable', reason: m.setAsideReason?.trim() || 'no extractable content (e.g. unshared doc / no captions)' };
    default: return { readable: false, label: 'not indexed yet' };
  }
}

/** Relative time string; `now` is passed in for testability. */
export function relativeTimeFromNow(iso: string | null, now: number): string {
  if (!iso) return 'not synced yet';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'not synced yet';
  const min = Math.floor((now - then) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** True if any non-ignored material is pending/failed (re-indexing could help). */
export function hasFixablyUnindexed(materials: { indexingStatus: string; ignored?: boolean }[]): boolean {
  return materials.some((m) => !m.ignored && (m.indexingStatus === 'pending' || m.indexingStatus === 'failed'));
}
```

- [ ] **Step 4: Run** the test → PASS. **Step 5: Commit** `git add lib/capture/material-display.ts lib/capture/__tests__/material-display.test.ts && git commit -m "feat(capture): catalog/readability/relative-time step helpers"`.

---

### Task 2: Extract shared `fetchCourseMaterials` helper

**Files:** Create `lib/capture/fetch-course-materials.ts`; Modify `app/capture/[code]/MaterialsPanel.tsx` (`refetchMaterialsFromContext`).

- [ ] **Step 1: Read** `MaterialsPanel.tsx` around `refetchMaterialsFromContext` (~line 738–776) to capture the exact fetch URL + JSON→`CaptureMaterial` mapping.

- [ ] **Step 2: Create `lib/capture/fetch-course-materials.ts`** that performs that same `GET /api/capture/[code]/context?slug=` fetch and returns the mapped `CaptureMaterial[]`, or `null` on non-OK/throw:

```ts
import type { CaptureMaterial } from '@/app/capture/[code]/MaterialsPanel';

/**
 * Fetch the course's materials (as the capture context endpoint returns them)
 * and map to CaptureMaterial[]. Returns null on failure. Shared by MaterialsPanel
 * and CaptureMaterialsStep so the row shape stays in one place.
 */
export async function fetchCourseMaterials(courseCode: string, slug: string): Promise<CaptureMaterial[] | null> {
  try {
    const res = await fetch(
      `/api/capture/${encodeURIComponent(courseCode)}/context?slug=${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const json = await res.json();
    // MOVE THE EXACT MAPPING from MaterialsPanel.refetchMaterialsFromContext here,
    // returning CaptureMaterial[]. Keep field-for-field parity.
    return mapContextToMaterials(json);
  } catch {
    return null;
  }
}
```
Implement `mapContextToMaterials` with the **exact** mapping lifted from `refetchMaterialsFromContext` (same fields, same defaults). Do not change behavior.

- [ ] **Step 3: Rewire `MaterialsPanel.refetchMaterialsFromContext`** to call `fetchCourseMaterials(course.code, slug)` and, on a non-null result, push it through its existing `pushMaterials`/state update (preserve current behavior on null — i.e. no-op as before).

- [ ] **Step 4: Verify** `pnpm exec tsc --noEmit` clean for both files; `pnpm vitest run lib/capture` green; if MaterialsPanel has tests, run them. **Step 5: Commit** `git add lib/capture/fetch-course-materials.ts "app/capture/[code]/MaterialsPanel.tsx" && git commit -m "refactor(capture): extract shared fetchCourseMaterials"`.

---

### Task 3: Trim the capture header

**Files:** Modify `app/capture/[code]/page.tsx` (header block ~line 116–164).

- [ ] **Step 1:** Read the header block. Change the left label `CourseCapture · v1` → `CourseCapture` (the `<p class="text-xs uppercase …">CourseCapture · v1</p>` becomes `>CourseCapture<`). Keep the `{course.code} — {course.title}` `<h1>`.

- [ ] **Step 2:** In the right-side `<div className="flex items-center gap-4">`, replace the five links so it contains exactly, in order: a **Course List** `Link`, the existing **Guide ↗** `<a>`, and `<FeedbackLink />`. Remove the `Program`, `Settings`, `💬 Ask`, and `Explore →` links.

```tsx
          <div className="flex items-center gap-4">
            <Link
              href={`/courses?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
              title="Back to the course list"
            >
              Course List
            </Link>
            <a
              href="https://chiptoe-svg.github.io/gc-curriculum-tool/docs/using-coursecapture-and-explore.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground"
              title="How-to guide for CourseCapture & Explore (opens in new tab)"
            >
              Guide ↗
            </a>
            <FeedbackLink />
          </div>
```

- [ ] **Step 3:** `pnpm exec tsc --noEmit` clean for page.tsx (remove the now-unused `Link` import only if nothing else uses it — `Link` is still used by Course List, so keep it). **Step 4: Commit** `git add "app/capture/[code]/page.tsx" && git commit -m "feat(capture): trim header to Course List / Guide / Feedback"`.

---

### Task 4: Thread `catalogSyncedAt` to the step

**Files:** Modify `app/capture/[code]/page.tsx`; Modify `app/capture/[code]/CaptureClient.tsx`.

- [ ] **Step 1:** In `page.tsx`, where `<CaptureClient .../>` is rendered (it already passes `course={courseView}`), add `catalogSyncedAt={course.lastSyncedAt ? course.lastSyncedAt.toISOString() : null}` (the full `course` row from `getCourseByCode` has `lastSyncedAt: Date`).

- [ ] **Step 2:** In `CaptureClient.tsx`, add `catalogSyncedAt: string | null;` to its `Props` interface, destructure it in the component signature, and pass `catalogSyncedAt={catalogSyncedAt}` into `<CaptureMaterialsStep .../>` (the call added in the prior feature).

- [ ] **Step 3:** `pnpm exec tsc --noEmit` — it will error until Task 5 adds the prop to `CaptureMaterialsStep`; that's expected. Instead verify by reading that the prop is passed correctly, and let Task 5's typecheck confirm. **Do not commit yet** — commit together with Task 5 (they're interdependent), OR commit now and accept a transient type error only if you immediately proceed to Task 5. Prefer: stage these edits and commit at the end of Task 5.

---

### Task 5: Rebuild `CaptureMaterialsStep` (catalog row, readability, Index now, Canvas unroll)

**Files:** Modify `app/capture/[code]/CaptureMaterialsStep.tsx`; Modify `app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx`.

- [ ] **Step 1: Replace the test file** with this (mocks `MaterialsPanel`, `fetchCourseMaterials`, and global `fetch`; uses the real `parseCanvasBlob`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({
  MaterialsPanel: () => <div data-testid="materials-panel-detail">detail</div>,
  IndexingStatusDot: () => <span data-testid="dot" />,
}));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CaptureMaterialsStep } from '@/app/capture/[code]/CaptureMaterialsStep';

const course = { code: 'GC 3800', title: 'Junior Seminar', description: 'A course', prerequisites: '', learningObjectives: ['x','y'], majorProjects: [], skillsRequired: [], auditMode: 'full' } as unknown as CourseCatalogView;
function mat(o: Partial<CaptureMaterial>): CaptureMaterial {
  return { id:o.id??'m', fileName:o.fileName??'f.pdf', mimeType:'application/pdf', sizeBytes:1, pageCount:null, extractionStatus:'ok', extractionMethod:null, extractedText:o.extractedText??'x', ignored:o.ignored??false, digest:null, digestGeneratedAt:null, useDigest:false, indexingStatus:o.indexingStatus??'ready', indexedAt:null, ferpaRisk:'ok' as never, autoSetAside:false, setAsideReason:o.setAsideReason??null, blobUrl:'', ignoredItems:o.ignoredItems, ...o } as CaptureMaterial;
}
const noop = () => {};
beforeEach(() => { vi.restoreAllMocks(); });

describe('CaptureMaterialsStep v2', () => {
  it('shows the GC curriculum sheet catalog row with a contribution summary', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByText('GC curriculum catalog')).toBeTruthy();
    expect(screen.getByText('GC curriculum sheet')).toBeTruthy();
    expect(screen.getByText(/description · 2 learning objectives/)).toBeTruthy();
  });

  it('Re-sync POSTs sync-from-sheet and updates the course', async () => {
    const onCourseChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ course: { description: 'new', learningObjectives: ['a'], prerequisites: '', majorProjects: [], skillsRequired: [], lastSyncedAt: new Date().toISOString() } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={onCourseChange} onContinue={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /re-sync/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain('/sync-from-sheet');
    await waitFor(() => expect(onCourseChange).toHaveBeenCalled());
  });

  it('marks a pending material not-readable and shows Index now', async () => {
    const onMaterialsChange = vi.fn();
    const { fetchCourseMaterials } = await import('@/lib/capture/fetch-course-materials');
    (fetchCourseMaterials as ReturnType<typeof vi.fn>).mockResolvedValue([mat({ indexingStatus: 'ready' })]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CaptureMaterialsStep course={course} materials={[mat({ fileName: 'doc.pdf', indexingStatus: 'pending' })]} slug="s" catalogSyncedAt={null} onMaterialsChange={onMaterialsChange} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByText(/not indexed yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /index now/i }));
    await waitFor(() => expect(fetchMock.mock.calls[0][0]).toContain('/v2-backfill'));
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
  });

  it('no Index now button when nothing is fixably unindexed', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({ indexingStatus: 'ready' })]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.queryByRole('button', { name: /index now/i })).toBeNull();
  });

  it('unrolls a Canvas-list material to its item titles', () => {
    const blob = '## Assignment One\nbody\n## Assignment Two\nbody';
    render(<CaptureMaterialsStep course={course} materials={[mat({ fileName: 'Canvas: Assignments', extractedText: blob })]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /expand items/i }));
    expect(screen.getByText('Assignment One')).toBeTruthy();
    expect(screen.getByText('Assignment Two')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run "app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx"` → FAIL (prop/features missing).

- [ ] **Step 3: Replace `app/capture/[code]/CaptureMaterialsStep.tsx`** with the full component below:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isCanvasListMaterial, parseCanvasBlob } from '@/lib/canvas/parseCanvasBlob';
import { MaterialsPanel, IndexingStatusDot, type CaptureMaterial, type CourseCatalogView } from './MaterialsPanel';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';
import {
  materialProvenance, PROVENANCE_LABEL, hasMaterials,
  catalogContributionSummary, materialReadability, relativeTimeFromNow, hasFixablyUnindexed,
} from '@/lib/capture/material-display';

interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  catalogSyncedAt: string | null;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  onCourseChange: (next: CourseCatalogView) => void;
  onContinue: () => void;
}

export function CaptureMaterialsStep({ course, materials, slug, catalogSyncedAt, onMaterialsChange, onCourseChange, onContinue }: Props) {
  useRouter();
  const [showDetail, setShowDetail] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [syncedAt, setSyncedAt] = useState<string | null>(catalogSyncedAt);
  const [resyncing, setResyncing] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

  const ready = hasMaterials(materials.length);
  const showIndexNow = hasFixablyUnindexed(materials);

  async function resync() {
    setResyncing(true); setResyncError(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.code)}/sync-from-sheet?slug=${encodeURIComponent(slug)}`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setResyncError(res.status === 404 ? 'no sheet tab for this course' : ((json as { error?: string }).error ?? 'sync failed')); return; }
      const c = (json as { course?: Record<string, unknown> }).course;
      if (c) {
        onCourseChange({
          ...course,
          description: (c.description as string) ?? course.description,
          prerequisites: (c.prerequisites as string) ?? course.prerequisites,
          learningObjectives: (c.learningObjectives as string[]) ?? course.learningObjectives,
          majorProjects: (c.majorProjects as string[]) ?? course.majorProjects,
          skillsRequired: (c.skillsRequired as string[]) ?? course.skillsRequired,
        });
        setSyncedAt((c.lastSyncedAt as string) ?? new Date().toISOString());
      }
    } catch { setResyncError('sync failed'); }
    finally { setResyncing(false); }
  }

  async function indexNow() {
    setIndexing(true); setIndexError(null);
    try {
      const res = await fetch(`/api/admin/v2-backfill?slug=${encodeURIComponent(slug)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseCode: course.code, slug }),
      });
      if (!res.ok) { setIndexError('indexing failed — try “Manage materials in detail”'); return; }
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
    } catch { setIndexError('indexing failed'); }
    finally { setIndexing(false); }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-1 flex items-center gap-2 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Step 1 of 2 · Confirm materials</span>
        <span aria-hidden className="text-foreground">●</span><span aria-hidden>──</span><span aria-hidden>○</span>
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">Here&apos;s what the auditor will read.</h2>
      <p className="mt-1 text-sm text-muted-foreground">Confirm the sources below — add anything missing before you start. This is the evidence the audit is grounded in.</p>

      {/* GC curriculum sheet catalog source */}
      <div className="mt-4 flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2.5">
        <span aria-hidden>📋</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">GC curriculum catalog</span>
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800 dark:bg-sky-900/30 dark:text-sky-300">GC curriculum sheet</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{catalogContributionSummary(course)} · synced {relativeTimeFromNow(syncedAt, Date.now())}</p>
          {resyncError && <p className="text-[11px] text-amber-700 dark:text-amber-400">{resyncError}</p>}
        </div>
        <button type="button" onClick={resync} disabled={resyncing}
          className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50">
          {resyncing ? 'Re-syncing…' : 'Re-sync'}
        </button>
      </div>

      {ready ? (
        <ul className="mt-3 divide-y rounded-md border">
          {materials.map((m) => {
            const prov = materialProvenance(m);
            const read = materialReadability(m);
            const dimmed = m.ignored || m.autoSetAside;
            const canvasList = isCanvasListMaterial(m.fileName);
            const open = !!expanded[m.id];
            const items = open && canvasList && m.extractedText ? parseCanvasBlob(m.extractedText) : [];
            const ignoredSet = new Set(m.ignoredItems ?? []);
            return (
              <li key={m.id} className={dimmed ? 'opacity-50' : ''}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  {canvasList ? (
                    <button type="button" aria-label={open ? 'Collapse items' : 'Expand items'}
                      onClick={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))}
                      className="w-4 text-muted-foreground hover:text-foreground">{open ? '▾' : '▸'}</button>
                  ) : (<span aria-hidden className="w-4 text-center">📄</span>)}
                  <span className="min-w-0 flex-1 truncate text-sm">{m.fileName}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{PROVENANCE_LABEL[prov]}</span>
                  <span className={'flex items-center gap-1 text-[11px] ' + (read.readable ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400')} title={read.reason ?? ''}>
                    <IndexingStatusDot status={m.indexingStatus} indexedAt={m.indexedAt} />
                    {read.label}{read.reason ? ` · ${read.reason}` : ''}
                  </span>
                </div>
                {open && (
                  <ul className="border-t bg-muted/20 px-9 py-2 text-[12px] text-muted-foreground">
                    {items.length === 0 ? <li>(no items)</li> : items.map((it, i) => (
                      <li key={i} className={ignoredSet.has(it.title) ? 'line-through opacity-60' : ''}>{it.title}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-3 rounded-md border border-dashed px-4 py-6 text-center">
          <p className="text-sm font-medium">No documents added yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">The course catalog above is included, but uploaded documents make for stronger evidence.</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setShowDetail(true)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">+ Add or import materials</button>
        {ready && (
          <button type="button" onClick={() => setShowDetail((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">⚙ Manage materials in detail</button>
        )}
        {showIndexNow && (
          <button type="button" onClick={indexNow} disabled={indexing}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/20 dark:text-amber-200">
            {indexing ? 'Indexing…' : 'Index now'}
          </button>
        )}
        {indexError && <span className="text-[11px] text-amber-700 dark:text-amber-400">{indexError}</span>}
      </div>

      {showDetail && (
        <div className="mt-4">
          <MaterialsPanel course={course} initialMaterials={materials} slug={slug}
            onMaterialsChange={onMaterialsChange} onCourseChange={onCourseChange} initiallyExpanded />
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-4">
        {ready ? (
          <button type="button" onClick={onContinue}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90">Looks complete — continue to interview →</button>
        ) : (
          <button type="button" onClick={onContinue}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Start without materials anyway →</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run** the component test → all PASS. **Step 5: Typecheck** `pnpm exec tsc --noEmit` — now Task 4's prop wiring + this component agree; confirm clean for all touched files.

- [ ] **Step 6: Commit** (Task 4 + Task 5 together):
```bash
git add "app/capture/[code]/page.tsx" "app/capture/[code]/CaptureClient.tsx" "app/capture/[code]/CaptureMaterialsStep.tsx" "app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx"
git commit -m "feat(capture): Step 1 catalog row + readability + Index now + Canvas unroll"
```

---

### Task 6: Full suite + tsc + STATE.md

- [ ] **Step 1:** `pnpm test` → all green (fix fallout). **Step 2:** `pnpm exec tsc --noEmit` → 0 errors.
- [ ] **Step 3: Update `docs/STATE.md`** per the spec's "STATE.md updates" section: Active arc note (header trim + catalog row + readability/Index-now + Canvas unroll); record the one-time backfill op (ready 72→89, ~11 genuinely-unindexable remain); Deferred/debt (faculty-tier index route; auto-marking unindexable pending → skipped).
- [ ] **Step 4: Commit** `git add docs/STATE.md && git commit -m "docs(state): capture entry refinements"`.

---

## Self-Review

**1. Spec coverage:** Header trim → Task 3. Catalog row + Re-sync + timestamp → Tasks 1 (helpers) + 4 (prop) + 5 (UI). Honest status + Index now + Canvas-stays-an-option (relabel) → Tasks 1 + 2 (refetch) + 5. Canvas unroll → Task 5 (reuses parseCanvasBlob). All covered.

**2. Placeholder scan:** Task 2 Step 2 says "MOVE THE EXACT MAPPING from MaterialsPanel" — that's a precise instruction to lift existing code, not a vague TODO (the source is named + line-referenced). Everything else is full code.

**3. Type consistency:** `catalogSyncedAt: string | null` threaded page→client→step (Tasks 4, 5) and the step prop matches. `materialReadability`/`hasFixablyUnindexed`/`catalogContributionSummary`/`relativeTimeFromNow` defined in Task 1, consumed in Task 5 with matching shapes. `fetchCourseMaterials(code, slug): Promise<CaptureMaterial[] | null>` defined Task 2, called Task 5. `CourseCatalogView` unchanged (catalogSyncedAt is a sibling prop, not a field).
