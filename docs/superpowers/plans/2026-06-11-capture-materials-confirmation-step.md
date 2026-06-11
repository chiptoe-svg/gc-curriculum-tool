# CourseCapture Materials-Confirmation Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "confirm your materials" a visible Step 1 (provenance + add + soft empty-guard) before the CourseCapture interview, on a fresh audit.

**Architecture:** A new `landingStep: 'materials' | 'interview'` in `CaptureClient` gates a new presentational `CaptureMaterialsStep` (clean list of materials with provenance badges + ready-status, a "+ Add a material"/"Manage in detail" reveal of the existing `MaterialsPanel`, and a soft Continue gate). All mutation logic is reused from `MaterialsPanel` (single source of truth). Pure helpers carry the testable logic.

**Tech Stack:** Next.js 15 client components, TypeScript strict (`noUncheckedIndexedAccess`), Vitest + `@testing-library/react` (jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-11-capture-materials-confirmation-step-design.md`

---

## Background the implementer must know

- **Provenance is derived from the `fileName` prefix** (no dedicated field): `Canvas:` / `Canvas File:` → Canvas; `Google Doc:` / `Google Slides:` / `Google Sheet:` / `Drive PDF:` / `YouTube:` → linked doc; anything else → a local upload.
- **`CaptureMaterial`** (exported from `app/capture/[code]/MaterialsPanel.tsx`) has `id`, `fileName`, `indexingStatus: 'pending'|'indexing'|'ready'|'failed'|'skipped'` (exported as `IndexingStatus`), `blobUrl`, `ignored`, `autoSetAside`, etc.
- **`MaterialsPanel` already owns ALL mutations** (upload PDF/DOCX, Canvas import, scan-linked-docs, ignore, compress, re-extract). It is collapsed-by-default (`useState(true)`), with a "Show"/"Hide" toggle. Step 1 must **reuse** it, not reimplement uploads.
- **`CaptureClient`** computes `const isLanding = stage === 'chat' && messages.length === 0;` and on landing renders a hero + chat start + a bottom `<details>` "⚙ Materials…" disclosure wrapping `trays`. State of interest: `stage` (`'chat'|'generating'|'review'`), `messages`, `materials`/`setMaterials`, `course`/`setCourse`.
- **Test tooling:** component render tests use `import { render, screen, fireEvent } from '@testing-library/react'` (see `components/__tests__/CourseDetails.test.tsx`). jsdom env, setup at `tests/setup.ts`. Run one test: `pnpm vitest run <path>`. Typecheck: `pnpm exec tsc --noEmit`.
- **Strict mode:** `noUncheckedIndexedAccess` is on — guard array index access.

---

## File Structure

- **Create** `lib/capture/material-display.ts` — pure presentational helpers: `materialProvenance`, `PROVENANCE_LABEL`, `indexingStatusLabel`, `hasMaterials`, `shouldShowMaterialsStep`. One clear responsibility: deriving display facts + the step's show/gate decisions. No React, no DB.
- **Create** `lib/capture/__tests__/material-display.test.ts`.
- **Modify** `app/capture/[code]/MaterialsPanel.tsx` — `export` the `IndexingStatusDot` component; add an optional `initiallyExpanded?: boolean` prop.
- **Create** `app/capture/[code]/CaptureMaterialsStep.tsx` — the Step 1 view (presentational + a `showDetail` toggle that reveals `MaterialsPanel`).
- **Create** `app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx`.
- **Modify** `app/capture/[code]/CaptureClient.tsx` — add `landingStep` state; gate the render on `shouldShowMaterialsStep(...)`.
- **Update** `docs/STATE.md`.

---

### Task 1: Pure display + decision helpers

**Files:**
- Create: `lib/capture/material-display.ts`
- Test: `lib/capture/__tests__/material-display.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/capture/__tests__/material-display.test.ts
import { describe, it, expect } from 'vitest';
import {
  materialProvenance,
  PROVENANCE_LABEL,
  indexingStatusLabel,
  hasMaterials,
  shouldShowMaterialsStep,
} from '@/lib/capture/material-display';

describe('materialProvenance', () => {
  it('classifies Canvas list + Canvas File as canvas', () => {
    expect(materialProvenance({ fileName: 'Canvas: Syllabus' })).toBe('canvas');
    expect(materialProvenance({ fileName: 'Canvas File: rubric.pdf' })).toBe('canvas');
  });
  it('classifies Google/Drive/YouTube as linked', () => {
    for (const n of ['Google Doc: Brief', 'Google Slides: Deck', 'Google Sheet: Grades', 'Drive PDF: Spec', 'YouTube: Lecture 1']) {
      expect(materialProvenance({ fileName: n })).toBe('linked');
    }
  });
  it('classifies anything else as a local upload', () => {
    expect(materialProvenance({ fileName: 'GC3800_Syllabus.pdf' })).toBe('uploaded');
    expect(materialProvenance({ fileName: 'Project2_Brief.docx' })).toBe('uploaded');
  });
});

describe('PROVENANCE_LABEL', () => {
  it('has a human label per provenance', () => {
    expect(PROVENANCE_LABEL.canvas).toBe('Canvas');
    expect(PROVENANCE_LABEL.uploaded).toBe('uploaded');
    expect(PROVENANCE_LABEL.linked).toBe('linked doc');
  });
});

describe('indexingStatusLabel', () => {
  it('maps known statuses, defaults to pending', () => {
    expect(indexingStatusLabel('ready')).toBe('ready');
    expect(indexingStatusLabel('indexing')).toBe('indexing…');
    expect(indexingStatusLabel('failed')).toBe('failed');
    expect(indexingStatusLabel('skipped')).toBe('skipped');
    expect(indexingStatusLabel('weird-unknown')).toBe('pending');
  });
});

describe('hasMaterials', () => {
  it('is true only when count >= 1', () => {
    expect(hasMaterials(0)).toBe(false);
    expect(hasMaterials(1)).toBe(true);
    expect(hasMaterials(5)).toBe(true);
  });
});

describe('shouldShowMaterialsStep', () => {
  it('shows only on a fresh chat landing with landingStep=materials', () => {
    expect(shouldShowMaterialsStep({ stage: 'chat', messagesCount: 0, landingStep: 'materials' })).toBe(true);
  });
  it('hides once advanced to interview', () => {
    expect(shouldShowMaterialsStep({ stage: 'chat', messagesCount: 0, landingStep: 'interview' })).toBe(false);
  });
  it('hides when resuming (messages exist) or off the chat stage', () => {
    expect(shouldShowMaterialsStep({ stage: 'chat', messagesCount: 3, landingStep: 'materials' })).toBe(false);
    expect(shouldShowMaterialsStep({ stage: 'review', messagesCount: 0, landingStep: 'materials' })).toBe(false);
    expect(shouldShowMaterialsStep({ stage: 'generating', messagesCount: 0, landingStep: 'materials' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/capture/__tests__/material-display.test.ts`
Expected: FAIL — cannot resolve `@/lib/capture/material-display`.

- [ ] **Step 3: Implement**

```ts
// lib/capture/material-display.ts

export type MaterialProvenance = 'canvas' | 'uploaded' | 'linked';

const LINKED_PREFIXES = ['Google Doc:', 'Google Slides:', 'Google Sheet:', 'Drive PDF:', 'YouTube:'];

/**
 * Where a material came from, derived from its fileName prefix (the importer
 * stamps these). Canvas list + Canvas File → canvas; Google/Drive/YouTube →
 * linked; anything else is a local upload.
 */
export function materialProvenance(m: { fileName: string }): MaterialProvenance {
  const n = m.fileName;
  if (n.startsWith('Canvas:') || n.startsWith('Canvas File:')) return 'canvas';
  if (LINKED_PREFIXES.some((p) => n.startsWith(p))) return 'linked';
  return 'uploaded';
}

export const PROVENANCE_LABEL: Record<MaterialProvenance, string> = {
  canvas: 'Canvas',
  uploaded: 'uploaded',
  linked: 'linked doc',
};

/** Visible label for an indexing status (the dot's tooltip uses similar text). */
export function indexingStatusLabel(status: string): string {
  switch (status) {
    case 'ready': return 'ready';
    case 'indexing': return 'indexing…';
    case 'failed': return 'failed';
    case 'skipped': return 'skipped';
    default: return 'pending';
  }
}

/** Continue is freely available once at least one material exists. */
export function hasMaterials(count: number): boolean {
  return count >= 1;
}

/**
 * The Step 1 materials gate shows only on a genuinely fresh audit: the chat
 * stage, no messages yet, and the landing sub-step still on 'materials'.
 * Resuming (messages exist) or any non-chat stage skips it.
 */
export function shouldShowMaterialsStep(args: {
  stage: string;
  messagesCount: number;
  landingStep: 'materials' | 'interview';
}): boolean {
  return args.stage === 'chat' && args.messagesCount === 0 && args.landingStep === 'materials';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run lib/capture/__tests__/material-display.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add lib/capture/material-display.ts lib/capture/__tests__/material-display.test.ts
git commit -m "feat(capture): material provenance + step display/decision helpers"
```

---

### Task 2: Export `IndexingStatusDot` + add `initiallyExpanded` to MaterialsPanel

**Files:**
- Modify: `app/capture/[code]/MaterialsPanel.tsx` (the `IndexingStatusDot` declaration ~line 185; the `Props` interface ~line 57; the `MaterialsPanel` signature ~line 605; the `collapsed` state ~line 612)

This is a small mechanical change verified by typecheck + the existing suite (no new test — the prop's effect is exercised in Task 3's component test).

- [ ] **Step 1: Export the status dot**

Find `function IndexingStatusDot({ status, indexedAt }: { status: IndexingStatus; indexedAt: string | null }) {` and add `export`:

```ts
export function IndexingStatusDot({ status, indexedAt }: { status: IndexingStatus; indexedAt: string | null }) {
```

- [ ] **Step 2: Add the `initiallyExpanded` prop to the `Props` interface**

In the `interface Props { ... }` for `MaterialsPanel` (the one with `initialMaterials`, `slug`, `onMaterialsChange`, `onCourseChange`), add:

```ts
  /** When true, the panel mounts expanded instead of collapsed. Defaults to collapsed elsewhere. */
  initiallyExpanded?: boolean;
```

- [ ] **Step 3: Honor the prop in the collapsed state**

Change the `MaterialsPanel` signature to destructure it:

```ts
export function MaterialsPanel({ course, initialMaterials, slug, onMaterialsChange, onCourseChange, initiallyExpanded }: Props) {
```

Change the collapsed initializer (currently `const [collapsed, setCollapsed] = useState(true);`) to:

```ts
  const [collapsed, setCollapsed] = useState(!initiallyExpanded);
```

(`initiallyExpanded` undefined → `!undefined` = `true` = collapsed, preserving current behavior at every existing call site.)

- [ ] **Step 4: Typecheck + run the existing capture-related suite**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.
Run: `pnpm vitest run lib/capture`
Expected: PASS (Task 1 helpers still green).

- [ ] **Step 5: Commit**

```bash
git add "app/capture/[code]/MaterialsPanel.tsx"
git commit -m "feat(capture): export IndexingStatusDot + initiallyExpanded prop on MaterialsPanel"
```

---

### Task 3: `CaptureMaterialsStep` component

**Files:**
- Create: `app/capture/[code]/CaptureMaterialsStep.tsx`
- Test: `app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx`

- [ ] **Step 1: Write the failing render test**

The test mocks `./MaterialsPanel` so the heavy upload/Canvas logic isn't pulled in — we only test the step's own list, gate, and reveal.

```tsx
// app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

// Stub the heavy panel + reuse the real status dot as a no-op.
vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({
  MaterialsPanel: () => <div data-testid="materials-panel-detail">detail panel</div>,
  IndexingStatusDot: () => <span data-testid="status-dot" />,
}));

import { CaptureMaterialsStep } from '@/app/capture/[code]/CaptureMaterialsStep';

const course = { code: 'GC 3800', title: 'Junior Seminar', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [], auditMode: 'full' } as unknown as CourseCatalogView;

function mat(over: Partial<CaptureMaterial>): CaptureMaterial {
  return {
    id: over.id ?? 'm1', fileName: over.fileName ?? 'x.pdf', mimeType: 'application/pdf',
    sizeBytes: 1, pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: 'x',
    ignored: false, digest: null, digestGeneratedAt: null, useDigest: false,
    indexingStatus: over.indexingStatus ?? 'ready', indexedAt: null, ferpaRisk: 'ok' as never,
    autoSetAside: false, setAsideReason: null, blobUrl: over.blobUrl ?? '', ignoredItems: undefined,
    ...over,
  } as CaptureMaterial;
}

const noop = () => {};

describe('CaptureMaterialsStep', () => {
  it('lists each material with a provenance label', () => {
    const materials = [mat({ id: 'a', fileName: 'Canvas: Syllabus' }), mat({ id: 'b', fileName: 'Project2_Brief.docx' })];
    render(<CaptureMaterialsStep course={course} materials={materials} slug="s" onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByText('Canvas: Syllabus')).toBeTruthy();
    expect(screen.getByText('Project2_Brief.docx')).toBeTruthy();
    expect(screen.getByText('Canvas')).toBeTruthy();     // provenance badge
    expect(screen.getByText('uploaded')).toBeTruthy();
  });

  it('Continue calls onContinue when materials exist', () => {
    const onContinue = vi.fn();
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" onMaterialsChange={noop} onCourseChange={noop} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /continue to interview/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-guard with a "start anyway" action when there are no materials', () => {
    const onContinue = vi.fn();
    render(<CaptureMaterialsStep course={course} materials={[]} slug="s" onMaterialsChange={noop} onCourseChange={noop} onContinue={onContinue} />);
    expect(screen.queryByRole('button', { name: /continue to interview/i })).toBeNull();
    fireEvent.click(screen.getByText(/start without materials anyway/i));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('reveals the detail MaterialsPanel when "Add a material" is clicked', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.queryByTestId('materials-panel-detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /add a material/i }));
    expect(screen.getByTestId('materials-panel-detail')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run "app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx"`
Expected: FAIL — cannot resolve `CaptureMaterialsStep`.

- [ ] **Step 3: Implement the component**

```tsx
// app/capture/[code]/CaptureMaterialsStep.tsx
'use client';

import { useState } from 'react';
import { MaterialsPanel, IndexingStatusDot, type CaptureMaterial, type CourseCatalogView } from './MaterialsPanel';
import { materialProvenance, PROVENANCE_LABEL, indexingStatusLabel, hasMaterials } from '@/lib/capture/material-display';

interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  onCourseChange: (next: CourseCatalogView) => void;
  onContinue: () => void;
}

export function CaptureMaterialsStep({ course, materials, slug, onMaterialsChange, onCourseChange, onContinue }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const ready = hasMaterials(materials.length);

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-1 flex items-center gap-2 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Step 1 of 2 · Confirm materials</span>
        <span aria-hidden className="text-foreground">●</span><span aria-hidden>──</span><span aria-hidden>○</span>
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">
        Here&apos;s what the auditor will read.
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Confirm the materials below — add anything missing before you start. This is the evidence the audit is grounded in.
      </p>

      {ready ? (
        <ul className="mt-4 divide-y rounded-md border">
          {materials.map((m) => {
            const prov = materialProvenance(m);
            const dimmed = m.ignored || m.autoSetAside;
            return (
              <li key={m.id} className={'flex items-center gap-3 px-3 py-2.5 ' + (dimmed ? 'opacity-50' : '')}>
                <span aria-hidden>📄</span>
                <span className="flex-1 truncate text-sm">{m.fileName}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {PROVENANCE_LABEL[prov]}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IndexingStatusDot status={m.indexingStatus} indexedAt={m.indexedAt} />
                  {indexingStatusLabel(m.indexingStatus)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-md border border-dashed px-4 py-6 text-center">
          <p className="text-sm font-medium">No materials loaded yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a syllabus, assignment, or other course document so the audit has something to read.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowDetail(true)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          + Add a material
        </button>
        {ready && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            ⚙ Manage materials in detail
          </button>
        )}
      </div>

      {showDetail && (
        <div className="mt-4">
          <MaterialsPanel
            course={course}
            initialMaterials={materials}
            slug={slug}
            onMaterialsChange={onMaterialsChange}
            onCourseChange={onCourseChange}
            initiallyExpanded
          />
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-4">
        {ready ? (
          <button
            type="button"
            onClick={onContinue}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Looks complete — continue to interview →
          </button>
        ) : (
          <button
            type="button"
            onClick={onContinue}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Start without materials anyway →
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run "app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx"`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors in the new files. (`CourseCatalogView` / `CaptureMaterial` are type-only imports from MaterialsPanel.)

- [ ] **Step 6: Commit**

```bash
git add "app/capture/[code]/CaptureMaterialsStep.tsx" "app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx"
git commit -m "feat(capture): Step 1 materials-confirmation view (provenance + add + gate)"
```

---

### Task 4: Wire Step 1 into `CaptureClient`

**Files:**
- Modify: `app/capture/[code]/CaptureClient.tsx` (imports ~line 12; state ~line 85; the `return (...)` ~line 266)

- [ ] **Step 1: Add imports**

After the `CaptureHero` import (line 12), add:

```ts
import { CaptureMaterialsStep } from './CaptureMaterialsStep';
import { shouldShowMaterialsStep } from '@/lib/capture/material-display';
```

- [ ] **Step 2: Add the `landingStep` state**

After the `chooserMode` state (the `useState<'fresh' | 'continue'>(...)` block, ~line 85), add:

```ts
  // Fresh-audit landing sub-step: confirm materials before the interview opens.
  const [landingStep, setLandingStep] = useState<'materials' | 'interview'>('materials');
```

- [ ] **Step 3: Gate the render on the materials step**

Find the existing `const isLanding = stage === 'chat' && messages.length === 0;` line (in the render body, ~line 245). Immediately after it, add:

```ts
  const showMaterialsStep = shouldShowMaterialsStep({ stage, messagesCount: messages.length, landingStep });
```

Then wrap the **existing** returned JSX so the materials step short-circuits it. The current return is:

```tsx
  return (
    <div className="space-y-6">
      {!isLanding && trays}
      {stage === 'chat' && (
        ...
      )}
      {stage === 'generating' && ( ... )}
      {stage === 'review' && profile && ( ... )}
    </div>
  );
```

Change ONLY the outer structure to:

```tsx
  return (
    <div className="space-y-6">
      {showMaterialsStep ? (
        <CaptureMaterialsStep
          course={course}
          materials={materials}
          slug={slug}
          onMaterialsChange={setMaterials}
          onCourseChange={setCourse}
          onContinue={() => setLandingStep('interview')}
        />
      ) : (
        <>
          {!isLanding && trays}
          {stage === 'chat' && (
            ...
          )}
          {stage === 'generating' && ( ... )}
          {stage === 'review' && profile && ( ... )}
        </>
      )}
    </div>
  );
```

Leave every inner block (`trays`, the three `stage ===` branches, the `isLanding` hero + bottom `<details>` disclosure) **exactly as-is** — they now live inside the `else` fragment. After "Continue", `landingStep` is `'interview'`, `showMaterialsStep` is false, and the existing landing (hero + chat start + the bottom materials disclosure) renders unchanged.

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (`setMaterials`/`setCourse` already exist; `CaptureMaterialsStep` props match Task 3.)

- [ ] **Step 5: Manual smoke (no automated CaptureClient render test — too heavy; the decision is unit-tested via `shouldShowMaterialsStep`)**

If the dev server is running, open `/capture/GC%203800?slug=<PROTOTYPE_SLUG>` and confirm:
- A fresh course opens on "Step 1 of 2 · Confirm materials" with the materials listed (provenance + status), not straight into the interview.
- "Continue to interview →" reveals the hero + chat start.
- A course with an in-flight saved conversation skips Step 1 (drops into the chat).

- [ ] **Step 6: Commit**

```bash
git add "app/capture/[code]/CaptureClient.tsx"
git commit -m "feat(capture): gate fresh-audit landing on the Step 1 materials view"
```

---

### Task 5: Full suite + typecheck + STATE.md

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Run the full suite**

Run: `pnpm test`
Expected: all green (prior count + the new helper/component tests). Fix any fallout.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Update STATE.md**

Edit `docs/STATE.md`:
- **What's live / Active arc:** the CourseCapture fresh-audit landing now opens on a **Step 1 materials-confirmation gate** — a clean list with provenance (Canvas / uploaded / linked) + ready-status, a "+ Add a material" / "⚙ Manage in detail" reveal of the existing `MaterialsPanel`, and a soft Continue gate with an empty-materials guard. Refines (does not replace) the 2026-06-10 goal-first landing; resuming a saved conversation skips the gate.
- **Deferred / debt:** optional polish not built — a "still indexing" banner on Step 1, and the final placement of the Help / Snapshot-history affordances once the bottom gear disclosure no longer leads on landing.
- No schema / route / env / AI-function change.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): CourseCapture Step 1 materials-confirmation gate"
```

---

## Self-Review

**1. Spec coverage:**
- Visible Step 1 before interview, fresh-audit-only → Task 1 (`shouldShowMaterialsStep`) + Task 4. ✅
- Per-item provenance + ready-status → Task 1 (`materialProvenance`/`indexingStatusLabel`) + Task 3 list. ✅
- Clean step + power controls one click away → Task 3 (clean list + `showDetail` reveal of `MaterialsPanel`). ✅
- Obvious add affordance → Task 3 "+ Add a material" reveals the panel (upload/Canvas/scan live there). ✅
- Soft gate + empty-guard → Task 1 (`hasMaterials`) + Task 3 (Continue vs empty state + "start anyway"). ✅
- Reuse mutations, no rebuild → Task 2 (`initiallyExpanded`) + Task 3 renders `MaterialsPanel`. ✅
- No schema/route/data-model/interview/synthesis change → nothing in the plan touches them. ✅

**2. Placeholder scan:** The `...` inside Task 4's Step 3 JSX explicitly means "the existing blocks, unchanged" with a bolded instruction to leave them as-is — not an unfinished step. Every code file to be created is shown in full. No TBD/TODO.

**3. Type consistency:** `MaterialProvenance` (Task 1) ↔ `PROVENANCE_LABEL` keys ↔ `materialProvenance` return — consistent. `IndexingStatusDot` exported (Task 2) and consumed (Task 3) with `{ status, indexedAt }`. `CaptureMaterialsStep` props (Task 3) match the call site (Task 4). `initiallyExpanded` added (Task 2) and passed (Task 3). `shouldShowMaterialsStep` signature (Task 1) matches its call (Task 4).
