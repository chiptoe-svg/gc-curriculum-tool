# K/U/D Override Rationale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a per-competency written rationale whenever a faculty raises a K/U/D score above the AI/baseline value, block Approve until every upward bump is justified, and freeze each override (AI value → faculty value → why) into the snapshot.

**Architecture:** A pure helper (`lib/ai/capture/score-overrides.ts`) diffs the session baseline (`profile` prop) against the live `working` profile to find upward bumps and assemble `ReviewerOverride` audit records. `ProfileReviewPanel` keeps a per-competency reason map, renders an inline required reason field on bumped rows (with a level-aware hint parsed from the course code), folds `allUpwardBumpsJustified` into the existing `approveUnlocked` guard, and attaches `reviewer_overrides` to the profile at save time. New optional `reviewer_overrides` field on `CaptureProfile` (JSON; no migration).

**Tech Stack:** TypeScript strict, Zod, React (Next.js client component), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-16-kud-override-rationale-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `lib/ai/capture/schema.ts` | Add `reviewerOverrideSchema` + `ReviewerOverride` type + optional `reviewer_overrides` field on `captureProfileSchema` |
| `lib/ai/capture/score-overrides.ts` (new) | Pure `upwardBumps(baseline, working)` + `assembleOverrides(baseline, working, reasons)` — no React, no I/O |
| `app/capture/[code]/ProfileReviewPanel.tsx` | Reason-map state; inline reason field on bumped rows (level-aware hint); `allUpwardBumpsJustified` gate; attach `reviewer_overrides` at persist; seed reasons on load |
| `tests/lib/ai/capture/score-overrides.test.ts` (new) | Unit tests for both helpers |
| `tests/app/capture/override-rationale.test.tsx` (new) | Panel test: Approve gated on rationale |

---

## Task 1: Schema field + pure detection/assembly helpers

**Files:**
- Modify: `lib/ai/capture/schema.ts` (add schema + field)
- Create: `lib/ai/capture/score-overrides.ts`
- Test: `tests/lib/ai/capture/score-overrides.test.ts`

- [ ] **Step 1: Add the schema + field**

In `lib/ai/capture/schema.ts`, immediately **before** `export const captureProfileSchema = z.object({`, add:

```ts
/**
 * A faculty override of one competency's K/U/D scores recorded at review time:
 * what changed (AI value → faculty value, per dimension) and why. Frozen into
 * the snapshot as a permanent audit record. See
 * docs/superpowers/specs/2026-06-16-kud-override-rationale-design.md.
 */
export const reviewerOverrideSchema = z.object({
  statement: z.string(),
  changes: z.array(z.object({
    dim: z.enum(['k', 'u', 'd']),
    from: z.number(),
    to: z.number(),
  })).min(1),
  reason: z.string().min(1),
});
export type ReviewerOverride = z.infer<typeof reviewerOverrideSchema>;
```

Then inside `captureProfileSchema`, add this field right after the `class_structure: classStructureSchema.nullable().optional(),` line:

```ts
  /**
   * Faculty rationales for any upward K/U/D override made at review time.
   * Nullable/optional: pre-2026-06-16 profiles + profiles with no upward edits
   * won't have it. Populated by ProfileReviewPanel at save; frozen into snapshots.
   */
  reviewer_overrides: z.array(reviewerOverrideSchema).nullable().optional(),
```

- [ ] **Step 2: Write the failing helper tests**

Create `tests/lib/ai/capture/score-overrides.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { upwardBumps, assembleOverrides } from '@/lib/ai/capture/score-overrides';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';

function comp(o: Partial<CaptureCompetency>): CaptureCompetency {
  return {
    statement: 'Mixes spot-color inks', type: 'technical',
    k_depth: 2, u_depth: 2, d_depth: 2,
    evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r',
    ...o,
  } as CaptureCompetency;
}

describe('upwardBumps', () => {
  it('flags a single upward dimension with from/to', () => {
    const base = [comp({ d_depth: 2 })];
    const work = [comp({ d_depth: 4 })];
    const bumps = upwardBumps(base, work);
    expect(bumps).toHaveLength(1);
    expect(bumps[0]!.changes).toEqual([{ dim: 'd', from: 2, to: 4 }]);
    expect(bumps[0]!.index).toBe(0);
  });

  it('ignores downward and unchanged edits', () => {
    const base = [comp({ k_depth: 3, u_depth: 2, d_depth: 2 })];
    const work = [comp({ k_depth: 1, u_depth: 2, d_depth: 2 })]; // K down, rest same
    expect(upwardBumps(base, work)).toEqual([]);
  });

  it('captures multiple bumped dimensions in one entry', () => {
    const base = [comp({ k_depth: 1, u_depth: 1, d_depth: 1 })];
    const work = [comp({ k_depth: 3, u_depth: 1, d_depth: 4 })]; // K up, U same, D up
    const bumps = upwardBumps(base, work);
    expect(bumps[0]!.changes).toEqual([{ dim: 'k', from: 1, to: 3 }, { dim: 'd', from: 1, to: 4 }]);
  });

  it('handles foundationals (null K/U) — only D can bump', () => {
    const base = [comp({ type: 'foundational', k_depth: null, u_depth: null, d_depth: 1, evidence_k: null, evidence_u: null })];
    const work = [comp({ type: 'foundational', k_depth: null, u_depth: null, d_depth: 3, evidence_k: null, evidence_u: null })];
    const bumps = upwardBumps(base, work);
    expect(bumps[0]!.changes).toEqual([{ dim: 'd', from: 1, to: 3 }]);
  });
});

describe('assembleOverrides', () => {
  it('records only bumped rows that have a non-empty reason', () => {
    const base = [comp({ statement: 'A', d_depth: 2 }), comp({ statement: 'B', d_depth: 2 })];
    const work = [comp({ statement: 'A', d_depth: 4 }), comp({ statement: 'B', d_depth: 4 })];
    const reasons = new Map<number, string>([[0, 'capstone press checks'], [1, '   ']]);
    const out = assembleOverrides(base, work, reasons);
    expect(out).toEqual([
      { statement: 'A', changes: [{ dim: 'd', from: 2, to: 4 }], reason: 'capstone press checks' },
    ]);
  });

  it('returns [] when nothing was bumped', () => {
    const base = [comp({ d_depth: 2 })];
    expect(assembleOverrides(base, base, new Map())).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

Run: `pnpm vitest run tests/lib/ai/capture/score-overrides.test.ts`
Expected: FAIL — `@/lib/ai/capture/score-overrides` not found.

- [ ] **Step 4: Implement the helpers**

Create `lib/ai/capture/score-overrides.ts`:

```ts
import type { CaptureCompetency, ReviewerOverride } from '@/lib/ai/capture/schema';

export interface OverrideChange { dim: 'k' | 'u' | 'd'; from: number; to: number; }
export interface UpwardBump { index: number; statement: string; changes: OverrideChange[]; }

/**
 * Find competencies whose K/U/D moved UP from the baseline. Matched by index
 * (the review panel edits competencies in place — never reorders/adds/removes).
 * Foundationals carry null K/U (only D is meaningful), so null dimensions are
 * skipped. Downward/unchanged edits produce nothing.
 */
export function upwardBumps(
  baseline: CaptureCompetency[],
  working: CaptureCompetency[],
): UpwardBump[] {
  const out: UpwardBump[] = [];
  for (let i = 0; i < working.length; i++) {
    const b = baseline[i];
    const w = working[i];
    if (!b || !w) continue;
    const dims: { dim: 'k' | 'u' | 'd'; from: number | null; to: number | null }[] = [
      { dim: 'k', from: b.k_depth, to: w.k_depth },
      { dim: 'u', from: b.u_depth, to: w.u_depth },
      { dim: 'd', from: b.d_depth, to: w.d_depth },
    ];
    const changes: OverrideChange[] = [];
    for (const { dim, from, to } of dims) {
      if (from != null && to != null && to > from) changes.push({ dim, from, to });
    }
    if (changes.length > 0) out.push({ index: i, statement: w.statement, changes });
  }
  return out;
}

/**
 * Build the ReviewerOverride[] audit records: each upward-bumped competency
 * paired with its (trimmed, non-empty) reason. Bumps without a reason are
 * omitted — at approval the guard ensures every bump is reasoned, so all are
 * recorded; on a draft save, only the reasoned ones persist.
 */
export function assembleOverrides(
  baseline: CaptureCompetency[],
  working: CaptureCompetency[],
  reasons: Map<number, string>,
): ReviewerOverride[] {
  return upwardBumps(baseline, working)
    .map(b => ({ statement: b.statement, changes: b.changes, reason: (reasons.get(b.index) ?? '').trim() }))
    .filter(o => o.reason.length > 0);
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm vitest run tests/lib/ai/capture/score-overrides.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "score-overrides|capture/schema"` → no output.

```bash
git add lib/ai/capture/schema.ts lib/ai/capture/score-overrides.ts tests/lib/ai/capture/score-overrides.test.ts
git commit -m "feat(capture): reviewer_overrides schema + upwardBumps/assembleOverrides helpers"
```

---

## Task 2: Wire the rationale gate + inline field into ProfileReviewPanel

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx`
- Test: `tests/app/capture/override-rationale.test.tsx` (new)

Context: the panel holds `working` (live edits) and `profile` (session baseline). `dirty`, `approveUnlocked`, `persist()`, `handleConfirmAndSnapshot()`, and `renderInlineSave()` already exist (around lines 1006–1120). The competency list maps `working.competencies` and renders a `<CompetencyCard>` for needsReview rows (always) and expanded confident rows.

- [ ] **Step 1: Add imports + reason-map state + derived gates**

Add to the import block near the other `@/lib/ai/capture/*` imports:

```ts
import { upwardBumps, assembleOverrides } from '@/lib/ai/capture/score-overrides';
```

Inside the component, near the other `useState` calls (alongside `reviewed`/`expanded`, ~line 945), add — seeding from any existing `reviewer_overrides` (re-review) by matching statements to the current competency indices:

```ts
  const [overrideReasons, setOverrideReasons] = useState<Map<number, string>>(() => {
    const seed = new Map<number, string>();
    const existing = (profile.reviewer_overrides ?? []) as { statement: string; reason: string }[];
    if (existing.length) {
      profile.competencies.forEach((c, i) => {
        const m = existing.find(o => o.statement === c.statement);
        if (m) seed.set(i, m.reason);
      });
    }
    return seed;
  });
  function setReason(i: number, text: string) {
    setOverrideReasons(prev => { const n = new Map(prev); n.set(i, text); return n; });
  }
```

Then, right after the existing `allWorthLookReviewed` / `approveUnlocked` lines (~1083), insert the bump detection + the gate fix. **Replace** the existing `approveUnlocked` assignment with the version that ANDs in the justification requirement:

```ts
  // Upward K/U/D bumps vs the session baseline (profile prop). Each must carry a
  // reason before the profile can be approved — fixes the inverted A15 guard
  // where a bare edit unlocked Approve with no justification.
  const bumps = useMemo(
    () => upwardBumps(profile.competencies, working.competencies),
    [profile.competencies, working.competencies],
  );
  const bumpByIndex = useMemo(() => new Map(bumps.map(b => [b.index, b])), [bumps]);
  const unjustifiedBumpCount = bumps.filter(b => (overrideReasons.get(b.index) ?? '').trim().length === 0).length;
  const allUpwardBumpsJustified = unjustifiedBumpCount === 0;
```

Find the existing line:
```ts
  const approveUnlocked = dirty || allWorthLookReviewed || noteSubstantive;
```
and change it to:
```ts
  const approveUnlocked = (dirty || allWorthLookReviewed || noteSubstantive) && allUpwardBumpsJustified;
```

- [ ] **Step 2: Add a level-aware reason-field renderer**

Right after the `renderInlineSave()` function (~line 1110), add:

```ts
  // Course level band parsed from the code (e.g. "GC 2400" → 2000). Used only
  // to sharpen the hint when a lower-level course is pushed to high depth.
  const courseLevelBand = (() => {
    const m = (working.course_code ?? '').match(/\b(\d{4})\b/);
    return m ? Math.floor(parseInt(m[1]!, 10) / 1000) * 1000 : null;
  })();

  /** Inline required reason for a row whose score(s) were bumped up. */
  function renderOverrideReason(i: number) {
    const bump = bumpByIndex.get(i);
    if (!bump) return null;
    const summary = bump.changes.map(c => `${c.dim.toUpperCase()} ${c.from} → ${c.to}`).join(' · ');
    const high = bump.changes.some(c => c.to >= 3);
    const hint = courseLevelBand !== null && courseLevelBand <= 2000 && high
      ? `This is a ${courseLevelBand}-level course — a depth of 3+ is unusual here. Cite the assignment, rubric, or graded artifact that supports it.`
      : 'Cite the student-side evidence that supports this higher depth.';
    const missing = (overrideReasons.get(i) ?? '').trim().length === 0;
    return (
      <div className={'mt-1 rounded-md border p-2 ' + (missing ? 'border-amber-400 bg-amber-50' : 'border-muted bg-muted/30')}>
        <label className="block text-[11px] font-medium text-amber-900">
          ⚑ You raised a score ({summary}) — why? <span className="font-normal text-amber-700">{hint}</span>
        </label>
        <textarea
          value={overrideReasons.get(i) ?? ''}
          onChange={e => setReason(i, e.target.value)}
          rows={2}
          placeholder="Reason for the higher depth (required to approve)"
          className="mt-1 w-full resize-none rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    );
  }
```

- [ ] **Step 3: Render the reason field on both card zones**

In the **needsReview** block, immediately after the `<StressTestBadge ... />` and before the `<div className="flex justify-end gap-2">` confirm footer, insert:

```tsx
                  {renderOverrideReason(i)}
```

In the **confident expanded** block, immediately after its `<StressTestBadge ... />` (and before the `{dirty && <div className="flex justify-end">{renderInlineSave()}</div>}` line), insert:

```tsx
                {renderOverrideReason(i)}
```

- [ ] **Step 4: Surface the gate on the Approve button + attach overrides at save**

Find the Approve button's lock hint (the `{!approveUnlocked && (<span ...>Locked until reviewed — hover for what counts.</span>)}` near line ~1652) and change the span text to name the bump case:

```tsx
            {!approveUnlocked && (
              <span className="text-[11px] text-muted-foreground">
                {unjustifiedBumpCount > 0
                  ? `${unjustifiedBumpCount} raised score${unjustifiedBumpCount === 1 ? '' : 's'} need a reason before you can approve.`
                  : 'Locked until reviewed — hover for what counts.'}
              </span>
            )}
```

Then attach the assembled overrides to the profile wherever it is saved. In `persist()`, change:
```ts
      await onSave(working, status, reviewerNote.trim() || null);
```
to:
```ts
      const toSave = { ...working, reviewer_overrides: assembleOverrides(profile.competencies, working.competencies, overrideReasons) };
      await onSave(toSave, status, reviewerNote.trim() || null);
```
And in `handleConfirmAndSnapshot()`, change the pending-edits save line:
```ts
        await onSave(working, 'edited', reviewerNote.trim() || null);
```
to:
```ts
        const toSave = { ...working, reviewer_overrides: assembleOverrides(profile.competencies, working.competencies, overrideReasons) };
        await onSave(toSave, 'edited', reviewerNote.trim() || null);
```

- [ ] **Step 5: Write the panel test**

Create `tests/app/capture/override-rationale.test.tsx` (mirrors the mock scaffold in `tests/app/capture/profile-review-okf-download.test.tsx` — copy its `vi.mock` block for VerificationSummary/CourseOverview/ClassStructureSection/MajorProjectsSection/StressTestPanel/StressTestBadge/CitationDrawer/LegacyBanner/FlagDialog, then):

```ts
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

// (paste the same vi.mock(...) block as profile-review-okf-download.test.tsx)

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

const STMT = 'Students analyze brand-color reproduction';
function makeProfile(): CaptureProfile {
  return {
    course_code: 'GC 2400', scale_version: 'v2', generated_at: new Date().toISOString(),
    overview: null,
    competencies: [{
      statement: STMT, type: 'technical', k_depth: 2, u_depth: 2, d_depth: 2,
      evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r',
      source: 'materials', citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'ex' }],
    }],
    incoming_expectations: [],
    verification_summary: { overall_shape: 'x', strongest_evidence: 'x', dimensional_patterns: 'x', catalog_vs_evidence: 'x', foundationals_at_a_glance: 'x', source: 'materials', citations: [] },
    audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
    course_emphasis: [], class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}

function renderPanel(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ProfileReviewPanel
      profile={makeProfile()} reviewerStatus="ai_drafted" initialReviewerNote={null}
      telemetry={null} onSave={onSave} onResumeChat={() => {}}
      courseCode="GC 2400" courseTitle="Color" slug="s" onSnapshotCreated={() => {}}
    />,
  );
  return { onSave };
}

describe('K/U/D override rationale gate', () => {
  it('shows a required reason field when a score is bumped up, and blocks approve until filled', () => {
    renderPanel();
    // The single materials competency is flagged/confident; ensure its card is visible.
    const doSlider = screen.getByLabelText(`Do depth for "${STMT}"`);
    fireEvent.change(doSlider, { target: { value: '4' } });
    // Reason field appears.
    expect(screen.getByText(/You raised a score/i)).toBeTruthy();
    // Approve is locked with the bump message.
    expect(screen.getByText(/raised score.*need a reason/i)).toBeTruthy();
    // Fill the reason → message clears.
    fireEvent.change(screen.getByPlaceholderText(/Reason for the higher depth/i), { target: { value: 'capstone press checks' } });
    expect(screen.queryByText(/raised score.*need a reason/i)).toBeNull();
  });

  it('no reason field for a downward edit', () => {
    renderPanel();
    const doSlider = screen.getByLabelText(`Do depth for "${STMT}"`);
    fireEvent.change(doSlider, { target: { value: '1' } });
    expect(screen.queryByText(/You raised a score/i)).toBeNull();
  });
});
```

If the single competency renders rolled-up (confident zone) rather than expanded, expand it first: `fireEvent.click(screen.getByRole('button', { name: new RegExp(STMT, 'i') }))` before querying the slider. (A `source:'materials'` competency with citations is non-flagged → confident/rolled-up; click to expand.)

- [ ] **Step 6: Run the panel test + full capture suite**

Run: `pnpm vitest run tests/app/capture/override-rationale.test.tsx tests/app/capture` → all pass.
Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -i ProfileReviewPanel` → no output.

- [ ] **Step 7: Commit**

```bash
git add "app/capture/[code]/ProfileReviewPanel.tsx" tests/app/capture/override-rationale.test.tsx
git commit -m "feat(capture): require + record rationale on upward K/U/D override; gate Approve (fixes A15 inversion)"
```

---

## Task 3: De-granularize course emphasis on `/view/<code>` (backlog #3)

**Files:**
- Modify: `app/view/[code]/CapturedView.tsx:402-424`

Context (spec/backlog): the public course view shows per-competency `{points} pts · {share_pct}%`, and the precise point values invite pushback. Keep the **big-picture** signal — the centrality band (`central` / `supporting` / `peripheral`, already derived ≥20% / 5–19% / <5% and the list is already sorted strongest-first) — and **drop the precise points/percent**. No data/schema change; rendering only.

- [ ] **Step 1: Replace the emphasis list rendering**

In `app/view/[code]/CapturedView.tsx`, replace the block from `<h2 ...>Course emphasis — by point weight</h2>` through the closing `</ul>` (lines ~405–423) with:

```tsx
          <h2 className="mb-1 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Course emphasis — where the graded effort goes
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Which competencies the course&apos;s graded work weights most, independent of depth scoring.
          </p>
          <ul className="space-y-1.5">
            {emphasis.map((it, i) => {
              const band =
                it.centrality === 'central'
                  ? 'bg-foreground/10 text-foreground border-foreground/20'
                  : it.centrality === 'supporting'
                  ? 'bg-muted text-muted-foreground border-border'
                  : 'bg-transparent text-muted-foreground/70 border-border';
              return (
                <li key={i} className="flex items-baseline gap-2">
                  <span className={'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ' + band}>
                    {it.centrality}
                  </span>
                  <span className="flex-1 text-sm leading-snug text-foreground">{it.competency}</span>
                </li>
              );
            })}
          </ul>
```

This drops the `{it.points} pts · {it.share_pct}%` span entirely and gives the three centrality bands distinct weight (central emphasized, peripheral faded), so the section reads as "here's where the effort is" without an arguable number. The `points`/`share_pct` fields stay in the data (still used to derive centrality + sort order); they're just no longer surfaced.

- [ ] **Step 2: Verify + commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -i CapturedView` → no output.
Run: `pnpm vitest run tests/app/view 2>&1 | tail -4` → pass (update any test asserting the `pts · %` text if one exists).

```bash
git add "app/view/[code]/CapturedView.tsx"
git commit -m "feat(view): course emphasis shows centrality bands, not precise points/percent (less pushback)"
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Detect upward bump vs baseline, index-matched, foundational D-only | Task 1 `upwardBumps` |
| Evidence-line crossings are a subset of "any upward bump" | Task 1 (covered: any upward → reason) |
| Inline per-competency reason field on bumped rows | Task 2 Step 2–3 |
| Level-aware hint | Task 2 Step 2 (`courseLevelBand` from `course_code`) |
| Gate Approve only (not Save); fix A15 inversion | Task 2 Step 1 (`approveUnlocked && allUpwardBumpsJustified`) + Step 4 message |
| `reviewer_overrides` recorded into snapshot (no migration) | Task 1 schema + Task 2 Step 4 attach at persist + snapshot save |
| Seed reasons from existing profile on re-review | Task 2 Step 1 state initializer |
| Backward compat (optional field) | Task 1 (`.nullable().optional()`) |
| Tests: detection, assembly, gate, downward-excluded | Task 1 + Task 2 Step 5 |

**Placeholder scan:** none — all code shown.

**Type consistency:** `upwardBumps(baseline, working): UpwardBump[]`, `assembleOverrides(baseline, working, reasons: Map<number,string>): ReviewerOverride[]`, `ReviewerOverride { statement, changes:[{dim,from,to}], reason }`, `reviewer_overrides` field, `overrideReasons`/`setReason`/`bumpByIndex`/`unjustifiedBumpCount`/`allUpwardBumpsJustified`/`renderOverrideReason`/`courseLevelBand` are used consistently across both tasks. The `approveUnlocked` change ANDs the new gate onto the existing expression (does not drop the existing unlock conditions).
