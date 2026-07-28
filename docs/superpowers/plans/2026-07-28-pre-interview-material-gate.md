# Pre-interview material-failure decision gate — Implementation Plan (Increment 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pre-interview checkpoint on the existing `ingest` landing step that, when materials are flagged (extraction-failed / FERPA-held / inaccessible-link), makes faculty consciously proceed or pause + annotate — and persists their per-material notes.

**Architecture:** A pure `flagMaterials` classifier over the already-fetched `materials`, a presentational `MaterialGate` component rendered only when flags exist, wired into `CaptureClient`'s `ingest` step. Notes persist via a new nullable `faculty_note` column and an extended `PATCH /materials/[id]`. FERPA override reuses the existing include-anyway PATCH.

**Tech Stack:** TypeScript/Next.js, Drizzle (drizzle-kit migrations), Vitest + Testing Library.

## Global Constraints
- **Reuse, don't rebuild:** the `ingest` landing step, `materialProvenance` (`lib/capture/material-display.ts`), the include-anyway PATCH (`{ ignored:false }`), and the already-fetched `materials`. New surface = one classifier + one component + one column + one PATCH field.
- **Increment 2 (scoring integration) is OUT OF SCOPE** — persist + display notes only; do not touch capture-synthesis.
- **No flags → no gate:** a clean capture advances `ingest → interview` exactly as today (no extra click).
- **Never advance on a failed save:** a PATCH error keeps the gate open with an inline error.
- Three buckets only: `extraction-failed`, `ferpa-held`, `inaccessible-link`. Low-text/skipped is NOT flagged.

---

### Task 1: `faculty_note` column + migration

**Files:**
- Modify: `lib/db/schema.ts` (the `courseMaterials` table)
- Create: `lib/db/migrations/0049_*.sql` (via `pnpm db:generate`)

**Interfaces:**
- Produces: `courseMaterials.facultyNote` (`text('faculty_note')`, nullable) on `CourseMaterialRow`.

- [ ] **Step 1: Add the column to the schema** — in `lib/db/schema.ts`, in the `courseMaterials` table near `setAsideReason`:

```ts
  // Optional faculty note captured at the pre-interview gate explaining a flagged
  // material (why a gap is acceptable / will be fixed / ok to include). Increment 1
  // persists + displays it; scoring integration is a later increment.
  facultyNote: text('faculty_note'),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `lib/db/migrations/0049_*.sql` adding `faculty_note`. Inspect it — it must be a single `ALTER TABLE "course_materials" ADD COLUMN "faculty_note" text;` (nullable, no default backfill).

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies cleanly; `\d course_materials` shows `faculty_note`.

- [ ] **Step 4: Typecheck**

Run: `node_modules/.bin/tsc --noEmit`
Expected: clean (the new field is nullable, so existing `$inferSelect` consumers still compile).

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/
git commit -m "feat(db): add nullable course_materials.faculty_note (pre-interview gate)"
```

---

### Task 2: Persist notes — `setMaterialFacultyNote` + PATCH field

**Files:**
- Modify: `lib/db/course-materials-queries.ts` (add setter, mirroring `setMaterialIgnored`)
- Modify: `app/api/courses/[code]/materials/[id]/route.ts` (PATCH: accept `facultyNote`)
- Test: `tests/api/course-materials.test.ts` (extend)

**Interfaces:**
- Produces: `setMaterialFacultyNote(id: string, note: string | null): Promise<boolean>` (returns true when a row updated).
- Produces: `PATCH …/materials/[id]` accepts `{ facultyNote?: string }`.

- [ ] **Step 1: Write the failing route test** (mirror an existing PATCH test in `tests/api/course-materials.test.ts`)

```ts
it('PATCH persists facultyNote', async () => {
  // (Executor: mirror the sibling PATCH test's mocking of authorizeCourseWrite +
  //  getMaterialById; assert the setter is called with the note and a 200 returns.)
  const res = await PATCH(
    new Request('http://x/api/courses/GC%203620/materials/m1?slug=s', {
      method: 'PATCH', body: JSON.stringify({ facultyNote: 'optional video, ok to skip' }),
    }),
    { params: Promise.resolve({ code: 'GC 3620', id: 'm1' }) },
  );
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run to verify fail** — `node_modules/.bin/vitest run tests/api/course-materials.test.ts` → FAIL (facultyNote rejected by the "at least one of" guard).

- [ ] **Step 3: Add the setter** in `lib/db/course-materials-queries.ts` (mirror `setMaterialIgnored`):

```ts
export async function setMaterialFacultyNote(id: string, note: string | null): Promise<boolean> {
  const rows = await db
    .update(courseMaterials)
    .set({ facultyNote: note && note.trim().length > 0 ? note : null })
    .where(eq(courseMaterials.id, id))
    .returning({ id: courseMaterials.id });
  return rows.length > 0;
}
```

- [ ] **Step 4: Extend the PATCH handler** in `route.ts`: add `const hasFacultyNote = typeof body.facultyNote === 'string';`, include it in the "at least one of" guard + the error message, and add a branch:

```ts
  if (hasFacultyNote) {
    const updated = await setMaterialFacultyNote(id, body.facultyNote as string);
    if (!updated) return NextResponse.json({ error: 'no row updated' }, { status: 404 });
  }
```

Add `setMaterialFacultyNote` to the import from `@/lib/db/course-materials-queries`.

- [ ] **Step 5: Run to verify pass** + commit

```bash
node_modules/.bin/vitest run tests/api/course-materials.test.ts
git add lib/db/course-materials-queries.ts "app/api/courses/[code]/materials/[id]/route.ts" tests/api/course-materials.test.ts
git commit -m "feat(materials): PATCH facultyNote + setMaterialFacultyNote (pre-interview gate)"
```

---

### Task 3: `flagMaterials` classifier

**Files:**
- Create: `lib/capture/flag-materials.ts`
- Test: `tests/lib/capture/flag-materials.test.ts`

**Interfaces:**
- Consumes: `materialProvenance(m: { fileName: string }): 'canvas'|'uploaded'|'linked'` (`@/lib/capture/material-display`).
- Produces: `type FlagKind = 'extraction-failed' | 'ferpa-held' | 'inaccessible-link'`; `interface FlaggedMaterial { id: string; fileName: string; kind: FlagKind; facultyNote: string | null }`; `flagMaterials(materials: FlagInput[]): FlaggedMaterial[]`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/lib/capture/flag-materials.test.ts
import { describe, it, expect } from 'vitest';
import { flagMaterials } from '@/lib/capture/flag-materials';

const base = { id: 'x', fileName: 'a.pdf', extractionStatus: 'ok', indexingStatus: 'ready',
  ignored: false, autoSetAside: false, extractedText: 'hi', facultyNote: null } as const;

describe('flagMaterials', () => {
  it('flags a failed uploaded material as extraction-failed', () => {
    const r = flagMaterials([{ ...base, extractionStatus: 'failed', fileName: 'deck.pdf' }]);
    expect(r).toEqual([{ id: 'x', fileName: 'deck.pdf', kind: 'extraction-failed', facultyNote: null }]);
  });
  it('flags an auto-set-aside material as ferpa-held', () => {
    const r = flagMaterials([{ ...base, ignored: true, autoSetAside: true }]);
    expect(r[0]!.kind).toBe('ferpa-held');
  });
  it('does NOT flag a manual ignore (autoSetAside false)', () => {
    expect(flagMaterials([{ ...base, ignored: true, autoSetAside: false }])).toEqual([]);
  });
  it('flags a failed linked material as inaccessible-link, not extraction-failed', () => {
    const r = flagMaterials([{ ...base, fileName: 'Drive PDF: 1abc… (not accessible)', extractionStatus: 'failed', extractedText: null }]);
    expect(r[0]!.kind).toBe('inaccessible-link');
  });
  it('does NOT flag a clean ok material', () => {
    expect(flagMaterials([base])).toEqual([]);
  });
  it('carries facultyNote through', () => {
    const r = flagMaterials([{ ...base, extractionStatus: 'failed', facultyNote: 'ok to skip' }]);
    expect(r[0]!.facultyNote).toBe('ok to skip');
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
// lib/capture/flag-materials.ts
import { materialProvenance } from '@/lib/capture/material-display';

export type FlagKind = 'extraction-failed' | 'ferpa-held' | 'inaccessible-link';
export interface FlaggedMaterial { id: string; fileName: string; kind: FlagKind; facultyNote: string | null }
export interface FlagInput {
  id: string; fileName: string; extractionStatus: string; indexingStatus: string;
  ignored: boolean; autoSetAside: boolean; extractedText?: string | null; facultyNote?: string | null;
}

export function flagMaterials(materials: FlagInput[]): FlaggedMaterial[] {
  const out: FlaggedMaterial[] = [];
  for (const m of materials) {
    const note = m.facultyNote ?? null;
    const linked = materialProvenance(m) === 'linked';
    // FERPA auto-set-aside: held from scoring, faculty decides to override or leave.
    if (m.ignored && m.autoSetAside) { out.push({ id: m.id, fileName: m.fileName, kind: 'ferpa-held', facultyNote: note }); continue; }
    if (m.ignored) continue; // manual ignore = deliberate, not flagged
    // Linked reference we couldn't fetch (own bucket, checked before extraction-failed).
    if (linked && (m.extractionStatus === 'failed' || (m.indexingStatus === 'skipped' && !m.extractedText))) {
      out.push({ id: m.id, fileName: m.fileName, kind: 'inaccessible-link', facultyNote: note }); continue;
    }
    // Uploaded/canvas file that couldn't be read.
    if (!linked && m.extractionStatus === 'failed') {
      out.push({ id: m.id, fileName: m.fileName, kind: 'extraction-failed', facultyNote: note });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass** (6) + commit

```bash
git add lib/capture/flag-materials.ts tests/lib/capture/flag-materials.test.ts
git commit -m "feat(capture): flagMaterials classifier for the pre-interview gate"
```

---

### Task 4: `MaterialGate` component

**Files:**
- Create: `app/capture/[code]/MaterialGate.tsx`
- Test: `app/capture/[code]/__tests__/MaterialGate.test.tsx`

**Interfaces:**
- Consumes: `FlaggedMaterial`, `FlagKind` (Task 3).
- Produces: `MaterialGate({ flags, onContinue, onBack }: { flags: FlaggedMaterial[]; onContinue: (notes: Record<string,string>, include: string[]) => void; onBack: () => void })`.

- [ ] **Step 1: Write failing test**

```tsx
// app/capture/[code]/__tests__/MaterialGate.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MaterialGate } from '../MaterialGate';

const flags = [
  { id: 'a', fileName: 'deck.pdf', kind: 'extraction-failed' as const, facultyNote: null },
  { id: 'b', fileName: 'WK1.pdf', kind: 'ferpa-held' as const, facultyNote: null },
];

it('renders grouped flags + a single Continue and fires notes on continue', () => {
  const onContinue = vi.fn();
  render(<MaterialGate flags={flags} onContinue={onContinue} onBack={() => {}} />);
  expect(screen.getByText(/deck\.pdf/)).toBeInTheDocument();
  expect(screen.getByText(/WK1\.pdf/)).toBeInTheDocument();
  fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'ok to skip' } });
  fireEvent.click(screen.getByRole('button', { name: /continue to interview/i }));
  expect(onContinue).toHaveBeenCalledWith({ a: 'ok to skip' }, []);
});

it('ferpa item exposes an include-anyway control', () => {
  render(<MaterialGate flags={flags} onContinue={() => {}} onBack={() => {}} />);
  expect(screen.getByRole('button', { name: /include anyway/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```tsx
// app/capture/[code]/MaterialGate.tsx
'use client';
import { useState } from 'react';
import type { FlaggedMaterial, FlagKind } from '@/lib/capture/flag-materials';

const GROUP_LABEL: Record<FlagKind, string> = {
  'extraction-failed': "Couldn't read these files",
  'ferpa-held': 'Held for FERPA review (excluded from scoring)',
  'inaccessible-link': 'Referenced but not accessible',
};
const ORDER: FlagKind[] = ['extraction-failed', 'ferpa-held', 'inaccessible-link'];

export function MaterialGate({
  flags, onContinue, onBack, error,
}: {
  flags: FlaggedMaterial[];
  onContinue: (notes: Record<string, string>, include: string[]) => void;
  onBack: () => void;
  error?: string | null;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [include, setInclude] = useState<Set<string>>(new Set());
  const groups = ORDER.filter((k) => flags.some((f) => f.kind === k));

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-md border bg-card p-6" role="region" aria-label="Material review">
      <div>
        <h2 className="text-lg font-medium">Before you start — a few materials need a look</h2>
        <p className="text-sm text-muted-foreground">
          These won’t contribute to the audit as-is. Proceed anyway, or add a note (optional) explaining each.
        </p>
      </div>
      {groups.map((kind) => (
        <div key={kind} className="space-y-2">
          <p className="text-sm font-medium">{GROUP_LABEL[kind]}</p>
          {flags.filter((f) => f.kind === kind).map((f) => (
            <div key={f.id} className="rounded border bg-muted/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{f.fileName}</span>
                {kind === 'ferpa-held' && (
                  <button
                    type="button"
                    className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-muted"
                    aria-pressed={include.has(f.id)}
                    onClick={() => setInclude((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                      return next;
                    })}
                  >
                    {include.has(f.id) ? 'Will include ✓' : 'Include anyway'}
                  </button>
                )}
              </div>
              <textarea
                className="mt-2 w-full rounded border px-2 py-1 text-sm"
                rows={2}
                placeholder="Optional note (why this is ok, or what you’ll do about it)"
                defaultValue={f.facultyNote ?? ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [f.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between">
        <button type="button" className="text-sm underline" onClick={onBack}>Back to materials</button>
        <button
          type="button"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => {
            const edited = Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim().length > 0));
            onContinue(edited, [...include]);
          }}
        >
          Continue to interview
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** + commit

```bash
git add "app/capture/[code]/MaterialGate.tsx" "app/capture/[code]/__tests__/MaterialGate.test.tsx"
git commit -m "feat(capture): MaterialGate component (pre-interview flags + notes)"
```

---

### Task 5: Wire the gate into the `ingest` landing step

**Files:**
- Modify: `app/capture/[code]/CaptureClient.tsx` (the `landingStep === 'ingest'` branch, ~line 373)
- Modify: `app/capture/[code]/MaterialsPanel.tsx` (`CaptureMaterial` interface: add `facultyNote?: string | null`)
- Modify: the materials source that builds `initialMaterials` (confirm the DB→`CaptureMaterial` mapping includes `faculty_note`; the row already carries it after Task 1)
- Test: reuse `MaterialGate` + `flag-materials` tests; add a `CaptureClient`-level smoke if a harness exists.

**Interfaces:**
- Consumes: `flagMaterials` (Task 3), `MaterialGate` (Task 4), `setLandingStep`, the existing include-anyway + `facultyNote` PATCH (Task 2).

> **Investigate first:** confirm where `CaptureMaterial` is mapped from the DB row (so `facultyNote` flows to the client) — search for the `initialMaterials` prop source and the row→`CaptureMaterial` mapper; add `facultyNote: row.facultyNote` there. Add `facultyNote?: string | null` to the `CaptureMaterial` interface + the `FlagInput`-shaped fields already exist on it.

- [ ] **Step 1: Add `facultyNote` to `CaptureMaterial`** (`MaterialsPanel.tsx`) and to the DB→client mapping, so `materials` carries it.

- [ ] **Step 2: Wire the gate** — in `CaptureClient`, at the `ingest` branch, compute `const flags = flagMaterials(materials)`. Replace the direct advance with:

```tsx
) : isLanding && landingStep === 'ingest' ? (
  flagMaterials(materials).length > 0 && !gatePassed ? (
    <MaterialGate
      flags={flagMaterials(materials)}
      onBack={() => setLandingStep('materials')}
      onContinue={async (notes, include) => {
        try {
          await Promise.all([
            ...Object.entries(notes).map(([id, facultyNote]) =>
              fetch(`/api/courses/${encodeURIComponent(courseCode)}/materials/${id}?slug=${encodeURIComponent(slug)}`,
                { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ facultyNote }) })),
            ...include.map((id) =>
              fetch(`/api/courses/${encodeURIComponent(courseCode)}/materials/${id}?slug=${encodeURIComponent(slug)}`,
                { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ignored: false }) })),
          ]);
          setGatePassed(true);
          setLandingStep('interview');
        } catch { setGateError('Could not save — try again.'); }
      }}
    />
  ) : (
    <IngestStep /* …existing props… */ onIngested={() => setLandingStep('interview')} onBack={() => setLandingStep('materials')} />
  )
) : …
```

Add `const [gatePassed, setGatePassed] = useState(false);` and `const [gateError, setGateError] = useState<string | null>(null);` (surface `gateError` inside `MaterialGate` or above it). Import `flagMaterials` + `MaterialGate`.

- [ ] **Step 3: Verify** — `node_modules/.bin/tsc --noEmit` clean; `node_modules/.bin/vitest run tests/lib/capture "app/capture/[code]/__tests__"` green; manual: a course with a failed/FERPA/inaccessible material shows the gate on the ingest step, a clean course does not.

- [ ] **Step 4: Commit**

```bash
git add "app/capture/[code]/CaptureClient.tsx" "app/capture/[code]/MaterialsPanel.tsx"
git commit -m "feat(capture): wire MaterialGate into the pre-interview ingest step"
```

---

## Verification (whole increment)
- `node_modules/.bin/tsc --noEmit` clean; full capture suite green.
- Manual: (a) clean capture → `ingest` advances with no gate; (b) capture with a failed/FERPA/inaccessible material → gate appears, a note saves (re-open shows it persisted), FERPA include-anyway un-ignores the material, Continue advances to the interview.
- STATE.md: new route field (`facultyNote` on the materials PATCH) + new migration + new `faculty_note` column → update "What's live" / schema surfaces in the same commit as Task 5 (or a follow-up).

## Out of scope (Increment 2)
Threading `faculty_note` into the capture-synthesis context so the scorer sees faculty's explanation of each gap — separate spec/plan.
