# Explore Thinking-Partner — Plan 2b: Chat UI + Retirement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the (already-built, harness-proven) Explore agent as the whole `/explore/[code]` experience — inline **scenario cards** in the chat with Save/Compare/Adopt affordances — and retire the old custom-target/downstream/what-if machinery.

**Architecture:** `AskTab` is already the Explore chat surface (it defaults to `/api/explore/[code]/chat` when `courseCode` is set, which now streams `streamExploreAgent`). Extend it minimally to handle the new `scenario`/`comparison` stream events (inert for `/ask` + `/wiki`, which never emit them) and render a `ScenarioCard`. Save = a small caption route; Compare = conversational (reuses the agent's `compare_scenarios` tool → a `comparison` event); Adopt = a disabled "soon" placeholder (the #188 hook). Then delete the old client/routes/AI-functions and drop the 3 old tables.

**Tech Stack:** Next.js/React, TypeScript strict, Zod, Drizzle, Vitest + @testing-library/react. Builds on merged Plan 2a (`lib/ai/explore/agent.ts` + the repurposed chat route).

**Spec:** [`2026-07-08-explore-thinking-partner-agent-ui-design.md`](../specs/2026-07-08-explore-thinking-partner-agent-ui-design.md).

---

## Reused interfaces

- `AskTab` (`components/AskTab.tsx`) — `AskMessage = { role; content; citations?; toolCalls? }`; `readNdjson(res, onEvent)`; the `send` handler switches on `ev.kind` (`tool-start`/`text-delta`/`final`/`error`); message rendering via `messages.map(...)`. Defaults `endpoint` to `/api/explore/[code]/chat` when `courseCode` set.
- Stream events from `streamExploreAgent`: `{ kind:'scenario'; scenario: Scenario }`, `{ kind:'comparison'; a; b; diff: ScenarioComparison }` (+ the usual tool-start/text-delta/final/error). **Cards arrive only on turn success** (mid-turn error discards them — noted in the agent).
- `Scenario` (`lib/ai/explore/scenario.ts`): `.change.activity`, `.predictedDeltas[{competency, from{k,u,d}, to{k,u,d}, confidence}]`, `.computedRipple[{kind, label, before, after, courseCode?}]`, `.caption`.
- Repo: `getScenario`/`saveScenario`/`listScenarios` (`lib/db/explore-scenario-queries.ts`).
- Retirement targets: `app/explore/[code]/ExploreClient.tsx`; routes `app/api/explore/[code]/{analyze,build-downstream,downstream-candidates,draft-custom,targets,what-if}`; `lib/db/explore-queries.ts` (`listTargetsByCourse`/`listAnalysesByCourse`); AI fns `lib/ai/analyze/explore-{compare,draft-target,what-if}.ts` + prompts `lib/ai/prompts/explore-{compare,draft-target,what-if}.md`; tables `courseExploreTargets/Analyses/WhatIfs` (`lib/db/schema.ts`). **Keep:** the `chat` route, `explore-local-delta`, the `explore-agent` prompt, `courseExploreScenarios`.

---

## Task 1: `ScenarioCard` component

**Files:** Create `app/explore/[code]/ScenarioCard.tsx`; Test `tests/app/explore/scenario-card.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScenarioCard } from '@/app/explore/[code]/ScenarioCard';
import type { Scenario } from '@/lib/ai/explore/scenario';

const scenario: Scenario = {
  id: 's1', courseCode: 'GC 3460', baselineSnapshotId: 'b',
  change: { prose: 'add a trapping lab', activity: 'trapping lab', artifact: 'graded', competencies: ['prepress'], rubricCriteria: ['registration'], assumesIncoming: [] },
  predictedDeltas: [{ competency: 'prepress preparation', from: { k: 2, u: 2, d: 3 }, to: { k: 3, u: 2, d: 4 }, confidence: 'medium', rationale: 'r' }],
  computedRipple: [{ kind: 'downstream_gap', courseCode: 'GC 4440', subCompetencyId: 'sc', label: 'trapping', before: 'gap', after: 'met' }],
  caption: null, createdAt: '2026-07-08T00:00:00.000Z',
} as Scenario;

describe('ScenarioCard', () => {
  it('renders the change, a predicted delta, and a ripple line', () => {
    render(<ScenarioCard scenario={scenario} onSave={() => {}} onCompare={() => {}} />);
    expect(screen.getByText(/trapping lab/)).toBeInTheDocument();
    expect(screen.getByText(/prepress preparation/)).toBeInTheDocument();
    expect(screen.getByText(/D3\s*→\s*4/)).toBeInTheDocument();
    expect(screen.getByText(/trapping/)).toBeInTheDocument();
    expect(screen.getByText(/gap\s*→\s*met/)).toBeInTheDocument();
  });
  it('fires onSave and onCompare; Adopt is disabled', () => {
    const onSave = vi.fn(); const onCompare = vi.fn();
    render(<ScenarioCard scenario={scenario} onSave={onSave} onCompare={onCompare} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    fireEvent.click(screen.getByRole('button', { name: /compare/i }));
    expect(onSave).toHaveBeenCalledWith('s1');
    expect(onCompare).toHaveBeenCalledWith('s1');
    expect(screen.getByRole('button', { name: /adopt/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `app/explore/[code]/ScenarioCard.tsx`** (client component). Renders a bordered card: header = `Scenario · "${scenario.caption ?? scenario.change.activity}"`; a CHANGE line (`scenario.change.activity` + artifact); a PREDICTED block (each delta as `${competency}  K${from.k}→${to.k} U… D${from.d}→${to.d} (${confidence})` — show only dimensions that changed, always show D); a RIPPLE block (each line as an arrow glyph by kind — `↓` downstream_gap, `↑` upstream_gap, `→` career_fit — then `label: before → after`, with `courseCode` prefix when present); and a footer with three buttons: `Save` (`onClick={() => onSave(scenario.id)}`), `Compare` (`onClick={() => onCompare(scenario.id)}`), and `Adopt · soon` (`disabled`, `title="Coming soon — adopt this scenario as the course's next planned version"`). Props: `{ scenario: Scenario; onSave: (id: string) => void; onCompare: (id: string) => void }`.

- [ ] **Step 4: Run, verify PASS** (2 tests); `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add 'app/explore/[code]/ScenarioCard.tsx' tests/app/explore/scenario-card.test.tsx && git commit -m "feat(explore): ScenarioCard — inline change/deltas/ripple + Save/Compare/Adopt-soon"`

---

## Task 2: `ComparisonCard` component

**Files:** Create `app/explore/[code]/ComparisonCard.tsx`; Test `tests/app/explore/comparison-card.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComparisonCard } from '@/app/explore/[code]/ComparisonCard';

it('renders which deltas and ripple lines differ', () => {
  render(<ComparisonCard
    aCaption="trapping v1" bCaption="trapping v2"
    diff={{
      deltaChanges: [{ competency: 'prepress', aTo: { k: 2, u: 2, d: 4 }, bTo: { k: 2, u: 2, d: 5 } }],
      rippleOnlyInA: [{ kind: 'downstream_gap', label: 'trapping', before: 'gap', after: 'met' } as any],
      rippleOnlyInB: [],
    }} />);
  expect(screen.getByText(/trapping v1/)).toBeInTheDocument();
  expect(screen.getByText(/trapping v2/)).toBeInTheDocument();
  expect(screen.getByText(/prepress/)).toBeInTheDocument();
  expect(screen.getByText(/only in .*trapping v1/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `ComparisonCard`** — props `{ aCaption: string; bCaption: string; diff: ScenarioComparison }` (import `ScenarioComparison` from `@/lib/ai/explore/compare`). Renders a header naming the two scenarios, a "deltas that differ" list (`${competency}: A D${aTo.d} vs B D${bTo.d}`, handling null aTo/bTo as "—"), and two "only in A / only in B" ripple lists (label + before→after).

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add 'app/explore/[code]/ComparisonCard.tsx' tests/app/explore/comparison-card.test.tsx && git commit -m "feat(explore): ComparisonCard — scenario diff rendering"`

---

## Task 3: Save-caption route

**Files:** Create `app/api/explore/[code]/scenarios/[id]/route.ts`; Test `tests/app/api/explore-scenarios-route.test.ts` (light).

- [ ] **Step 1: Write a light failing test** (module-shape: exports PATCH, uses slug auth + the repo):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('scenarios/[id] route: PATCH sets caption via the repo, slug-gated', () => {
  const src = readFileSync('app/api/explore/[code]/scenarios/[id]/route.ts', 'utf8');
  expect(src).toContain('export async function PATCH');
  expect(src).toMatch(/isValidSlug|slug/);
  expect(src).toMatch(/saveScenario|getScenario/);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `PATCH /api/explore/[code]/scenarios/[id]`** following the auth pattern of the existing `chat` route (validate `slug` → 401, decode params). Body `{ caption: string }`. Load `getScenario(id)` (404 if missing or `courseCode` mismatch), then `saveScenario({ ...s, caption })`, return `{ ok: true }`. (No new list/compare route — Compare is conversational; the agent's `compare_scenarios` tool handles it.)

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean; `pnpm vitest run tests/app/api/` green.
- [ ] **Step 5: Commit** — `git add 'app/api/explore/[code]/scenarios/[id]/route.ts' tests/app/api/explore-scenarios-route.test.ts && git commit -m "feat(explore): PATCH scenarios/[id] to set a caption (Save)"`

---

## Task 4: Wire scenario cards into `AskTab`

**Files:** Modify `components/AskTab.tsx`; Test `tests/components/ask-tab-scenario.test.tsx`.

- [ ] **Step 1: Write the failing test** — drive `readNdjson`-style events through a mounted `AskTab` by mocking `fetch` to return an NDJSON body containing a `scenario` event + a `final`, and assert a scenario card renders. (Model the mount on an existing AskTab test if present; else mock `global.fetch` to return `{ ok:true, body: <ReadableStream of NDJSON lines> }`.) Minimum assertion: after a send, the transcript contains the scenario's activity text rendered inside a card (e.g. `screen.getByText(/trapping lab/)`).

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Extend `AskTab`:**
  - `AskMessage` gains `scenarios?: Scenario[]` and `comparisons?: Array<{ aCaption: string; bCaption: string; diff: ScenarioComparison }>` (import the types).
  - In the `send` handler's event switch, add:
    - `kind === 'scenario'` → append `ev.scenario` to the last assistant message's `scenarios` (mirror the `toolCalls` accumulation pattern).
    - `kind === 'comparison'` → append `{ aCaption: ev.a.caption ?? ev.a.change.activity, bCaption: ev.b.caption ?? ev.b.change.activity, diff: ev.diff }` to `comparisons`.
  - In the message renderer, after the assistant content, render `message.scenarios?.map(s => <ScenarioCard scenario={s} onSave={handleSave} onCompare={handleCompare} />)` and `message.comparisons?.map(c => <ComparisonCard .../>)`.
  - `handleSave(id)` → prompt for a caption (`window.prompt('Name this scenario:')`), then `fetch('/api/explore/${courseCode}/scenarios/${id}?slug=${slug}', { method:'PATCH', body: JSON.stringify({ caption }) })`; on success, optimistically update the card's caption in state.
  - `handleCompare(id)` → `send('Compare this scenario with another saved one — list my saved scenarios first if needed.')` (conversational; the agent's list/compare tools do the work and emit a `comparison` event).
  - Guard: these branches only fire when the events arrive (curriculum-chat never emits them), so `/ask` + `/wiki` are unaffected — confirm by leaving their behavior untouched.

- [ ] **Step 4: Run, verify PASS** (`pnpm vitest run tests/components/`), `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add components/AskTab.tsx tests/components/ask-tab-scenario.test.tsx && git commit -m "feat(explore): render inline scenario/comparison cards in AskTab; Save (route) + Compare (conversational)"`

---

## Task 5: Point `/explore/[code]` at the chat surface

**Files:** Modify `app/explore/[code]/page.tsx`.

- [ ] **Step 1: Write the failing test** `tests/app/explore/explore-page-chat.test.tsx` — a source-shape test that the page no longer imports `ExploreClient` and renders `AskTab`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('explore page renders the chat surface, not the old client', () => {
  const src = readFileSync('app/explore/[code]/page.tsx', 'utf8');
  expect(src).not.toContain('ExploreClient');
  expect(src).not.toContain('listTargetsByCourse');
  expect(src).toContain('AskTab');
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Rewrite `page.tsx`** to render `<AskTab courseCode={courseCode} courseTitle={course.title} slug={slug} />` as the main surface (keep the slug gate, the header/back-links, and the FeedbackLink). Remove the `listTargetsByCourse`/`listAnalysesByCourse` fetch and the `ExploreClient` import + the `?tab=ask` special-case branching (the whole surface is now the chat). Keep the snapshot fetch ONLY if the header displays snapshot info; otherwise drop it too. Preserve the "invalid slug → access-link-required" screen.

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add 'app/explore/[code]/page.tsx' tests/app/explore/explore-page-chat.test.tsx && git commit -m "feat(explore): /explore/[code] renders the thinking-partner chat (replaces ExploreClient)"`

---

## Task 6: Retire the old machinery (code)

**Files:** Delete `app/explore/[code]/ExploreClient.tsx`; the 6 route dirs `app/api/explore/[code]/{analyze,build-downstream,downstream-candidates,draft-custom,targets,what-if}`; `lib/db/explore-queries.ts`; `lib/ai/analyze/explore-{compare,draft-target,what-if}.ts`; `lib/ai/prompts/explore-{compare,draft-target,what-if}.md`. Modify `lib/ai/function-settings.ts`, `lib/ai/prompts/load.ts`, `lib/ai/explore/schema.ts` (the old target/what-if zod, if unused now).

- [ ] **Step 1: Grep-confirm nothing live imports the retirees.** For each target, `grep -rn "<name>" app lib --include='*.ts' --include='*.tsx' | grep -v node_modules` and confirm only the retiree itself + other retirees reference it (nothing kept). Note especially: does anything still import `explore-queries` / the old AI fns / the old routes? (The page stopped importing `explore-queries` in Task 5.)

- [ ] **Step 2: Delete** the files/dirs listed above. Deregister `explore-compare`, `explore-draft-target`, `explore-what-if` from `AI_FUNCTION_IDS`/`DEFAULT_TIERS`/labels in `function-settings.ts` and from the `PromptName` union in `load.ts`. If `lib/ai/explore/schema.ts` (the OLD `TargetSpec`/`WhatIfResult`/etc.) is now unused, delete it too (grep first); if the new engine reuses any of it, keep only what's used.

- [ ] **Step 3: Typecheck + test** — `pnpm tsc --noEmit` (fix any dangling import the deletions exposed), `pnpm vitest run` (delete any test files that tested the retired modules — `grep -rln 'explore-what-if\|explore-draft-target\|explore-compare\|ExploreClient\|listTargetsByCourse' tests` and remove the now-dead tests).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore(explore): retire old custom-target/downstream/what-if machinery (routes, AI fns, client)"`

---

## Task 7: Drop the old tables + STATE.md + full suite

**Files:** Modify `lib/db/schema.ts`; create a migration; Modify `docs/STATE.md`.

- [ ] **Step 1: Back up + drop the 3 tables.** First `pg_dump` them to a backup file for safety: `pg_dump "postgresql://admin@127.0.0.1:5433/gc_curriculum" -t course_explore_targets -t course_explore_analyses -t course_explore_what_ifs > /tmp/explore-old-tables-backup.sql` (they're empty/near-empty; the dump is a safety net). Remove `courseExploreTargets`/`courseExploreAnalyses`/`courseExploreWhatIfs` from `lib/db/schema.ts`, then `pnpm db:generate` to emit the DROP migration; review the generated SQL is exactly three `DROP TABLE`s (no other table touched). Do NOT run `db:migrate` against a shared DB without confirming.

- [ ] **Step 2: Full suite + typecheck** — `pnpm vitest run` (all green), `pnpm tsc --noEmit` (clean).

- [ ] **Step 3: Update STATE.md** — mark Plan 2b DONE: the new thinking-partner chat is the whole `/explore/[code]` (ExploreClient + old routes/AI-fns/tables retired); `ScenarioCard`/`ComparisonCard` render inline; Save via `PATCH scenarios/[id]`, Compare conversational, Adopt is a disabled "soon" placeholder (the #188 hook). Update the **What's live** routes list (7 explore routes → `chat` + `scenarios/[id]`), AI-function IDs (drop the 3), and the schema (drop 3 tables). Note #188 (adopt) is now unblocked — its build slot is the card's Adopt button.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore(explore): drop old explore tables; STATE.md — Plan 2b (thinking-partner UI) is now the whole /explore"`

---

## Notes for the implementer

- **Cards only arrive on turn success** (the agent discards emitted scenarios on a mid-turn error). The UI already drops the placeholder assistant message on error — so a failed turn simply shows no card; that's acceptable.
- **`/ask` + `/wiki` are unaffected** — they use `streamCurriculumChat`, which never emits `scenario`/`comparison`, so the new AskTab branches stay dormant there. Do NOT special-case by surface; the event-presence guard is sufficient.
- **Adopt stays disabled** — it is the #188 hook. Do not wire it; #188's plan does.
- **Retire in order:** Task 5 (page stops importing the old stuff) BEFORE Task 6 (delete), so the compiler helps you find every dangling reference. Drop tables (Task 7) last.
- **`window.prompt` for the caption** is a deliberate v1 simplicity — a nicer inline caption input is later polish.
