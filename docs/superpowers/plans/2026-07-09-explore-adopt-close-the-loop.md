# Explore — Close the Loop (Adopt a Scenario) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a faculty member **adopt** an Explore scenario — seeding the course's working draft with the change's *design* (revised objectives + required incoming skills) plus per-competency **intended targets** (the predicted depths, as a separate field that can never become a measured score) — so the next Capture re-scores measured depths from evidence while the targets ride alongside for "predicted vs. measured."

**Architecture:** `adoptScenario(scenarioId)` mirrors the existing `loadSnapshotAsDraft` but is sourced from a `Scenario`: it loads the baseline snapshot's profile, overlays `intended_target` per competency + `adopted_from_scenario_id` + revised objectives + new incoming-expectations, and `upsertCaptureProfile`s the result as the working draft. `intended_target` is a new **nullable** field structurally distinct from the measured `k/u/d` (the guardrail). A pure `preserveAdoptOverlay(prev, next)` carries the overlay across a re-score. The scenario card's disabled "Adopt · soon" button is wired to a new adopt route.

**Tech Stack:** TypeScript strict, Zod, Drizzle, Vitest. Builds on merged Plan 1/2 (`lib/ai/explore/*`, `course_explore_scenarios`, the `ScenarioCard`) + Capture (`course_capture_profiles`, `captureProfileSchema`).

**Spec:** [`2026-07-07-explore-close-the-loop-adopt-design.md`](../specs/2026-07-07-explore-close-the-loop-adopt-design.md).

---

## Reused interfaces

- `captureCompetencySchema` (`lib/ai/capture/schema.ts:95`) — `{ statement, type, k_depth, u_depth (nullable), d_depth, evidence_k/u/d, k_says/u_says/d_says, rationale, ... }`. `captureProfileSchema` (line 333) — `{ ..., competencies, incoming_expectations, revised_objectives_draft: string[]|null }`. `incomingExpectationSchema` — `{ statement, expected_depth: {k:nullable, u:nullable, d:int}, evidenced_by: string[]≥1, confidence: 'high'|'medium'|'low', source?, citations? }`.
- Draft I/O: `getCaptureProfileByCourse(courseCode)` + `upsertCaptureProfile({ courseCode, profile, reviewerStatus })` (`lib/db/course-capture-profiles-queries.ts`); `loadSnapshotAsDraft` (`lib/db/capture-snapshots-queries.ts`) as the mirror pattern; `getSnapshotById(id)` returns `SnapshotRow` with `.profile: CaptureProfile`.
- Scenario: `getScenario(id)` (`lib/db/explore-scenario-queries.ts`); `Scenario` (`lib/ai/explore/scenario.ts`) — `.baselineSnapshotId`, `.predictedDeltas[{competency, to:{k,u,d}}]`, `.change.{activity, assumesIncoming[{label,k,u,d}]}`.
- `normalizeCompetencyKey` (`lib/ai/explore/run-impact.ts`) — reuse for competency-statement matching.
- `CompetencyPortrait` (`app/capture/[code]/CompetencyPortrait.tsx`) — the review card (add target display).
- `ScenarioCard` (`app/explore/[code]/ScenarioCard.tsx`) — the disabled Adopt button (wire it). `AskTab` (`components/AskTab.tsx`) — `handleSave` pattern (add `handleAdopt`).

---

## Task 1: Schema — `intended_target` + `adopted_from_scenario_id`

**Files:** Modify `lib/ai/capture/schema.ts`; Test `tests/lib/ai/capture/adopt-schema.test.ts` (create).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { captureCompetencySchema, captureProfileSchema } from '@/lib/ai/capture/schema';

const comp = { statement: 'prepress', type: 'technical' as const, k_depth: 3, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x' };

describe('intended_target + adopted_from_scenario_id', () => {
  it('accepts a competency with an intended_target', () => {
    const r = captureCompetencySchema.safeParse({ ...comp, intended_target: { k: 3, u: 2, d: 4 } });
    expect(r.success && r.data.intended_target?.d).toBe(4);
  });
  it('accepts a competency with intended_target null and when omitted (backward-compat)', () => {
    expect(captureCompetencySchema.safeParse({ ...comp, intended_target: null }).success).toBe(true);
    expect(captureCompetencySchema.safeParse(comp).success).toBe(true);
  });
  it('profile accepts adopted_from_scenario_id (string, null, omitted)', () => {
    const base = { course_code: 'GC 3460', scale_version: 'v1', generated_at: 'now', overview: null,
      competencies: [comp], incoming_expectations: [], verification_summary: null,
      audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], productive_failure_conditions: null, source: 'inferred', citations: [] },
      revised_objectives_draft: null, course_emphasis: [] };
    expect(captureProfileSchema.safeParse({ ...base, adopted_from_scenario_id: 's1' }).success).toBe(true);
    expect(captureProfileSchema.safeParse({ ...base, adopted_from_scenario_id: null }).success).toBe(true);
    expect(captureProfileSchema.safeParse(base).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** In `captureCompetencySchema`'s `.object({...})` (near the `*_says` fields), add:
```typescript
    // Aspirational target set by ADOPT (Explore close-the-loop) — the predicted
    // depth a change aims for. A SEPARATE field from the measured k/u/d: a target
    // can never occupy a measured slot, so evidence-above-zero governs only the
    // measured depths and no prediction can launder into an evidenced score.
    intended_target: z.object({
      k: z.number().int().min(0).max(5).nullable(),
      u: z.number().int().min(0).max(5).nullable(),
      d: z.number().int().min(0).max(5).nullable(),
    }).nullable().optional(),
```
In `captureProfileSchema`'s `.object({...})` add: `adopted_from_scenario_id: z.string().nullable().optional(),`. (Do NOT touch the strict OpenAI request schema in `capture-scores.ts` — the scorer never emits these; they are adopt-set overlays.)

- [ ] **Step 4: Run, verify PASS.** Run the full capture schema suite `pnpm vitest run tests/lib/ai/capture/` — confirm no `.refine`/existing test regressed (the new fields are additive + optional). `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add lib/ai/capture/schema.ts tests/lib/ai/capture/adopt-schema.test.ts && git commit -m "feat(capture): intended_target per competency + adopted_from_scenario_id (adopt overlay)"`

---

## Task 2: `preserveAdoptOverlay` pure helper

**Files:** Create `lib/capture/adopt-overlay.ts`; Test `tests/lib/capture/adopt-overlay.test.ts`.

When a *fresh* scored profile is written over a draft that was adopted, the scorer's competencies carry no targets — this helper copies `intended_target` (matched by normalized competency statement) + `adopted_from_scenario_id` from the previous draft onto the fresh one.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { preserveAdoptOverlay } from '@/lib/capture/adopt-overlay';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const mk = (over: Partial<CaptureProfile>): CaptureProfile => ({
  course_code: 'GC 3460', scale_version: 'v1', generated_at: 'now', overview: null,
  competencies: [], incoming_expectations: [], verification_summary: null,
  audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], productive_failure_conditions: null, source: 'inferred', citations: [] },
  revised_objectives_draft: null, course_emphasis: [], ...over,
} as CaptureProfile);

const comp = (statement: string, extra: Record<string, unknown> = {}) => ({ statement, type: 'technical', k_depth: 3, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x', ...extra });

describe('preserveAdoptOverlay', () => {
  it('carries intended_target + adopted_from onto a fresh score by statement match', () => {
    const prev = mk({ adopted_from_scenario_id: 's1', competencies: [comp('Prepress Prep', { intended_target: { k: null, u: null, d: 4 } }) as never] });
    const next = mk({ competencies: [comp('  prepress   prep ', { d_depth: 4 }) as never] }); // re-scored, normalized-equal statement, no target
    const out = preserveAdoptOverlay(prev, next);
    expect(out.adopted_from_scenario_id).toBe('s1');
    expect((out.competencies[0] as any).intended_target?.d).toBe(4);
    expect((out.competencies[0] as any).d_depth).toBe(4); // measured value from the fresh score, untouched
  });
  it('is a no-op when prev has no adopt overlay', () => {
    const prev = mk({ competencies: [comp('X') as never] });
    const next = mk({ competencies: [comp('X') as never] });
    expect(preserveAdoptOverlay(prev, next).adopted_from_scenario_id ?? null).toBe(null);
    expect((preserveAdoptOverlay(prev, next).competencies[0] as any).intended_target ?? null).toBe(null);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `lib/capture/adopt-overlay.ts`:**

```typescript
import type { CaptureProfile, CaptureCompetency } from '@/lib/ai/capture/schema';
import { normalizeCompetencyKey } from '@/lib/ai/explore/run-impact';

/**
 * Carry the ADOPT overlay (per-competency `intended_target` + profile-level
 * `adopted_from_scenario_id`) from a previous draft onto a freshly re-scored
 * profile. Measured depths/evidence/says come from `next` (the fresh score);
 * only the aspirational target + provenance are preserved from `prev`, matched
 * by normalized competency statement. Pure; if `prev` was never adopted, no-op.
 */
export function preserveAdoptOverlay(prev: CaptureProfile, next: CaptureProfile): CaptureProfile {
  const prevAdopted = (prev as { adopted_from_scenario_id?: string | null }).adopted_from_scenario_id ?? null;
  const targetByStmt = new Map<string, unknown>();
  for (const c of prev.competencies) {
    const t = (c as { intended_target?: unknown }).intended_target;
    if (t) targetByStmt.set(normalizeCompetencyKey(c.statement), t);
  }
  if (!prevAdopted && targetByStmt.size === 0) return next;

  const competencies = next.competencies.map((c): CaptureCompetency => {
    const t = targetByStmt.get(normalizeCompetencyKey(c.statement));
    return t ? ({ ...c, intended_target: t } as CaptureCompetency) : c;
  });
  return { ...next, competencies, adopted_from_scenario_id: prevAdopted } as CaptureProfile;
}
```

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add lib/capture/adopt-overlay.ts tests/lib/capture/adopt-overlay.test.ts && git commit -m "feat(capture): preserveAdoptOverlay — carry intended_target across a re-score"`

---

## Task 3: `buildAdoptedProfile` — the pure seed

**Files:** Create `lib/ai/explore/adopt.ts`; Test `tests/lib/ai/explore/adopt.test.ts`.

Pure: baseline profile + scenario → the "planned" profile (targets + objectives + incoming + provenance).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildAdoptedProfile } from '@/lib/ai/explore/adopt';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { Scenario } from '@/lib/ai/explore/scenario';

const baseline = {
  course_code: 'GC 3460', scale_version: 'v1', generated_at: 'now', overview: null,
  competencies: [{ statement: 'Prepress preparation', type: 'technical', k_depth: 2, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x' }],
  incoming_expectations: [], verification_summary: null,
  audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], productive_failure_conditions: null, source: 'inferred', citations: [] },
  revised_objectives_draft: null, course_emphasis: [],
} as unknown as CaptureProfile;

const scenario = {
  id: 's1', courseCode: 'GC 3460', baselineSnapshotId: 'snap1',
  change: { prose: 'add trapping lab', activity: 'trapping lab', artifact: 'graded', competencies: ['Prepress preparation'], rubricCriteria: ['registration'], assumesIncoming: [{ label: 'color models', subCompetencyId: null, k: 3, u: null, d: null }] },
  predictedDeltas: [{ competency: 'Prepress preparation', from: { k: 2, u: 2, d: 3 }, to: { k: 3, u: 2, d: 4 }, confidence: 'medium', rationale: 'r' }],
  computedRipple: [], caption: null, createdAt: 'now',
} as unknown as Scenario;

describe('buildAdoptedProfile', () => {
  it('sets intended_target from predicted delta, provenance, objectives + incoming', () => {
    const p = buildAdoptedProfile(baseline, scenario);
    expect((p.competencies[0] as any).intended_target).toEqual({ k: 3, u: 2, d: 4 });
    expect((p.competencies[0] as any).d_depth).toBe(3); // measured baseline untouched
    expect((p as any).adopted_from_scenario_id).toBe('s1');
    expect(p.revised_objectives_draft?.some(o => /trapping lab/i.test(o))).toBe(true);
    expect(p.incoming_expectations.some(e => /color models/i.test(e.statement))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `lib/ai/explore/adopt.ts`.** `buildAdoptedProfile(baseline: CaptureProfile, scenario: Scenario): CaptureProfile`:
  - Clone baseline. Build a `Map<normalizedStatement, delta.to>` from `scenario.predictedDeltas`.
  - `competencies = baseline.competencies.map(c => { const t = map.get(normalizeCompetencyKey(c.statement)); return t ? { ...c, intended_target: { k: t.k, u: t.u, d: t.d } } : c; })`.
  - `adopted_from_scenario_id = scenario.id`.
  - `revised_objectives_draft = [ ...(baseline.revised_objectives_draft ?? []), \`Adopted change: ${scenario.change.activity}\` ]`.
  - `incoming_expectations = [ ...baseline.incoming_expectations, ...scenario.change.assumesIncoming.map(a => ({ statement: a.label, expected_depth: { k: a.k, u: a.u, d: a.d ?? 0 }, evidenced_by: [\`adopted from scenario ${scenario.id}\`], confidence: 'low' as const })) ]` — note `expected_depth.d` is non-nullable in `incomingExpectationSchema`, so map `a.d ?? 0`.
  - Return the merged profile. Import `normalizeCompetencyKey` from `run-impact.ts` and the types.

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add lib/ai/explore/adopt.ts tests/lib/ai/explore/adopt.test.ts && git commit -m "feat(explore): buildAdoptedProfile — seed the planned profile from a scenario"`

---

## Task 4: `adoptScenario` operation (DB wrapper)

**Files:** Modify `lib/ai/explore/adopt.ts`; Test — the pure `buildAdoptedProfile` is covered (Task 3); the DB wrapper is validated by the route test (Task 7).

- [ ] **Step 1: Implement `adoptScenario(scenarioId: string): Promise<{ ok: true } | { ok: false; error: string }>`** in `lib/ai/explore/adopt.ts`:
  - `const s = await getScenario(scenarioId); if (!s) return { ok: false, error: 'scenario not found' };`
  - `const snap = await getSnapshotById(s.baselineSnapshotId); if (!snap) return { ok: false, error: 'baseline snapshot not found' };`
  - `const profile = buildAdoptedProfile(snap.profile, s);`
  - `await upsertCaptureProfile({ courseCode: s.courseCode, profile, reviewerStatus: 'edited' });` (mirrors `loadSnapshotAsDraft` — forking into the draft is an 'edited' state.)
  - `return { ok: true };`
  Imports: `getScenario` (`@/lib/db/explore-scenario-queries`), `getSnapshotById` (`@/lib/db/capture-snapshots-queries`), `upsertCaptureProfile` (`@/lib/db/course-capture-profiles-queries`).

- [ ] **Step 2: Typecheck** — `pnpm tsc --noEmit` clean. (No unit test here; the pure seed is tested + the route + a manual adopt in Task 7 exercise it.)
- [ ] **Step 3: Commit** — `git add lib/ai/explore/adopt.ts && git commit -m "feat(explore): adoptScenario — seed the working draft from a scenario (mirrors loadSnapshotAsDraft)"`

---

## Task 5: Preserve the overlay across re-score

**Files:** Modify the fresh-score draft-write path(s); Test as identified.

- [ ] **Step 1: Find the callers of `upsertCaptureProfile` that write a FRESH scored profile** (not a reviewer edit-save, which already carries the target from the draft it edited). `grep -rn "upsertCaptureProfile" lib app --include='*.ts' | grep -v node_modules`. The re-score/synthesis path (the one that writes a scorer-produced profile as the draft, e.g. the parse-profile / synthesis apply) is the one that must preserve the overlay.

- [ ] **Step 2: At each fresh-score write site**, before `upsertCaptureProfile({ courseCode, profile, ... })`, read the existing draft and preserve the overlay:
```typescript
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { preserveAdoptOverlay } from '@/lib/capture/adopt-overlay';
// ...
const existing = await getCaptureProfileByCourse(courseCode);
const merged = existing ? preserveAdoptOverlay(existing.profile, profile) : profile;
await upsertCaptureProfile({ courseCode, profile: merged, reviewerStatus });
```
(Do NOT apply this to the reviewer edit-save path — that profile already has the target. Apply only where a scorer-produced profile replaces the draft.) If a call site is genuinely ambiguous (can't tell fresh-score from edit-save), report DONE_WITH_CONCERNS describing the sites so the controller decides.

- [ ] **Step 3: Add a focused test** at the identified seam if it's testable in isolation (e.g. if the synthesis-apply has a pure assembly, feed it a prev-with-target + a fresh score and assert the target survives). If the only seam is a DB route, note that it's covered by the round-trip and skip the unit test.

- [ ] **Step 4: `pnpm tsc --noEmit` clean; `pnpm vitest run tests/lib/ tests/app/capture/` green.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(capture): preserve adopt overlay when a re-score writes the draft"`

---

## Task 6: Display the target on the review portrait

**Files:** Modify `app/capture/[code]/CompetencyPortrait.tsx`; Test `tests/app/capture/competency-portrait-target.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompetencyPortrait } from '@/app/capture/[code]/CompetencyPortrait';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';

const comp = { statement: 'Prepress prep', type: 'technical', k_depth: 2, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x', k_says: null, u_says: null, d_says: 'They do it.', intended_target: { k: null, u: null, d: 4 } } as unknown as CaptureCompetency;

it('shows the intended target vs measured when a target is present', () => {
  render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
  expect(screen.getByText(/target/i)).toBeInTheDocument();
  expect(screen.getByText(/D4/)).toBeInTheDocument();      // target D
  expect(screen.getByText(/measured|now/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** In `CompetencyPortrait`, when `competency.intended_target` is present, render a small muted line near the rating: `target D${it.d} · measured D${competency.d_depth}` (Do-centric; show K/U target only when non-null and different from measured). Keep it visually distinct (e.g. a `target:` prefix + muted color), and NEVER present the target as a measured score. Guard: `intended_target` may be `null`/absent (no line then).

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean; `pnpm vitest run tests/app/capture/` green (the existing portrait tests must still pass — the target line is additive and only renders when a target exists).
- [ ] **Step 5: Commit** — `git add 'app/capture/[code]/CompetencyPortrait.tsx' tests/app/capture/competency-portrait-target.test.tsx && git commit -m "feat(capture): portrait shows intended target vs measured when adopted"`

---

## Task 7: Adopt route + enable the card button

**Files:** Create `app/api/explore/[code]/scenarios/[id]/adopt/route.ts`; Modify `app/explore/[code]/ScenarioCard.tsx`, `components/AskTab.tsx`; Test `tests/app/api/explore-adopt-route.test.ts`, extend the ScenarioCard test.

- [ ] **Step 1: Failing route test** `tests/app/api/explore-adopt-route.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('adopt route: POST, slug-gated, rate-limited, calls adoptScenario', () => {
  const src = readFileSync('app/api/explore/[code]/scenarios/[id]/adopt/route.ts', 'utf8');
  expect(src).toContain('export async function POST');
  expect(src).toMatch(/isValidSlug/);
  expect(src).toMatch(/checkIpRateLimit/);
  expect(src).toMatch(/adoptScenario/);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `POST /api/explore/[code]/scenarios/[id]/adopt`** — mirror the auth+rate-limit of `scenarios/[id]/route.ts` (slug → 401, `hashIp`+`checkIpRateLimit` → 429), then `const r = await adoptScenario(id); if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 }); return NextResponse.json({ ok: true });`. Import `adoptScenario` from `@/lib/ai/explore/adopt`.

- [ ] **Step 4: Enable the ScenarioCard Adopt button.** Add an `onAdopt?: (id: string) => void` prop. If `onAdopt` is provided, render Adopt as an ENABLED `<button onClick={() => onAdopt(scenario.id)}>Adopt</button>`; if not provided (backward-compat/other callers), keep the disabled "Adopt · soon". Update the ScenarioCard test: pass an `onAdopt` vi.fn(), click Adopt, assert it fires with the id and is NOT disabled.

- [ ] **Step 5: Wire `handleAdopt` in `AskTab`.** Add `async function handleAdopt(id: string) { if (!courseCode) return; if (!window.confirm('Adopt this scenario as the course\\'s next planned version? It seeds your capture draft with intended targets + the revised design.')) return; try { const res = await fetch(\`/api/explore/\${encodeURIComponent(courseCode)}/scenarios/\${id}/adopt?slug=\${encodeURIComponent(slug)}\`, { method: 'POST' }); if (!res.ok) throw new Error(\`adopt failed (\${res.status})\`); void send('I adopted that scenario — what changed in the plan, and what should I gather evidence for when I teach it?'); } catch (e) { setError(e instanceof Error ? e.message : 'Adopt failed'); } }` and pass `onAdopt={handleAdopt}` to the `<ScenarioCard>`.

- [ ] **Step 6: Run** `pnpm vitest run tests/app/api/ tests/app/explore/ tests/components/` → green; `pnpm tsc --noEmit` clean.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(explore): adopt route + enable the ScenarioCard Adopt button (close the loop)"`

---

## Task 8: STATE.md + full suite + manual adopt smoke

**Files:** Modify `docs/STATE.md`.

- [ ] **Step 1: Full suite + typecheck** — `pnpm vitest run` (all green), `pnpm tsc --noEmit` (clean).

- [ ] **Step 2: (optional) Manual adopt smoke** — if a real scenario exists in the dev DB (`listScenarios` for a captured course, or run the impact harness to create one), call the adopt route (or `adoptScenario` via a one-liner) and confirm the course's draft now has `adopted_from_scenario_id` + a competency `intended_target` (`getCaptureProfileByCourse`). Note the result in the commit body.

- [ ] **Step 3: Update STATE.md** — #188 (adopt / close-the-loop) BUILT: `intended_target` + `adopted_from_scenario_id` schema fields; `adoptScenario` seeds the draft; `preserveAdoptOverlay` carries the overlay across re-score; the portrait shows target-vs-measured; the ScenarioCard Adopt button is now ENABLED (route `POST scenarios/[id]/adopt`). Note the guardrail (target is a separate field — never a measured score) and what stays deferred (the program-level "did we hit our targets?" reconciliation view; target lifecycle rules). Update **What's live** (new adopt route) + AI-function/schema notes if relevant.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "docs(state): #188 adopt (close-the-loop) built — scenario → planned draft with intended targets"`

---

## Notes for the implementer

- **The guardrail is structural:** `intended_target` is a *separate nullable field* from the measured `k/u/d`. Nothing here writes a predicted number into a measured slot. The measured depths stay under evidence-above-zero (unchanged); adopt only overlays targets + design.
- **Task 5 is the one investigation-heavy step** — the re-score-write seam. If the only fresh-score write path is hard to isolate from the reviewer edit-save, preserving the overlay is still SAFE to apply broadly (it's a no-op when the previous draft had no target, and the edit-save's own profile already carries the target so re-copying it is idempotent). When in doubt, apply `preserveAdoptOverlay` at every `upsertCaptureProfile` fresh-score site — it cannot corrupt a non-adopted draft.
- **New competencies a change implies** (spec open question): v1 only overlays targets onto competencies that already exist in the baseline (statement-matched). A change that implies a genuinely-new competency does not add one in v1 — recorded as a deferral in the STATE.md note.
- **Deferred (spec):** the program reconciliation view + target lifecycle rules (clear-when-met / roll-forward) are NOT in this plan.
