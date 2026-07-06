# Capture Review — Calibration Portrait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-competency K/U/D sliders in the capture review panel with a plain-language "portrait" plus an asymmetric, evidence-gated direction-of-error correction, so the review instrument stops inviting instructors to inflate their own scores.

**Architecture:** Add three AI-authored per-dimension sentences (`k_says`/`u_says`/`d_says`) to the existing scoring call. Render them as one woven portrait with a muted `K·U·D` rating. A "Something's off" disclosure reveals a per-dimension flag row: *too high* sets a lower depth immediately (pick a plain-language anchor); *too low* opens a dimension-aware evidence prompt and only then raises the depth, writing the entered text into `evidence_{k,u,d}` — which satisfies the existing `evidence-above-zero` schema refinement and produces a reasoned `upwardBump`. New pure helpers live in `lib/ai/capture/portrait.ts`; the interaction is a new `CompetencyPortrait.tsx` component that replaces the slider grid inside `CompetencyCard`.

**Tech Stack:** Next.js 15 / React, TypeScript strict, Zod, Vitest + jsdom + @testing-library/react. `AI_PROVIDER=openai` strict JSON-schema discipline applies.

**Spec:** [`docs/superpowers/specs/2026-07-06-capture-review-calibration-portrait-design.md`](../specs/2026-07-06-capture-review-calibration-portrait-design.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/ai/capture/schema.ts` | Zod parse schema for the profile | Add `k_says`/`u_says`/`d_says` (nullable) to `captureCompetencySchema` |
| `lib/ai/analyze/capture-scores.ts` | Strict OpenAI **request** JSON schema | Add the 3 fields to the competency `required` + `properties` |
| `lib/ai/prompts/capture-synthesis.md` | Scorer prompt | Add the 3 fields to the JSON template + one authoring instruction |
| `lib/ai/capture/portrait.ts` | **NEW** — pure helpers (weave, anchors, prompts, labels) | Create |
| `app/capture/[code]/CompetencyPortrait.tsx` | **NEW** — portrait + flag row + correction UI | Create |
| `app/capture/[code]/ProfileReviewPanel.tsx` | Review panel | Swap slider grid → `<CompetencyPortrait>`; delete `DepthSlider`; reword confirm + approve-lock copy |
| `tests/lib/ai/capture/portrait.test.ts` | **NEW** — helper unit tests | Create |
| `tests/lib/ai/capture/says-schema.test.ts` | **NEW** — Zod + strict-schema tests | Create |
| `tests/app/capture/competency-portrait.test.tsx` | **NEW** — component tests | Create |

Foundational competencies (`type: 'foundational'`) carry `null` K/U — the portrait renders **Do only** and the flag row shows only "Doing".

---

## Task 1: Add `k_says`/`u_says`/`d_says` to the Zod parse schema

**Files:**
- Modify: `lib/ai/capture/schema.ts` (`captureCompetencySchema`, ~line 95)
- Test: `tests/lib/ai/capture/says-schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/capture/says-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { captureCompetencySchema } from '@/lib/ai/capture/schema';

const base = {
  statement: 'Students analyze packaging requirements',
  type: 'technical' as const,
  k_depth: 3, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz Q4', evidence_u: 'reflection memo', evidence_d: 'graded project',
  rationale: 'because the project shows it',
};

describe('captureCompetencySchema k_says/u_says/d_says', () => {
  it('accepts string sentences', () => {
    const r = captureCompetencySchema.safeParse({
      ...base, k_says: 'Students use the right terms.', u_says: 'They explain why.', d_says: 'They do it independently.',
    });
    expect(r.success).toBe(true);
  });

  it('accepts null (foundational / pre-feature snapshots)', () => {
    const r = captureCompetencySchema.safeParse({
      ...base, type: 'foundational', k_depth: null, u_depth: null,
      k_says: null, u_says: null, d_says: 'Consistently attends to detail.',
    });
    expect(r.success).toBe(true);
  });

  it('parses when the says fields are omitted (backward-compat)', () => {
    const r = captureCompetencySchema.safeParse(base);
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/capture/says-schema.test.ts`
Expected: the first two cases FAIL (unknown keys are stripped, so `.success` is true but the fields are dropped — assert on presence to force failure). Update the first two `it` blocks to also assert the field survives:

```typescript
    expect(r.success && r.data.k_says).toBe('Students use the right terms.');
```
and for null:
```typescript
    expect(r.success && r.data.d_says).toBe('Consistently attends to detail.');
```
Re-run; now they FAIL with the fields `undefined` because the schema doesn't define them yet.

- [ ] **Step 3: Add the fields to the schema**

In `lib/ai/capture/schema.ts`, inside `captureCompetencySchema`'s `.object({...})` (after `d_depth: depthSchema,` on line 101, grouping them with the other per-dimension fields), add:

```typescript
    k_says: z.string().nullable(),
    u_says: z.string().nullable(),
    d_says: z.string().nullable(),
```

Leave the `.refine(...)` evidence-above-zero rules unchanged — the `says` fields are free-form and carry no invariant.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/capture/says-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/capture/schema.ts tests/lib/ai/capture/says-schema.test.ts
git commit -m "feat(capture): add k_says/u_says/d_says to competency parse schema"
```

---

## Task 2: Add the 3 fields to the strict request schema + prompt

**Files:**
- Modify: `lib/ai/analyze/capture-scores.ts` (competency `required` ~lines 86–98, `properties` ~lines 99–111)
- Modify: `lib/ai/prompts/capture-synthesis.md` (JSON template ~lines 62–69)
- Test: `tests/lib/ai/capture/says-schema.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/ai/capture/says-schema.test.ts`:

```typescript
import { captureProfileJsonSchema } from '@/lib/ai/analyze/capture-scores';

describe('strict request schema — competency says fields', () => {
  const comp = (captureProfileJsonSchema as any).properties.competencies.items;

  it('lists k_says/u_says/d_says in required', () => {
    for (const f of ['k_says', 'u_says', 'd_says']) {
      expect(comp.required).toContain(f);
    }
  });

  it('declares them as nullable string in properties', () => {
    for (const f of ['k_says', 'u_says', 'd_says']) {
      expect(comp.properties[f]).toEqual({ type: ['string', 'null'] });
    }
  });

  it('keeps required and properties in sync (strict-mode invariant)', () => {
    expect(new Set(comp.required)).toEqual(new Set(Object.keys(comp.properties)));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/capture/says-schema.test.ts`
Expected: the new `describe` FAILS (`required` lacks the fields; `properties[f]` is undefined).

- [ ] **Step 3: Add the fields to the strict request schema**

In `lib/ai/analyze/capture-scores.ts`, in the `competencies.items` object:

Add to the `required` array (after `'d_depth',` ~line 91):
```typescript
          'k_says',
          'u_says',
          'd_says',
```

Add to `properties` (after `d_depth: { type: 'integer', minimum: 0, maximum: 5 },` ~line 104):
```typescript
          k_says: { type: ['string', 'null'] },
          u_says: { type: ['string', 'null'] },
          d_says: { type: ['string', 'null'] },
```

- [ ] **Step 4: Update the scorer prompt**

In `lib/ai/prompts/capture-synthesis.md`, in the competencies JSON template (~lines 62–69, alongside `"evidence_k"`), add three lines:
```
      "k_says": "<one sentence in 'your students…' voice describing what the assigned K level looks like FOR THIS competency, grounded in the cited evidence — or null for foundational> ",
      "u_says": "<same, for U — or null for foundational>",
      "d_says": "<same, for D>",
```

Immediately after the competency-authoring guidance in that prompt, add an instruction block:
```
### Per-dimension plain-language sentences (k_says / u_says / d_says)

For each dimension you scored, write ONE sentence translating that dimension's
assigned depth level into what it concretely means for THIS competency, in
"your students…" voice, grounded in the evidence you cited — never syllabus
aspiration. Example for U at level 2 on a packaging-analysis competency:
"They can explain in their own words why a positioning feature matters, but
wouldn't yet reason through an unfamiliar package type." For foundational
competencies, set k_says and u_says to null (only d_says is written).
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/capture/says-schema.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/analyze/capture-scores.ts lib/ai/prompts/capture-synthesis.md tests/lib/ai/capture/says-schema.test.ts
git commit -m "feat(capture): emit k_says/u_says/d_says from the scoring call (strict schema + prompt)"
```

---

## Task 3: Pure portrait helpers

**Files:**
- Create: `lib/ai/capture/portrait.ts`
- Test: `tests/lib/ai/capture/portrait.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/capture/portrait.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { portraitClauses, lowerAnchorOptions, evidencePromptFor, dimLabel } from '@/lib/ai/capture/portrait';

const technical: CaptureCompetency = {
  statement: 'Analyze packaging requirements',
  type: 'technical',
  k_depth: 4, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz', evidence_u: 'memo', evidence_d: 'project',
  rationale: 'x',
  k_says: 'They use the right terms.', u_says: 'They explain why.', d_says: 'They do it on familiar cases.',
};

describe('portraitClauses', () => {
  it('returns one clause per scored dimension for a technical competency', () => {
    const cs = portraitClauses(technical);
    expect(cs.map(c => c.dim)).toEqual(['k', 'u', 'd']);
    expect(cs.map(c => c.text)).toEqual(['They use the right terms.', 'They explain why.', 'They do it on familiar cases.']);
  });

  it('renders Do-only for a foundational competency', () => {
    const f: CaptureCompetency = { ...technical, type: 'foundational', k_depth: null, u_depth: null, k_says: null, u_says: null, d_says: 'Consistently attends to detail.' };
    const cs = portraitClauses(f);
    expect(cs.map(c => c.dim)).toEqual(['d']);
    expect(cs[0]!.text).toBe('Consistently attends to detail.');
  });

  it('falls back to the generic depth anchor when a says field is null', () => {
    const legacy: CaptureCompetency = { ...technical, u_says: null };
    const cs = portraitClauses(legacy);
    const u = cs.find(c => c.dim === 'u')!;
    expect(u.text).toBe('Explains the rationale in own words'); // describeDepth('u', 2)
    expect(u.fallback).toBe(true);
  });
});

describe('lowerAnchorOptions', () => {
  it('lists every level below the current one, with anchor text', () => {
    const opts = lowerAnchorOptions('u', 2);
    expect(opts.map(o => o.level)).toEqual([0, 1]);
    expect(opts[1]!.text).toBe('Restates the explanation as given'); // describeDepth('u', 1)
  });

  it('returns empty when the current level is 0', () => {
    expect(lowerAnchorOptions('d', 0)).toEqual([]);
  });
});

describe('evidencePromptFor', () => {
  it('is dimension-specific', () => {
    expect(evidencePromptFor('k')).toMatch(/exam|quiz|item/i);
    expect(evidencePromptFor('u')).toMatch(/explanation|reasoning/i);
    expect(evidencePromptFor('d')).toMatch(/artifact|rubric|graded/i);
  });
});

describe('dimLabel', () => {
  it('maps k/u/d to friendly labels', () => {
    expect([dimLabel('k'), dimLabel('u'), dimLabel('d')]).toEqual(['Naming', 'Reasoning', 'Doing']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/capture/portrait.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/capture/portrait'`.

- [ ] **Step 3: Implement the helpers**

Create `lib/ai/capture/portrait.ts`:

```typescript
/**
 * Pure helpers for the calibration-portrait review UI. No React — unit-testable.
 * The portrait is the AI's per-dimension `*_says` sentences, with a graceful
 * fallback to the generic depth anchor for pre-feature snapshots. Correction is
 * expressed by picking a plain-language anchor (never a slider/number).
 */
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { describeDepth, type Dimension } from '@/lib/ai/capture/depth-anchors';

export interface PortraitClause {
  dim: Dimension;
  /** The sentence to show — the AI's `*_says`, or the generic anchor as fallback. */
  text: string;
  /** True when we fell back to the generic anchor (no `*_says` on this snapshot). */
  fallback: boolean;
}

const DIM_LABEL: Record<Dimension, string> = { k: 'Naming', u: 'Reasoning', d: 'Doing' };
export function dimLabel(dim: Dimension): string {
  return DIM_LABEL[dim];
}

/** Ordered clauses for the woven portrait. Skips null-depth dimensions (foundational K/U). */
export function portraitClauses(c: CaptureCompetency): PortraitClause[] {
  const rows: { dim: Dimension; depth: number | null; says: string | null }[] = [
    { dim: 'k', depth: c.k_depth, says: c.k_says ?? null },
    { dim: 'u', depth: c.u_depth, says: c.u_says ?? null },
    { dim: 'd', depth: c.d_depth, says: c.d_says ?? null },
  ];
  const out: PortraitClause[] = [];
  for (const r of rows) {
    if (r.depth === null) continue; // unscored (foundational K/U) — hidden, never zero
    if (r.says && r.says.trim().length > 0) {
      out.push({ dim: r.dim, text: r.says.trim(), fallback: false });
    } else {
      out.push({ dim: r.dim, text: describeDepth(r.dim, r.depth), fallback: true });
    }
  }
  return out;
}

export interface AnchorOption { level: number; text: string; }

/** Every level strictly below `current`, with its anchor text — the "too high" pick list. */
export function lowerAnchorOptions(dim: Dimension, current: number): AnchorOption[] {
  const out: AnchorOption[] = [];
  for (let level = 0; level < current; level++) {
    out.push({ level, text: describeDepth(dim, level) });
  }
  return out;
}

/** Dimension-aware evidence prompt shown before a "too low" raise is allowed. */
export function evidencePromptFor(dim: Dimension): string {
  switch (dim) {
    case 'k':
      return 'What shows students reach a higher level here? An exam or quiz item they answered correctly.';
    case 'u':
      return 'What shows students reason at a higher level here? A student explanation, or a reasoning-based exam item.';
    case 'd':
      return 'What shows students perform at a higher level here? A graded artifact or a completed rubric.';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/capture/portrait.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/capture/portrait.ts tests/lib/ai/capture/portrait.test.ts
git commit -m "feat(capture): pure portrait helpers (weave, anchors, evidence prompts)"
```

---

## Task 4: `CompetencyPortrait` component

**Files:**
- Create: `app/capture/[code]/CompetencyPortrait.tsx`
- Test: `tests/app/capture/competency-portrait.test.tsx` (create)

This component replaces the slider grid. It renders the portrait + muted rating, a "Something's off" disclosure, and the per-dimension flag row. It drives the same `onChange(next: CaptureCompetency)` the sliders drove.

- [ ] **Step 1: Write the failing test**

Create `tests/app/capture/competency-portrait.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { CompetencyPortrait } from '@/app/capture/[code]/CompetencyPortrait';

const comp: CaptureCompetency = {
  statement: 'Analyze packaging requirements',
  type: 'technical',
  k_depth: 4, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz', evidence_u: 'memo', evidence_d: 'project',
  rationale: 'x',
  k_says: 'They use the right terms.', u_says: 'They explain why.', d_says: 'They do it on familiar cases.',
};

describe('CompetencyPortrait', () => {
  it('shows the woven portrait sentences and a muted rating', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    expect(screen.getByText(/They use the right terms\./)).toBeInTheDocument();
    expect(screen.getByText(/K4 · U2 · D3/)).toBeInTheDocument();
    // No slider affordance:
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });

  it('hides the flag row until "Something\'s off"', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    expect(screen.queryByText('Reasoning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
  });

  it('"too high" applies a lower depth immediately, no evidence needed', () => {
    const onChange = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    const row = screen.getByTestId('flag-row-u');
    fireEvent.click(within(row).getByRole('button', { name: /too high/i }));
    // pick the U1 anchor:
    fireEvent.click(screen.getByRole('button', { name: /Restates the explanation as given/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ u_depth: 1 }));
  });

  it('"too low" is gated: raises depth only after evidence is entered, and writes evidence_u', () => {
    const onChange = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    const row = screen.getByTestId('flag-row-u');
    fireEvent.click(within(row).getByRole('button', { name: /too low/i }));
    // Commit is disabled with no evidence:
    const commit = screen.getByRole('button', { name: /raise/i });
    expect(commit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /evidence/i }), { target: { value: 'unit-3 exam Q7, class mean 82%' } });
    expect(commit).toBeEnabled();
    fireEvent.click(commit);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ u_depth: 3, evidence_u: 'unit-3 exam Q7, class mean 82%' }));
  });

  it('renders Do-only for a foundational competency', () => {
    const f: CaptureCompetency = { ...comp, type: 'foundational', k_depth: null, u_depth: null, k_says: null, u_says: null, d_says: 'Consistently attends to detail.' };
    render(<CompetencyPortrait competency={f} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    expect(screen.getByText('Doing')).toBeInTheDocument();
    expect(screen.queryByText('Naming')).toBeNull();
    expect(screen.queryByText('Reasoning')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/app/capture/competency-portrait.test.tsx`
Expected: FAIL — `Cannot find module '.../CompetencyPortrait'`.

- [ ] **Step 3: Implement the component**

Create `app/capture/[code]/CompetencyPortrait.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import type { Dimension } from '@/lib/ai/capture/depth-anchors';
import { portraitClauses, lowerAnchorOptions, evidencePromptFor, dimLabel } from '@/lib/ai/capture/portrait';

/** The dimensions that are scored for this competency (foundational → Do only). */
function scoredDims(c: CaptureCompetency): Dimension[] {
  const dims: Dimension[] = [];
  if (c.k_depth !== null) dims.push('k');
  if (c.u_depth !== null) dims.push('u');
  dims.push('d');
  return dims;
}

function depthOf(c: CaptureCompetency, dim: Dimension): number {
  return (dim === 'k' ? c.k_depth : dim === 'u' ? c.u_depth : c.d_depth) ?? 0;
}
function withDepth(c: CaptureCompetency, dim: Dimension, level: number): CaptureCompetency {
  return dim === 'k' ? { ...c, k_depth: level } : dim === 'u' ? { ...c, u_depth: level } : { ...c, d_depth: level };
}
function withEvidence(c: CaptureCompetency, dim: Dimension, text: string): CaptureCompetency {
  return dim === 'k' ? { ...c, evidence_k: text } : dim === 'u' ? { ...c, evidence_u: text } : { ...c, evidence_d: text };
}

function ratingLabel(c: CaptureCompetency): string {
  const k = c.k_depth === null ? '–' : c.k_depth;
  const u = c.u_depth === null ? '–' : c.u_depth;
  return c.type === 'foundational' ? `D${c.d_depth}` : `K${k} · U${u} · D${c.d_depth}`;
}

type Mode = null | { dim: Dimension; dir: 'high' | 'low' };

export function CompetencyPortrait({
  competency,
  onChange,
}: {
  competency: CaptureCompetency;
  onChange: (next: CaptureCompetency) => void;
}) {
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [evidence, setEvidence] = useState('');

  const clauses = portraitClauses(competency);
  const dims = scoredDims(competency);

  function chooseLower(dim: Dimension, level: number) {
    onChange(withDepth(competency, dim, level));
    setMode(null);
  }
  function raiseWithEvidence(dim: Dimension) {
    const current = depthOf(competency, dim);
    const next = Math.min(5, current + 1);
    onChange(withEvidence(withDepth(competency, dim, next), dim, evidence.trim()));
    setMode(null);
    setEvidence('');
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed text-foreground">
          {clauses.map((cl) => (
            <span key={cl.dim} className={cl.fallback ? 'italic text-muted-foreground' : undefined}>
              {cl.text}{' '}
            </span>
          ))}
        </p>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ratingLabel(competency)}</span>
      </div>

      {!flagsOpen && (
        <button
          type="button"
          onClick={() => setFlagsOpen(true)}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Something&apos;s off ▾
        </button>
      )}

      {flagsOpen && (
        <div className="space-y-2 rounded-md border border-muted bg-muted/30 p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Which part?</p>
          {dims.map((dim) => {
            const isActive = mode?.dim === dim;
            return (
              <div key={dim} data-testid={`flag-row-${dim}`} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-20 font-medium">{dimLabel(dim)}</span>
                  <button
                    type="button"
                    onClick={() => setMode(isActive && mode?.dir === 'high' ? null : { dim, dir: 'high' })}
                    className="rounded border border-input px-2 py-0.5 hover:bg-background"
                  >
                    too high
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEvidence(''); setMode(isActive && mode?.dir === 'low' ? null : { dim, dir: 'low' }); }}
                    className="rounded border border-input px-2 py-0.5 hover:bg-background"
                  >
                    too low
                  </button>
                </div>

                {isActive && mode?.dir === 'high' && (
                  <div className="ml-20 space-y-1">
                    <p className="text-[11px] text-muted-foreground">More like:</p>
                    {lowerAnchorOptions(dim, depthOf(competency, dim)).map((opt) => (
                      <button
                        key={opt.level}
                        type="button"
                        onClick={() => chooseLower(dim, opt.level)}
                        className="block w-full rounded border border-input px-2 py-1 text-left text-[11px] hover:bg-background"
                      >
                        {opt.text}
                      </button>
                    ))}
                  </div>
                )}

                {isActive && mode?.dir === 'low' && (
                  <div className="ml-20 space-y-1">
                    <label className="block text-[11px] text-muted-foreground" htmlFor={`ev-${dim}`}>
                      {evidencePromptFor(dim)}
                    </label>
                    <textarea
                      id={`ev-${dim}`}
                      aria-label={`evidence for ${dimLabel(dim)}`}
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      disabled={evidence.trim().length === 0}
                      onClick={() => raiseWithEvidence(dim)}
                      className="rounded border border-amber-600 bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40"
                    >
                      Raise {dimLabel(dim)}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/app/capture/competency-portrait.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/capture/[code]/CompetencyPortrait.tsx tests/app/capture/competency-portrait.test.tsx
git commit -m "feat(capture): CompetencyPortrait — de-slidered K/U/D review with evidence-gated raise"
```

---

## Task 5: Wire the portrait into the review panel; remove the sliders

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx` (`CompetencyCard` slider grid ~lines 494–518; `DepthSlider` component ~lines 275–323; confirm button copy ~line 1394; approve-lock title ~line 1109)

- [ ] **Step 1: Write the failing test**

Do **not** hand-guess the panel's props. Open the existing `tests/app/capture/profile-review-confirm.test.tsx` — it already mounts `ProfileReviewPanel` with a valid profile and the full prop set. Create `tests/app/capture/competency-card-portrait.test.tsx` by copying that file's imports + render setup verbatim, then (a) ensure the profile's single competency carries `k_says`/`u_says`/`d_says` (add them to the fixture if absent), and (b) replace the body with these two assertions:

```tsx
  it('shows the portrait sentence and renders no range sliders', () => {
    // …identical mount to profile-review-confirm.test.tsx, with k_says set…
    expect(screen.getByText(/They use the right terms\./)).toBeInTheDocument();
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });
```

The point of reusing that file's setup is that its prop set is already correct and maintained; you only swap the fixture's `*_says` and the assertions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/app/capture/competency-card-portrait.test.tsx`
Expected: FAIL — an `input[type="range"]` is still rendered by `CompetencyCard`.

- [ ] **Step 3: Replace the slider grid with the portrait**

In `app/capture/[code]/ProfileReviewPanel.tsx`, add the import near the other capture imports (~line 18):
```tsx
import { CompetencyPortrait } from './CompetencyPortrait';
```

Replace the entire slider grid block in `CompetencyCard` (the `<div className="grid grid-cols-3 gap-4">…</div>` containing the three `<DepthSlider>` elements, ~lines 494–518) with:
```tsx
      <CompetencyPortrait competency={competency} onChange={onChange} />
```

- [ ] **Step 4: Delete the now-unused `DepthSlider` component**

Remove the `DepthSlider` function (and its props interface), ~lines 275–323, and the now-unused `describeDepth` / `Dimension` import on line 18 **only if** nothing else in the file references them (grep first: `grep -n 'describeDepth\|DepthSlider' app/capture/[code]/ProfileReviewPanel.tsx`). If `describeDepth` is still used elsewhere in the file, keep the import.

- [ ] **Step 5: Reword the confirm button + approve-lock copy**

Line ~1394, change the confirm button label:
```tsx
                      {reviewed.has(i) ? '✓ Confirmed' : '✓ Sounds like them'}
```

Line ~1109, change `approveLockTitle` to reflect affirm-or-correct:
```tsx
  const approveLockTitle = "Review before approving — for each 'Worth a look' card, mark ✓ Sounds like them or use 'Something's off' to correct a dimension, or add a departmental-context note. (Approval is an epistemic act, not a click-through.)";
```

Line ~1347 helper text (`mark each Looks right ✓`) — update to:
```tsx
              mark each ✓ Sounds like them. The confident rows are rolled up — click any to edit.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run tests/app/capture/competency-card-portrait.test.tsx tests/app/capture/competency-portrait.test.tsx`
Expected: PASS. Then run the existing panel tests to catch regressions:
Run: `pnpm vitest run tests/app/capture/`
Expected: PASS (fix any test that asserted on the old slider copy — e.g. `profile-review-confirm.test.tsx` if it clicked "Looks right ✓": update its query to "Sounds like them").

- [ ] **Step 7: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors (confirms `DepthSlider`/`describeDepth` removal left no dangling refs).

- [ ] **Step 8: Commit**

```bash
git add app/capture/[code]/ProfileReviewPanel.tsx tests/app/capture/competency-card-portrait.test.tsx
git commit -m "feat(capture): swap the K/U/D sliders for the calibration portrait in the review panel"
```

---

## Task 6: Full suite, STATE.md, final commit

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Run the full test suite**

Run: `pnpm vitest run`
Expected: all green. Fix any remaining copy-based assertions ("Looks right" → "Sounds like them"; any test asserting slider presence).

- [ ] **Step 2: Update STATE.md**

In `docs/STATE.md`, under the capture/review section of **What's live** (and/or **Recently shipped**), add a line noting: the per-competency review card now renders an AI-authored plain-language portrait with an asymmetric, evidence-gated direction-of-error correction (replacing the K/U/D sliders); new scoring fields `k_says`/`u_says`/`d_says` (strict-schema, nullable); new files `lib/ai/capture/portrait.ts` + `app/capture/[code]/CompetencyPortrait.tsx`. If any piece was deferred, record it under **Deferred / debt** (e.g. "per-dimension 'affirmed' verdict not stored — YAGNI, additive later" from the spec's Out-of-scope).

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): capture review portrait shipped — de-slidered K/U/D + k/u/d_says"
```

---

## Notes for the implementer

- **Do not change the `.refine()` evidence-above-zero rules** in `schema.ts`. The "too low → evidence" gate is enforced by the *UI* (commit button disabled until evidence is entered) writing into `evidence_{k,u,d}`; the schema refinement is the backstop that already exists.
- **The affirmation ("Sounds like them") stays a panel-level button** (the existing `markReviewed` / `reviewed` set). The portrait component owns only the *correction* affordance. This is intentional (minimal blast radius); the spec's mockup shows the two adjacent, and they render adjacent (portrait's "Something's off" inside the card, the confirm button directly below it).
- **`onChange` semantics are unchanged** from the sliders: it mutates the `working` draft in place; `upwardBumps` / `assembleOverrides` / the approval reasoned-bump guard all keep working because a "too low" raise now writes `evidence_{dim}` and produces the same upward delta the slider used to.
- **Foundational competencies:** `portraitClauses` and `scoredDims` already skip null K/U, so the Do-only rendering is automatic — no special-casing in the panel.
```
