# Abstraction-and-Bridging Audit Condition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth CourseCapture Audit Area-7 condition — `abstraction_bridging` (does the course require abstracting a principle across multiple surface-varied cases and applying it to a genuinely new context) — through the schema, the strict synthesis schema, both prompts, and a new per-course Area-7 block on `/view`. Program-level aggregation deferred.

**Architecture:** Additive JSON-profile field (no DB migration). Zod parse schema makes it **optional** (old immutable snapshots lack it → read as "not assessed," never `absent`); the OpenAI strict request schema lists it **required** so new captures always emit a value; the evidence field is nullable in both. Both prompts gain the probe; `CapturedView` renders the Area-7 conditions for the first time.

**Tech Stack:** TypeScript strict, Zod, Vitest + @testing-library/react, OpenAI strict structured output.

**Branch:** `feat/abstraction-bridging-condition` (off `dev`; spec committed `96a4160`).

**Spec:** `docs/superpowers/specs/2026-06-14-abstraction-bridging-condition-design.md`

---

## File Structure
- `lib/ai/capture/schema.ts` (modify) — add `abstraction_bridging` (optional enum) + `abstraction_bridging_evidence` (nullable.optional) to `productiveFailureConditionsSchema`; extend the `superRefine`.
- `lib/ai/analyze/capture-scores.ts` (modify) — add both fields to the strict PF JSON schema (`required` + `properties`); the condition enum non-nullable, the evidence array nullable. (v2 deep-clones v1 — adding to the source covers both.)
- `lib/ai/prompts/capture-chat-agent.md` (modify) — §7: insert probe **e Abstraction-and-bridging**, bump depth `e → f`, `five → six`, add the b-vs-e distinction.
- `lib/ai/prompts/capture-synthesis.md` (modify) — add the two fields to the PF JSON shape + emission guidance.
- `app/view/[code]/CapturedView.tsx` (modify) — extend the `CapturedProfile.audit_notes` type; add an `Area7Conditions` block component + render it.
- `tests/lib/ai/capture/pf-abstraction-bridging-evidence.test.ts` (create) — Zod evidence/back-compat tests.
- `tests/lib/ai/capture/pf-json-schema.test.ts` (modify) — assert the strict schema carries the field.
- `tests/app/view/area7-conditions.test.tsx` (create) — the display component.
- `docs/STATE.md` (modify, final task) — flip the deferred item.

---

### Task 1: Schema field + evidence rule (`schema.ts`)

**Files:**
- Modify: `lib/ai/capture/schema.ts` (`productiveFailureConditionsSchema`, ~line 134-156)
- Test: `tests/lib/ai/capture/pf-abstraction-bridging-evidence.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `tests/lib/ai/capture/pf-abstraction-bridging-evidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { productiveFailureConditionsSchema } from '@/lib/ai/capture/schema';

// A valid baseline PF block (structured_post_mortem 'absent' so it needs no evidence).
const base = {
  generate_then_consolidate: 'present' as const,
  open_ended_problems: 'present' as const,
  revision_cycles: 'present' as const,
  structured_post_mortem: 'absent' as const,
  max_supporting_depth: 4,
  notes: [] as string[],
};
const validCite = { type: 'chunk' as const, chunkId: 'chunk-abc123', excerpt: 'compare two press faults, apply to a third' };

describe('abstraction_bridging condition', () => {
  it('back-compat: a PF block WITHOUT abstraction_bridging still parses (old snapshots)', () => {
    expect(productiveFailureConditionsSchema.safeParse(base).success).toBe(true);
  });

  it('rejects non-absent abstraction_bridging with no evidence', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'present' });
    expect(r.success).toBe(false);
  });

  it('rejects non-absent abstraction_bridging with an empty evidence array', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'partial', abstraction_bridging_evidence: [] });
    expect(r.success).toBe(false);
  });

  it('accepts non-absent abstraction_bridging with a resolvable citation', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'present', abstraction_bridging_evidence: [validCite] });
    expect(r.success).toBe(true);
  });

  it('accepts absent abstraction_bridging with no evidence', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'absent' });
    expect(r.success).toBe(true);
  });

  it('rejects a non-absent abstraction_bridging whose citation is structurally invalid', () => {
    const badCite = { type: 'chunk' as const, chunkId: null, excerpt: 'x' };
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'present', abstraction_bridging_evidence: [badCite] });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm exec vitest run tests/lib/ai/capture/pf-abstraction-bridging-evidence.test.ts` — expect FAIL (non-absent with no evidence currently *passes* because the field/refine don't exist).

- [ ] **Step 3: Implement.** In `lib/ai/capture/schema.ts`, in `productiveFailureConditionsSchema`, add the two fields after `structured_post_mortem_evidence` (before `max_supporting_depth`):

```ts
  // Transfer-conversion condition (Audit Area 7 probe e, added 2026-06-14).
  // OPTIONAL in Zod so pre-feature immutable snapshots (which lack the key)
  // still parse — a missing field reads as "not assessed for this condition",
  // never as 'absent'. New captures always emit it (the strict request schema
  // marks it required). Evidence required when non-absent, mirroring post-mortem.
  abstraction_bridging: productiveFailureConditionEnum.optional(),
  abstraction_bridging_evidence: z.array(CaptureProfileCitation).nullable().optional(),
```

Then extend the `superRefine` body (after the existing `structured_post_mortem` block, inside the same callback):

```ts
  if (pf.abstraction_bridging !== undefined && pf.abstraction_bridging !== 'absent') {
    const ev = pf.abstraction_bridging_evidence;
    if (!ev || ev.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['abstraction_bridging_evidence'],
        message: 'abstraction_bridging above "absent" requires at least one resolvable citation (mirrors the K/U/D evidence-above-zero rule). With no graded artifact showing abstraction across varied cases applied to a new context, rate it "absent".',
      });
    }
  }
```

Update the block's leading doc comment to mention the new condition.

- [ ] **Step 4: Run to verify it passes.** `pnpm exec vitest run tests/lib/ai/capture/pf-abstraction-bridging-evidence.test.ts` — expect PASS (6 tests). Also run the existing `pnpm exec vitest run tests/lib/ai/capture/pf-reflection-evidence.test.ts` — still PASS (no regression).

- [ ] **Step 5: Commit.**
```bash
git add lib/ai/capture/schema.ts tests/lib/ai/capture/pf-abstraction-bridging-evidence.test.ts
git commit -m "feat(capture): abstraction_bridging Area-7 condition in the Zod schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Strict synthesis request schema (`capture-scores.ts`)

**Files:**
- Modify: `lib/ai/analyze/capture-scores.ts` (PF block in the strict JSON schema, ~line 185-209)
- Test: `tests/lib/ai/capture/pf-json-schema.test.ts` (modify)

- [ ] **Step 1: Add the failing assertions.** In `tests/lib/ai/capture/pf-json-schema.test.ts`, add inside the `describe`:

```ts
  it('v1 PF block declares abstraction_bridging (enum) + evidence in properties and required', () => {
    const block = pf(captureProfileJsonSchema);
    expect(block.required).toContain('abstraction_bridging');
    expect(block.required).toContain('abstraction_bridging_evidence');
    expect(block.properties.abstraction_bridging.enum).toEqual(['present', 'partial', 'absent']);
    expect(block.properties.abstraction_bridging_evidence.type).toEqual(['array', 'null']);
  });

  it('v2 inherits abstraction_bridging (deep clone)', () => {
    const block = pf(captureProfileJsonSchemaV2);
    expect(block.required).toContain('abstraction_bridging');
    expect(block.properties.abstraction_bridging).toBeDefined();
  });
```

- [ ] **Step 2: Run to verify it fails.** `pnpm exec vitest run tests/lib/ai/capture/pf-json-schema.test.ts` — expect FAIL (field not in schema yet).

- [ ] **Step 3: Implement.** In `lib/ai/analyze/capture-scores.ts`, in the `productive_failure_conditions` block: add `'abstraction_bridging'` and `'abstraction_bridging_evidence'` to the `required` array, and these two to `properties` (place after `structured_post_mortem_evidence`):

```ts
            abstraction_bridging: { type: 'string', enum: ['present', 'partial', 'absent'] },
            // Nullable array; required-by-superRefine in Zod when abstraction_bridging
            // is above 'absent'. Model emits null otherwise.
            abstraction_bridging_evidence: { type: ['array', 'null'], items: CITATIONS_ARRAY.items },
```

The `required` array becomes:
```ts
          required: [
            'generate_then_consolidate',
            'open_ended_problems',
            'revision_cycles',
            'structured_post_mortem',
            'structured_post_mortem_evidence',
            'abstraction_bridging',
            'abstraction_bridging_evidence',
            'max_supporting_depth',
            'notes',
          ],
```

(If v1 and v2 are separate literals rather than a deep clone, apply the same addition to both; the test's "v2 inherits" assertion will confirm.)

- [ ] **Step 4: Run to verify it passes.** `pnpm exec vitest run tests/lib/ai/capture/pf-json-schema.test.ts` — expect PASS. Then `pnpm exec tsc --noEmit` — no errors.

- [ ] **Step 5: Commit.**
```bash
git add lib/ai/analyze/capture-scores.ts tests/lib/ai/capture/pf-json-schema.test.ts
git commit -m "feat(capture): abstraction_bridging in the strict synthesis JSON schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Interview prompt — Area 7 probe (`capture-chat-agent.md`)

**Files:**
- Modify: `lib/ai/prompts/capture-chat-agent.md` (§7, ~line 643-669)

- [ ] **Step 1: Update the count + insert the probe.** In §7, change the line `Probe each of these five conditions, asking one targeted question per turn.` to `Probe each of these six conditions, asking one targeted question per turn.`

  Then insert a new lettered probe **between `d.` (post-mortem) and the current `e.` (depth)**, and **renumber the current `e.` depth item to `f.`**. The new probe:

```
e. **Abstraction-and-bridging.** Does the course require students to abstract a
   principle across *multiple surface-varied cases* and apply it to a
   *genuinely new* context — comparing cases to extract the shared structure,
   then carrying it to a problem that looks different on the surface? This is
   the transfer-conversion step. Discriminator vs. (b): (b) asks whether a
   *single* problem is open-ended; (e) asks whether students reason *across
   several varied cases* toward a *new* context. A lone rich case is not
   abstraction-and-bridging; repeated drills of the same surface form are not
   either. (Gick-Holyoak / Gentner / Perkins-Salomon: comparison induces a
   schema, deliberate bridging carries it.)
```

- [ ] **Step 2: Verify.** `grep -n "Abstraction-and-bridging\|six conditions\|^f\. \*\*Domain depth" lib/ai/prompts/capture-chat-agent.md` — confirm the new probe, the "six conditions" line, and that the depth item is now `f.`. Run `pnpm exec tsc --noEmit` (prompt is text — confirms nothing else broke).

- [ ] **Step 3: Commit.**
```bash
git add lib/ai/prompts/capture-chat-agent.md
git commit -m "feat(capture): Area-7 interview probe (e) abstraction-and-bridging

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Synthesis prompt — emit the field (`capture-synthesis.md`)

**Files:**
- Modify: `lib/ai/prompts/capture-synthesis.md` (PF JSON shape ~line 103-110; guidance ~line 189-208)

- [ ] **Step 1: Add to the JSON shape.** In the `"productive_failure_conditions"` JSON block, add after the `structured_post_mortem_evidence` line and before `max_supporting_depth`:

```
      "abstraction_bridging": "present" | "partial" | "absent",
      "abstraction_bridging_evidence": [ { "type": "chunk" | "instructor", "chunkId": "...", "messageId": null, "excerpt": "..." } ] | null,
```

- [ ] **Step 2: Add emission guidance.** In the `# productive_failure_conditions — emit only if Audit Area 7 was probed` section (after the `max_supporting_depth` guidance), add:

```
`abstraction_bridging` grades whether the course makes students abstract a
principle across multiple surface-varied cases and apply it to a genuinely new
context (Area 7 probe e). Rate "present"/"partial"/"absent". When above
"absent", `abstraction_bridging_evidence` MUST cite the specific graded artifact
that requires the cross-case abstraction + transfer to a new context (same
evidence-above-zero discipline as `structured_post_mortem`); with no such
artifact to cite, rate it "absent". Do not conflate with `open_ended_problems`
(that is about a single problem being open-ended; this is about reasoning across
several varied cases toward a new context).
```

- [ ] **Step 3: Verify.** `grep -n "abstraction_bridging" lib/ai/prompts/capture-synthesis.md` — confirm it appears in the JSON shape + guidance. `pnpm exec tsc --noEmit`.

- [ ] **Step 4: Commit.**
```bash
git add lib/ai/prompts/capture-synthesis.md
git commit -m "feat(capture): synthesis emits abstraction_bridging + evidence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Per-course Area-7 display (`CapturedView.tsx`)

**Files:**
- Modify: `app/view/[code]/CapturedView.tsx` (`CapturedProfile.audit_notes` type ~line 56-58; derive + render near ~line 139 / before the footer `<section className="border-t pt-6">` ~line 376)
- Test: `tests/app/view/area7-conditions.test.tsx` (create)

- [ ] **Step 1: Write the failing test.** Create `tests/app/view/area7-conditions.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Area7Conditions } from '@/app/view/[code]/CapturedView';

describe('Area7Conditions', () => {
  it('renders the five conditions with their states when the block is present', () => {
    render(<Area7Conditions block={{
      generate_then_consolidate: 'present', open_ended_problems: 'partial',
      revision_cycles: 'absent', structured_post_mortem: 'present',
      abstraction_bridging: 'present', max_supporting_depth: 4,
    }} />);
    expect(screen.getByText(/Generate-then-consolidate/i)).toBeTruthy();
    expect(screen.getByText(/Abstraction-and-bridging/i)).toBeTruthy();
    expect(screen.getByText(/D 4/i)).toBeTruthy();
  });

  it('shows "not assessed" for a missing abstraction_bridging (old snapshot back-compat)', () => {
    render(<Area7Conditions block={{
      generate_then_consolidate: 'present', open_ended_problems: 'present',
      revision_cycles: 'present', structured_post_mortem: 'absent', max_supporting_depth: 3,
    }} />);
    const ab = screen.getByText(/Abstraction-and-bridging/i).closest('li')!;
    expect(ab.textContent).toMatch(/not assessed/i);
  });

  it('renders nothing when the block is null', () => {
    const { container } = render(<Area7Conditions block={null} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm exec vitest run tests/app/view/area7-conditions.test.tsx` — expect FAIL (`Area7Conditions` not exported).

- [ ] **Step 3: Extend the profile type.** In `CapturedView.tsx`, change the `audit_notes` field of `CapturedProfile`:

```ts
  audit_notes?: {
    suggested_objective_revisions?: string[];
    productive_failure_conditions?: Area7Block | null;
  };
```

Add the exported types + component near the other small components (e.g. after `DepthChip`):

```tsx
type PfCond = 'present' | 'partial' | 'absent';
export interface Area7Block {
  generate_then_consolidate?: PfCond;
  open_ended_problems?: PfCond;
  revision_cycles?: PfCond;
  structured_post_mortem?: PfCond;
  abstraction_bridging?: PfCond;
  max_supporting_depth?: number | null;
}

const AREA7_LABELS: { key: keyof Area7Block; label: string }[] = [
  { key: 'generate_then_consolidate', label: 'Generate-then-consolidate' },
  { key: 'open_ended_problems', label: 'Open-ended ill-structured problems' },
  { key: 'revision_cycles', label: 'Revision cycles with consequential failure' },
  { key: 'structured_post_mortem', label: 'Structured post-mortem' },
  { key: 'abstraction_bridging', label: 'Abstraction-and-bridging (transfer)' },
];

function condTone(v: PfCond | undefined): { text: string; cls: string } {
  if (v === undefined) return { text: 'not assessed', cls: 'text-muted-foreground/70 italic' };
  if (v === 'present') return { text: 'present', cls: 'text-emerald-700' };
  if (v === 'partial') return { text: 'partial', cls: 'text-amber-700' };
  return { text: 'absent', cls: 'text-muted-foreground' };
}

/** Per-course Audit Area 7 conditions block. Renders nothing when not assessed (null). */
export function Area7Conditions({ block }: { block: Area7Block | null | undefined }) {
  if (!block) return null;
  const depth = block.max_supporting_depth;
  return (
    <section>
      <h2 className="font-display text-lg font-semibold tracking-tight">Productive-failure &amp; transfer conditions</h2>
      <p className="mt-1 text-sm text-muted-foreground">What the course does to develop transferable problem-solving (Audit Area 7). A missing row means that condition was not assessed — not that it is absent.</p>
      <ul className="mt-3 space-y-1.5">
        {AREA7_LABELS.map(({ key, label }) => {
          const tone = condTone(block[key] as PfCond | undefined);
          return (
            <li key={key} className="flex items-baseline justify-between gap-4 text-sm">
              <span>{label}</span>
              <span className={'shrink-0 font-medium ' + tone.cls}>{tone.text}</span>
            </li>
          );
        })}
      </ul>
      {depth != null && (
        <p className="mt-2 text-xs text-muted-foreground">Max supporting depth: <span className="font-medium text-foreground">D {depth}</span></p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Render it in CapturedView.** Near the other derived values (~line 139), add:
```tsx
  const area7 = profile.audit_notes?.productive_failure_conditions ?? null;
```
Then add the block as a new section immediately before the footer `<section className="border-t pt-6">` (the depth-legend/footer, ~line 376):
```tsx
      {area7 && <Area7Conditions block={area7} />}
```

- [ ] **Step 5: Run to verify it passes.** `pnpm exec vitest run tests/app/view/area7-conditions.test.tsx` — expect PASS (3 tests). `pnpm exec tsc --noEmit` — no errors.

- [ ] **Step 6: Commit.**
```bash
git add app/view/[code]/CapturedView.tsx tests/app/view/area7-conditions.test.tsx
git commit -m "feat(view): per-course Area-7 conditions block (incl. abstraction-and-bridging)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Full suite + STATE.md

**Files:**
- Modify: `docs/STATE.md` (the deferred abstraction-and-bridging entry)

- [ ] **Step 1: Full suite + typecheck.** `pnpm test && pnpm exec tsc --noEmit` — all green.

- [ ] **Step 2: Update STATE.md.** In `docs/STATE.md`, the Deferred/debt entry that begins `**Candidate sixth CourseCapture Area-7 condition: *abstraction-and-bridging***` — change `**Not built**` to a DONE note:

Replace:
```
A sixth probe ("does the course require abstracting a principle across multiple varied cases and applying it to a genuinely new context?") would be the highest-value research-driven audit extension. **Not built** — needs its own design pass, and must be distinguished cleanly from probe 2 (*open-ended ill-structured problems* concerns the problem; abstraction-and-bridging concerns reasoning across problems).
```
with:
```
A sixth probe ("does the course require abstracting a principle across multiple varied cases and applying it to a genuinely new context?") was the highest-value research-driven audit extension. **DONE 2026-06-14** (`feat/abstraction-bridging-condition`, capture-first MVP): Area-7 interview probe (e) + synthesis emission + `abstraction_bridging` schema field (Zod-optional for snapshot back-compat, strict-required for new captures, evidence-above-zero for non-absent) + a new per-course Area-7 conditions block on `/view`. Spec [`2026-06-14-abstraction-bridging-condition-design.md`](./superpowers/specs/2026-06-14-abstraction-bridging-condition-design.md). **STILL deferred:** the program-level **ScaffoldingStrip aggregation** of the new condition (no data until courses are re-captured — snapshots are immutable, so the field populates per course on re-capture, never by backfill).
```

- [ ] **Step 3: Commit.**
```bash
git add docs/STATE.md
git commit -m "docs(state): abstraction-and-bridging Area-7 condition DONE (capture-first MVP)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification
- [ ] `pnpm test` green; `pnpm exec tsc --noEmit` clean.
- [ ] An old PF block (no `abstraction_bridging`) parses; a new non-absent one needs evidence; the strict schema requires the field; `/view` shows the Area-7 block with "not assessed" for missing abstraction_bridging.
- [ ] Manual (deploy-time): capture/re-capture a course through Area 7, confirm the interview asks the abstraction-and-bridging question and the saved snapshot carries `abstraction_bridging` + evidence; confirm the `/view` Area-7 block renders.

## Self-Review notes (author)
- **Spec coverage:** schema field + evidence rule → Task 1; strict schema → Task 2; interview probe → Task 3; synthesis → Task 4; `/view` block → Task 5; STATE → Task 6. ✓
- **No placeholders:** exact code/commands throughout. ✓
- **Type consistency:** `abstraction_bridging` / `abstraction_bridging_evidence` / `Area7Block` / `Area7Conditions` used consistently; strict-required vs Zod-optional asymmetry stated and matches the existing `capture-scores.ts:182-184` pattern. ✓
- **Deferred:** ScaffoldingStrip aggregation explicitly out of scope (Task 6 STATE note). ✓
