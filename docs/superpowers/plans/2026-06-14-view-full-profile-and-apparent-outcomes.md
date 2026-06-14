# `/view` Full Profile + "Apparent Outcomes" Reframe — Implementation Plan (Piece 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/view/[code]` render the full course profile (apparent outcomes, incoming expectations *with* K/U/D depths, class structure, major projects, course emphasis) and reframe `revised_objectives_draft` from "draft objectives to paste" into **"Apparent outcomes"** (always produced), in both the synthesis prompt and the review-panel label.

**Architecture:** No schema change — `revised_objectives_draft` keeps its key (back-compat with immutable snapshots + strict schema); only the synthesis *prompt* text and UI *labels/rendering* change. `CapturedView` (the `/view` render) gains read-only sections for the currently-omitted profile fields, following its existing null-guarded section pattern. No comment/feedback mechanism (that's Piece 2).

**Tech Stack:** Next.js 15 App Router (server component `CapturedView`), TypeScript strict, Vitest + @testing-library/react. AI prompt = markdown in `lib/ai/prompts/`.

**Spec:** `docs/superpowers/specs/2026-06-14-view-full-profile-and-apparent-outcomes-design.md`

**Conventions:** single test `pnpm vitest run <path>`; full suite `pnpm test`; typecheck `pnpm tsc --noEmit` (vitest does NOT typecheck — run explicitly). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Don't `git add` `*.jpeg`/`.playwright-mcp`.

**Profile field shapes (from `lib/ai/capture/schema.ts`):**
- `revised_objectives_draft: string[] | null` — surfaced as "Apparent outcomes".
- `incoming_expectations[]`: `{ statement, expected_depth: { k: number|null, u: number|null, d: number }, confidence, ... }`.
- `class_structure: { topics: string[], cadence: string, assessment: string } | null`.
- `major_projects: { title, description, competencies: string[] }[] | null`.
- `course_emphasis: { competency, points, share_pct, centrality: 'central'|'supporting'|'peripheral' }[] | null`.

**File map:**
- `lib/ai/prompts/capture-synthesis.md` — reframe §6 + the output-shape comment.
- `app/capture/[code]/ProfileReviewPanel.tsx` — relabel `RevisedObjectivesDraft`.
- `app/view/[code]/CapturedView.tsx` — render the full profile.
- `tests/app/view/captured-view.test.tsx` — new component tests.
- `docs/STATE.md`.

---

### Task 1: Reframe the synthesis prompt → "Apparent outcomes"

**Files:**
- Modify: `lib/ai/prompts/capture-synthesis.md` (§6 near line 253, and the output-shape comment near line 115)

- [ ] **Step 1: Reframe §6**

Replace the entire item **6** block (currently starting `6. **\`revised_objectives_draft\` is your synthesized "what to paste" list.**` and ending with the `Set to \`null\` only when…` line) with:

```markdown
6. **`revised_objectives_draft` is your "apparent outcomes" list — ALWAYS produce it.** Based on the materials + interview, emit a CONSOLIDATED 3–6 item list of **what the course actually appears to deliver** — the outcomes the evidence supports, stated as single sentences ("Students prepare production-ready package artwork" / "Students will…"). This is an evidence-grounded *observation* of the course's real outcomes, not a syllabus-correction task:
   - **Ground every item in the evidence** (materials + transcript) — same discipline as the competencies; do not list aspirational outcomes the evidence doesn't support.
   - **Fold in** the catalog objectives that hold up, the better-fit shapes the audit surfaced, and capabilities the materials demonstrably develop that the catalog doesn't name.
   - **Merge near-duplicates** into one outcome — the list should read as a clean set of distinct outcomes, not three paraphrases of the same thing.
   Cap at 6 unless the course genuinely has 6+ distinct outcomes worth naming. Set to `null` only when there is genuinely no evidence to characterize what the course delivers (rare — e.g. an essentially empty materials set).
```

- [ ] **Step 2: Update the output-shape comment**

Near line 115, the output JSON example has `"revised_objectives_draft": [ "<objective>", ... ] or null,`. Change its trailing comment/label to reflect the new meaning — make it read:

```
  "revised_objectives_draft": [ "<what the course appears to deliver>", ... ],   // apparent outcomes; 3–6 items, always produced (null only if no evidence)
```

(Keep it valid as illustrative JSON-with-comments consistent with the rest of that block's style.)

- [ ] **Step 3: Verify no schema break**

The field's Zod/strict schema is unchanged, so the strict-schema walker + capture tests must still pass:
Run: `pnpm vitest run tests/app/capture/ lib/ai` 2>/dev/null; and `pnpm tsc --noEmit`
Expected: green + clean. (This is a prompt-content change — no unit test asserts prose; the gate is "schema unchanged, nothing breaks".)

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/capture-synthesis.md
git commit -m "feat(capture): reframe revised_objectives_draft → always-produced 'apparent outcomes'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Relabel the review-panel block → "Apparent outcomes"

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx` (the `RevisedObjectivesDraft` component near line 655)

- [ ] **Step 1: Check for tests asserting the old label**

Run: `grep -rn "Revised objectives" tests app` — note any test/string. (If a test asserts the old title `"Revised objectives — paste-ready"`, update it in Step 3.)

- [ ] **Step 2: Relabel the component**

Replace the `RevisedObjectivesDraft` function body's `PasteReadyList` props (title + footnote) so it reads:

```tsx
function RevisedObjectivesDraft({ items }: { items: string[] }) {
  return (
    <PasteReadyList
      title="Apparent outcomes"
      items={items}
      footnote="Based on the materials and interview, this is what the course appears to deliver. Copy these into your syllabus if useful; the catalog is not modified automatically."
    />
  );
}
```

(Leave the component name `RevisedObjectivesDraft` and the call site at ~line 1427 unchanged — only the user-visible title/footnote change. The copy-to-clipboard affordance in `PasteReadyList` stays.)

- [ ] **Step 3: Update any test asserting the old title** (only if Step 1 found one) — change the expected string to `"Apparent outcomes"`.

- [ ] **Step 4: Verify**

Run: `pnpm tsc --noEmit` (clean) and `pnpm vitest run tests/app/capture/` (green).

- [ ] **Step 5: Commit**

```bash
git add app/capture/[code]/ProfileReviewPanel.tsx tests/
git commit -m "feat(capture): review panel labels revised_objectives_draft as 'Apparent outcomes'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `/view` — Apparent outcomes section + incoming K/U/D chips

**Files:**
- Modify: `app/view/[code]/CapturedView.tsx`
- Test: `tests/app/view/captured-view.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/app/view/captured-view.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapturedView } from '@/app/view/[code]/CapturedView';

const base = { capturedAt: '2026-06-14T00:00:00.000Z' };

describe('CapturedView — apparent outcomes + incoming depths', () => {
  it('renders the Apparent outcomes section from revised_objectives_draft', () => {
    render(<CapturedView profile={{ competencies: [{ statement: 'x', d_depth: 3 }], revised_objectives_draft: ['Students prepare production-ready artwork'] }} {...base} />);
    expect(screen.getByText(/Apparent outcomes/i)).toBeTruthy();
    expect(screen.getByText(/production-ready artwork/i)).toBeTruthy();
  });
  it('omits Apparent outcomes when null/empty', () => {
    render(<CapturedView profile={{ competencies: [{ statement: 'x', d_depth: 3 }], revised_objectives_draft: null }} {...base} />);
    expect(screen.queryByText(/Apparent outcomes/i)).toBeNull();
  });
  it('shows K/U/D chips on incoming expectations', () => {
    render(<CapturedView profile={{ competencies: [{ statement: 'x', d_depth: 3 }], incoming_expectations: [{ statement: 'Spot-color basics', expected_depth: { k: 2, u: null, d: 3 } }] }} {...base} />);
    expect(screen.getByText(/Spot-color basics/i)).toBeTruthy();
    // D chip always present for incoming
    expect(screen.getByTitle(/Do — depth 3/i)).toBeTruthy();
    expect(screen.getByTitle(/Know — depth 2/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run tests/app/view/captured-view.test.tsx` (no Apparent-outcomes section; incoming has no chips).

- [ ] **Step 3: Implement in `CapturedView.tsx`**

(a) Extend the type interfaces:
```tsx
interface IncomingExpectationShape {
  statement?: string;
  confidence?: string;
  expected_depth?: { k?: number | null; u?: number | null; d?: number | null };
}
```
and add to `CapturedProfile`:
```tsx
  revised_objectives_draft?: string[] | null;
```

(b) In the component body (near the other `const` extractions ~line 132), add:
```tsx
  const apparentOutcomes = profile.revised_objectives_draft ?? [];
```

(c) Add the Apparent-outcomes `<section>` — place it right AFTER the "What students leave able to do" section (after its closing `)}` near line 225):
```tsx
      {/* Apparent outcomes — what the evidence says the course delivers */}
      {apparentOutcomes.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Apparent outcomes
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Based on the materials and interview, this is what the course appears to deliver.
          </p>
          <ul className="space-y-2">
            {apparentOutcomes.map((o, i) => (
              <li key={i} className="text-sm leading-relaxed text-foreground">— {o}</li>
            ))}
          </ul>
        </section>
      )}
```

(d) Replace the incoming-expectations list item render (the `{incoming.map(...)}` block near line 262) with one that adds depth chips:
```tsx
            {incoming.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-relaxed text-foreground">
                <span>— {e.statement}</span>
                {e.expected_depth && (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {e.expected_depth.k != null && <DepthChip label="K" value={e.expected_depth.k} />}
                    {e.expected_depth.u != null && <DepthChip label="U" value={e.expected_depth.u} />}
                    <DepthChip label="D" value={e.expected_depth.d} />
                  </span>
                )}
              </li>
            ))}
```

- [ ] **Step 4: Run, expect PASS + tsc** — `pnpm vitest run tests/app/view/captured-view.test.tsx` green; `pnpm tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add app/view/[code]/CapturedView.tsx tests/app/view/captured-view.test.tsx
git commit -m "feat(view): apparent outcomes section + K/U/D chips on incoming expectations

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `/view` — class structure + major projects + course emphasis

**Files:**
- Modify: `app/view/[code]/CapturedView.tsx`
- Test: `tests/app/view/captured-view.test.tsx` (append)

- [ ] **Step 1: Write the failing test (append)**

```tsx
describe('CapturedView — full profile sections', () => {
  const profile = {
    competencies: [{ statement: 'x', d_depth: 3 }],
    class_structure: { topics: ['Color', 'Prepress'], cadence: 'weekly 2-hour lab', assessment: 'Two projects + a final.' },
    major_projects: [{ title: 'Brand Color Report', description: 'Students measure and report color across media.', competencies: ['color management'] }],
    course_emphasis: [{ competency: 'Color management', points: 120, share_pct: 40, centrality: 'central' as const }],
  };
  it('renders class structure (topics, cadence, assessment)', () => {
    render(<CapturedView profile={profile} {...base} />);
    expect(screen.getByText(/Class structure/i)).toBeTruthy();
    expect(screen.getByText(/Prepress/)).toBeTruthy();
    expect(screen.getByText(/weekly 2-hour lab/)).toBeTruthy();
    expect(screen.getByText(/Two projects \+ a final/)).toBeTruthy();
  });
  it('renders major projects', () => {
    render(<CapturedView profile={profile} {...base} />);
    expect(screen.getByText(/Major projects/i)).toBeTruthy();
    expect(screen.getByText(/Brand Color Report/)).toBeTruthy();
  });
  it('renders course emphasis with centrality + share', () => {
    render(<CapturedView profile={profile} {...base} />);
    expect(screen.getByText(/Course emphasis/i)).toBeTruthy();
    expect(screen.getByText(/central/i)).toBeTruthy();
    expect(screen.getByText(/40%/)).toBeTruthy();
  });
  it('omits each section when its field is null/absent', () => {
    render(<CapturedView profile={{ competencies: [{ statement: 'x', d_depth: 3 }] }} {...base} />);
    expect(screen.queryByText(/Class structure/i)).toBeNull();
    expect(screen.queryByText(/Major projects/i)).toBeNull();
    expect(screen.queryByText(/Course emphasis/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run tests/app/view/captured-view.test.tsx`.

- [ ] **Step 3: Implement in `CapturedView.tsx`**

(a) Extend `CapturedProfile`:
```tsx
  class_structure?: { topics?: string[]; cadence?: string; assessment?: string } | null;
  major_projects?: { title?: string; description?: string; competencies?: string[] }[] | null;
  course_emphasis?: { competency: string; points: number; share_pct: number; centrality: 'central' | 'supporting' | 'peripheral' }[] | null;
```

(b) Add extractions near the others:
```tsx
  const classStructure = profile.class_structure ?? null;
  const majorProjects = (profile.major_projects ?? []).filter(p => p.title);
  const emphasis = (profile.course_emphasis ?? []).filter(e => e.competency);
```

(c) Add three `<section>`s — place them after the incoming-expectations section (before "Strongest evidence"):

```tsx
      {/* Class structure */}
      {classStructure && (classStructure.cadence || (classStructure.topics?.length ?? 0) > 0 || classStructure.assessment) && (
        <section>
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Class structure
          </h2>
          {classStructure.cadence && (
            <p className="mb-2 text-sm leading-relaxed text-foreground">
              <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Cadence: </span>
              {classStructure.cadence}
            </p>
          )}
          {(classStructure.topics?.length ?? 0) > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {classStructure.topics!.map((t, i) => (
                <li key={i} className="rounded border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800/40 dark:text-stone-300">{t}</li>
              ))}
            </ul>
          )}
          {classStructure.assessment && (
            <p className="text-sm leading-relaxed text-foreground">
              <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Assessment: </span>
              {classStructure.assessment}
            </p>
          )}
        </section>
      )}

      {/* Major projects */}
      {majorProjects.length > 0 && (
        <section>
          <h2 className="mb-4 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Major projects
          </h2>
          <ul className="space-y-4">
            {majorProjects.map((p, i) => (
              <li key={i} className="border-l-2 border-stone-200 pl-4 dark:border-stone-700">
                <p className="font-display text-base leading-snug text-foreground">{p.title}</p>
                {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Course emphasis — by point weight */}
      {emphasis.length > 0 && (
        <section>
          <h2 className="mb-1 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Course emphasis — by point weight
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            What the course&apos;s graded work weights, independent of depth scoring.
          </p>
          <ul className="space-y-1.5">
            {emphasis.map((it, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {it.centrality}
                </span>
                <span className="flex-1 text-sm leading-snug text-foreground">{it.competency}</span>
                <span className="shrink-0 font-mono-plex text-[10px] tabular-nums text-muted-foreground">
                  {it.points} pts · {it.share_pct}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 4: Run, expect PASS + tsc** — test green; `pnpm tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add app/view/[code]/CapturedView.tsx tests/app/view/captured-view.test.tsx
git commit -m "feat(view): render class structure, major projects, and course emphasis

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full suite + STATE.md

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Full suite + tsc** — `pnpm tsc --noEmit && pnpm test` (clean + green; report counts).

- [ ] **Step 2: Update STATE.md**

- "What's live"/Active arc: one line — `/view` now renders the full profile (apparent outcomes, incoming K/U/D, class structure, major projects, course emphasis); `revised_objectives_draft` reframed as always-produced "Apparent outcomes"; spec/plan links. Note this is **Piece 1** of a two-piece effort.
- Deferred/debt: add **Piece 2 — guided faculty-reconciliation review** (hybrid stepper + conversational feedback; per-section feedback across apparent outcomes / incoming / outgoing KUDs, reconciled into the profile so the final snapshot is the faculty's view; must preserve evidence discipline — a faculty-overridden KUD becomes faculty-asserted, not silently rewritten as evidenced). Also note the optional `revised_objectives_draft` → `apparent_outcomes` field rename can ride along with Piece 2.

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): /view full profile + apparent-outcomes shipped (Piece 1); record Piece 2

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Plan self-review (done at write time)

- **Spec coverage:** reframe prompt (T1) + review label (T2); `/view` apparent outcomes + incoming depths (T3); `/view` class structure + major projects + course emphasis (T4); STATE.md + Piece-2 record (T5). Field-key kept (no schema change) — asserted by the absence of any schema task. ✓
- **Placeholder scan:** every step has complete code/prose; T1/T2 verification steps are concrete commands. ✓
- **Type consistency:** `revised_objectives_draft: string[] | null`, `expected_depth: {k,u,d}`, `class_structure`/`major_projects`/`course_emphasis` shapes match `schema.ts`; `DepthChip` reused with the same `label`/`value` props as existing outgoing render. ✓
- **Frozen-surface guard:** no change to the capture pipeline, snapshot model, schema keys, or auth; `/view` stays public read-only; no comment mechanism (Piece 2). ✓
