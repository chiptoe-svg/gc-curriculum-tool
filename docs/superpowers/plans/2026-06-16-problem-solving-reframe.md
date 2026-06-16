# Problem-Solving / Productive-Failure Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop framing problem-solving as a deficiency — replace the interview's "you didn't cover problem-solving" warning with an opt-in "One last question" button, and replace the course view's all-`absent` productive-failure list with a one-line qualitative band + a collapsible detail roll-down.

**Architecture:** A pure `problemSolvingBand(block)` helper derives a 4-band qualitative label from the five Area-7 conditions (present=2/partial=1, summed → none/slight/moderate/significant). The `Area7Block`/`PfCond` types move to a shared module so the helper doesn't import the view. `CapturedView`'s `Area7Conditions` renders the band line + a `<details>` roll-down. `CaptureChatPanel` drops the non-coverage warning and gains a "One last question" button that injects a canned turn through the existing send path (no backend change).

**Tech Stack:** TypeScript strict, React (Next.js client component), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-16-problem-solving-reframe-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `lib/ai/capture/area7-types.ts` (new) | `PfCond` + `Area7Block` types (moved from CapturedView so a lib helper can import them without a view dependency) |
| `lib/program/problem-solving-band.ts` (new) | Pure `problemSolvingBand(block)` → `{ band, label, score }` |
| `app/view/[code]/CapturedView.tsx` | Import the moved types + band helper; `Area7Conditions` renders the one-line band + `<details>` roll-down |
| `app/capture/[code]/CaptureChatPanel.tsx` | Remove the non-coverage warning + gating const; factor `sendText(text)` out of `handleSend`; add "One last question" button + `handleOneLastQuestion()` |
| `tests/lib/program/problem-solving-band.test.ts` (new) | Band-helper unit tests |
| `tests/app/capture/one-last-question.test.tsx` (new) | Warning-gone + button-sends-canned-turn test |

---

## Task 1: Shared Area-7 types + the band helper

**Files:**
- Create: `lib/ai/capture/area7-types.ts`
- Modify: `app/view/[code]/CapturedView.tsx` (move types out, re-import)
- Create: `lib/program/problem-solving-band.ts`
- Test: `tests/lib/program/problem-solving-band.test.ts`

- [ ] **Step 1: Move the Area-7 types to a shared module**

Create `lib/ai/capture/area7-types.ts`:

```ts
/** Audit Area 7 (productive-failure / transfer) condition rating. */
export type PfCond = 'present' | 'partial' | 'absent';

/** Per-course Area-7 conditions block as carried on the captured profile. */
export interface Area7Block {
  generate_then_consolidate?: PfCond;
  open_ended_problems?: PfCond;
  revision_cycles?: PfCond;
  structured_post_mortem?: PfCond;
  abstraction_bridging?: PfCond;
  max_supporting_depth?: number | null;
}
```

In `app/view/[code]/CapturedView.tsx`, **delete** the local `type PfCond = ...;` (line ~94) and the `export interface Area7Block { ... }` (lines ~95–102), and add an import near the top with the other imports:

```ts
import type { PfCond, Area7Block } from '@/lib/ai/capture/area7-types';
```

If anything imported `Area7Block` from `CapturedView` before, re-export it for compatibility by adding to CapturedView: `export type { Area7Block } from '@/lib/ai/capture/area7-types';` (check with `grep -rn "Area7Block" --include=*.ts --include=*.tsx app lib tests | grep -v area7-types`; add the re-export only if there are external importers).

- [ ] **Step 2: Write the failing band-helper test**

Create `tests/lib/program/problem-solving-band.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { problemSolvingBand } from '@/lib/program/problem-solving-band';
import type { Area7Block } from '@/lib/ai/capture/area7-types';

const blk = (o: Partial<Area7Block>): Area7Block => ({ ...o });

describe('problemSolvingBand', () => {
  it('all absent → none ("no real")', () => {
    const r = problemSolvingBand(blk({
      generate_then_consolidate: 'absent', open_ended_problems: 'absent', revision_cycles: 'absent',
      structured_post_mortem: 'absent', abstraction_bridging: 'absent',
    }));
    expect(r.band).toBe('none');
    expect(r.label).toBe('no real');
    expect(r.score).toBe(0);
  });

  it('one partial → slight', () => {
    expect(problemSolvingBand(blk({ revision_cycles: 'partial' })).band).toBe('slight');
  });

  it('score 4–7 → moderate', () => {
    const r = problemSolvingBand(blk({ generate_then_consolidate: 'present', revision_cycles: 'present' })); // 2+2=4
    expect(r.score).toBe(4);
    expect(r.band).toBe('moderate');
  });

  it('all present (10) → significant', () => {
    const r = problemSolvingBand(blk({
      generate_then_consolidate: 'present', open_ended_problems: 'present', revision_cycles: 'present',
      structured_post_mortem: 'present', abstraction_bridging: 'present',
    }));
    expect(r.score).toBe(10);
    expect(r.band).toBe('significant');
  });

  it('missing keys contribute 0 and do not throw', () => {
    expect(problemSolvingBand(blk({ open_ended_problems: 'present' })).score).toBe(2);
  });

  it('max_supporting_depth is NOT scored', () => {
    expect(problemSolvingBand(blk({ max_supporting_depth: 5 })).band).toBe('none');
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

Run: `pnpm vitest run tests/lib/program/problem-solving-band.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the helper**

Create `lib/program/problem-solving-band.ts`:

```ts
import type { Area7Block } from '@/lib/ai/capture/area7-types';

export type ProblemSolvingBand = 'none' | 'slight' | 'moderate' | 'significant';

const PF_KEYS = [
  'generate_then_consolidate', 'open_ended_problems', 'revision_cycles',
  'structured_post_mortem', 'abstraction_bridging',
] as const;

const LABELS: Record<ProblemSolvingBand, string> = {
  none: 'no real', slight: 'slight', moderate: 'moderate', significant: 'significant',
};

/**
 * Weighted evidence score over the five present/partial/absent Area-7
 * conditions (present=2, partial=1, absent/unassessed=0) → a qualitative band.
 * `max_supporting_depth` is a separate signal and is NOT scored here.
 */
export function problemSolvingBand(block: Area7Block): { band: ProblemSolvingBand; label: string; score: number } {
  let score = 0;
  for (const k of PF_KEYS) {
    const v = block[k];
    if (v === 'present') score += 2;
    else if (v === 'partial') score += 1;
  }
  const band: ProblemSolvingBand =
    score === 0 ? 'none' : score <= 3 ? 'slight' : score <= 7 ? 'moderate' : 'significant';
  return { band, label: LABELS[band], score };
}
```

- [ ] **Step 5: Run to confirm pass + typecheck**

Run: `pnpm vitest run tests/lib/program/problem-solving-band.test.ts` → 6 pass.
Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "area7-types|problem-solving-band|CapturedView"` → no output.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/capture/area7-types.ts lib/program/problem-solving-band.ts "app/view/[code]/CapturedView.tsx" tests/lib/program/problem-solving-band.test.ts
git commit -m "feat(view): problemSolvingBand helper + shared Area7 types"
```

---

## Task 2: Course-view band line + roll-down

**Files:**
- Modify: `app/view/[code]/CapturedView.tsx` (`Area7Conditions`, ~lines 120–143)
- Test: `tests/app/view/*` (extend if a CapturedView/Area7 test exists; else manual)

- [ ] **Step 1: Replace the Area7Conditions body**

In `app/view/[code]/CapturedView.tsx`, add the band import near the top:

```ts
import { problemSolvingBand } from '@/lib/program/problem-solving-band';
```

Replace the `Area7Conditions` function body (from `<section>` through `</section>`) with:

```tsx
export function Area7Conditions({ block }: { block: Area7Block | null | undefined }) {
  if (!block) return null;
  const depth = block.max_supporting_depth;
  const { label } = problemSolvingBand(block);
  return (
    <section>
      <h2 className="font-display text-lg font-semibold tracking-tight">Problem-solving &amp; critical-thinking habits</h2>
      <p className="mt-2 text-sm text-foreground">
        This course shows <span className="font-semibold">{label} evidence</span> toward building habits of
        problem-solving and critical thinking.
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Condition-by-condition detail
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Audit Area 7 — what the course does to develop transferable problem-solving. A missing row means that
          condition was not assessed, not that it is absent.
        </p>
        <ul className="mt-2 space-y-1.5">
          {AREA7_LABELS.map(({ key, label: condLabel }) => {
            const tone = condTone(block[key] as PfCond | undefined);
            return (
              <li key={key} className="flex items-baseline justify-between gap-4 text-sm">
                <span>{condLabel}</span>
                <span className={'shrink-0 font-medium ' + tone.cls}>{tone.text}</span>
              </li>
            );
          })}
        </ul>
        {depth != null && (
          <p className="mt-2 text-xs text-muted-foreground">Max supporting depth: <span className="font-medium text-foreground">D {depth}</span></p>
        )}
      </details>
    </section>
  );
}
```

(`AREA7_LABELS` and `condTone` already exist in the file and are unchanged. Note the map's destructured label is renamed to `condLabel` to avoid shadowing the band `label`.)

- [ ] **Step 2: Verify**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -i CapturedView` → no output.
Run: `pnpm vitest run tests/app/view 2>&1 | tail -4` → pass. If a test asserted the old always-open condition list or the old heading "Productive-failure & transfer conditions", update it to assert the new band line ("shows {label} evidence") and that the detail is inside a `<details>`.
Manual check (optional): an Area-7 block that's all-absent now renders "shows no real evidence …" with a collapsed detail, not an open all-absent list.

- [ ] **Step 3: Commit**

```bash
git add "app/view/[code]/CapturedView.tsx"
git commit -m "feat(view): problem-solving qualitative band + collapsible condition detail (less consternation)"
```

---

## Task 3: Interview — drop the warning, add "One last question"

**Files:**
- Modify: `app/capture/[code]/CaptureChatPanel.tsx`
- Test: `tests/app/capture/one-last-question.test.tsx` (new)

- [ ] **Step 1: Remove the non-coverage warning**

In `app/capture/[code]/CaptureChatPanel.tsx`:
- Delete the JSX block:
```tsx
          {problemSolvingUnprobed && (
            <p className="mb-2 text-xs text-muted-foreground">
              Heads up: this session didn&rsquo;t cover problem-solving (productive failure), so the profile will record it as <em>not assessed</em> — expected for many courses (a short seminar, for instance). Keep interviewing if this course develops it; otherwise generate as usual.
            </p>
          )}
```
- Delete the const + comment:
```ts
  // Non-blocking: generation always proceeds. When problem-solving / productive
  // failure wasn't probed, the profile still records it honestly as "not assessed"
  // (the no_data band) and we show a neutral heads-up below — no gate, no guilt.
  // Many course types (a 1-hour seminar, say) legitimately don't develop it.
  const problemSolvingUnprobed = canGenerate && !coveredIncludesProblemSolving(coveredEver);
```
- Run `grep -rn "coveredIncludesProblemSolving\|PROBLEM_SOLVING_TOKENS" app lib tests --include=*.ts --include=*.tsx`. If `CaptureChatPanel.tsx` is now the only file referencing them and no test imports them, delete the `PROBLEM_SOLVING_TOKENS` array + `coveredIncludesProblemSolving` export (lines ~13–31). If a test imports `coveredIncludesProblemSolving`, leave the export in place (just remove its use here) and note it as now-unused.

- [ ] **Step 2: Factor `sendText` out of `handleSend`**

Replace:
```ts
  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    onMessagesChange(next);
    setInput('');
    await postChat(next);
  }
```
with:
```ts
  async function sendText(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: t }];
    onMessagesChange(next);
    await postChat(next);
  }
  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    await sendText(text);
  }
  const ONE_LAST_QUESTION = "I think I'm about ready to finish. Before I generate, look back over everything we've covered and ask me the single most important question still missing for an accurate profile. If we haven't explored how students struggle, fail, and revise — productive failure / problem-solving — that's a strong candidate. Ask just one question, in your own words.";
  async function handleOneLastQuestion() {
    await sendText(ONE_LAST_QUESTION);
  }
```

- [ ] **Step 3: Add the "One last question" button**

In the finish area, just above the existing "I'm done — Generate Profile" button (inside the `<div className="mt-1 border-t pt-3">` block, before that button), add:

```tsx
            <button
              type="button"
              onClick={handleOneLastQuestion}
              disabled={!canGenerate || busy}
              className="mb-2 w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              title="Let the interviewer review what's been covered and ask one final, high-value question before you finish."
            >
              Ask me one more important question
            </button>
```

- [ ] **Step 4: Write the test**

Create `tests/app/capture/one-last-question.test.tsx`. Mock the chat fetch (the panel POSTs to the chat API and streams ndjson). The key assertions: (a) the old warning text never renders, (b) clicking the button issues a chat request whose body includes the canned prompt. Adapt the fetch mock to the panel's actual call (inspect `postChat`); a minimal streaming stub:

```ts
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CaptureChatPanel } from '@/app/capture/[code]/CaptureChatPanel';

function streamRes(line: object): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(line) + '\n')); c.close(); },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

describe('CaptureChatPanel — one last question', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      streamRes({ type: 'final', reply: 'Ok — one question: do students revise after a failed press run?', readiness: { score: 60, covered: [], remaining: [], good_enough_to_generate: false } }),
    ));
  });

  function setup() {
    render(
      <CaptureChatPanel
        courseCode="GC 2400" slug="s"
        messages={[{ role: 'assistant', content: 'Opening question?' }]}
        onMessagesChange={() => {}} onGenerate={() => {}}
      />,
    );
  }

  it('does not render the old "didn’t cover problem-solving" warning', () => {
    setup();
    expect(screen.queryByText(/didn.t cover problem-solving/i)).toBeNull();
  });

  it('clicking "Ask me one more important question" sends the canned turn', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /one more important question/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body);
    expect(body).toMatch(/single most important question still missing/i);
  });
});
```

If the panel needs additional required props (check `Props` — e.g. `initialReadiness`, `onConversationChange`, `briefing`), pass minimal stubs. If `postChat` sends the messages array (not a single `text` field), assert the canned text appears anywhere in the serialized body (the `toMatch` above already does that). Adjust the streaming stub shape to whatever `readNdjson`/`postChat` expects if the `final` event differs — the assertions (warning gone; canned text in the request) are what matter.

- [ ] **Step 5: Run + typecheck**

Run: `pnpm vitest run tests/app/capture/one-last-question.test.tsx tests/app/capture` → all pass.
Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -i CaptureChatPanel` → no output.

- [ ] **Step 6: Commit**

```bash
git add "app/capture/[code]/CaptureChatPanel.tsx" tests/app/capture/one-last-question.test.tsx
git commit -m "feat(capture): drop problem-solving non-coverage warning; add 'one last question' button"
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Remove interview non-coverage warning + gating const (+ unused heuristic) | Task 3 Step 1 |
| "One last question" button injects canned turn via existing send path | Task 3 Steps 2–3 |
| Pure `problemSolvingBand` (present=2/partial=1; 0/1–3/4–7/8+; max_supporting_depth excluded) | Task 1 Step 4 |
| Move `Area7Block`/`PfCond` to shared module (avoid lib→view import) | Task 1 Step 1 |
| View one-line band + collapsible roll-down; null block → omitted | Task 2 Step 1 |
| Tests: band thresholds/all-absent/partial/missing-keys; warning-gone + canned-turn | Task 1 Step 2, Task 3 Step 4 |

**Placeholder scan:** none — all code shown; the two "adapt to the panel's actual call" notes in Task 3 Step 4 point at concrete functions (`postChat`, `readNdjson`) and keep the assertions fixed.

**Type consistency:** `Area7Block`/`PfCond` (shared module) used by the helper, CapturedView, and tests; `problemSolvingBand` returns `{ band, label, score }` used in Task 2; `sendText(text)`/`handleOneLastQuestion`/`ONE_LAST_QUESTION` consistent in Task 3.
