# Problem-Solving / Productive-Failure Reframe — Design

> **Status:** approved-in-conversation 2026-06-16; written for review.
> **Scope:** Two surfaces. (A) Interview: remove the bottom-of-window "you haven't covered problem-solving" warning and replace it with an opt-in "One last question" button. (B) Course view: replace the per-condition `present/partial/absent` productive-failure list with a one-line qualitative band + a collapsible detail roll-down. The AI keeps probing + synthesizing Area 7 exactly as today — only the *framing* on these two surfaces changes.

---

## Goal

Two operator pain points around problem-solving (Audit Area 7 / productive failure):

1. **Interview:** before generating, the chat panel shows a heads-up that "this session didn't cover problem-solving," which reads as a deficiency nag. Many courses legitimately don't aim at it. We want the AI to still *tease it out* during the conversation (gentle language is fine), but not flag non-coverage as a warning at the bottom of the window.
2. **Course view:** the productive-failure section lists each condition as `present/partial/absent`; for the many courses not trying to build it, the all-`absent` list causes consternation (reads as failure, not "not applicable"). We want a single qualitative summary, with the detail available but not front-and-center.

Neither change touches what the AI captures: the interview still probes Area 7 (Section 7 of `capture-chat-agent.md` is unchanged), and synthesis still emits `productive_failure_conditions` honestly. Only the two presentation surfaces change.

---

## Part A — Interview (`app/capture/[code]/CaptureChatPanel.tsx`)

### A1. Remove the non-coverage warning
Delete:
- the `problemSolvingUnprobed` heads-up paragraph (currently "Heads up: this session didn't cover problem-solving (productive failure)…");
- the `problemSolvingUnprobed` const that gates it;
- the `coveredIncludesProblemSolving` helper + `PROBLEM_SOLVING_TOKENS` (remove only if no other module/test imports them — otherwise leave the helper, just stop using it here).

The "I'm done — Generate Profile" button and readiness strip are unchanged. Generation was already non-blocking; removing the warning loses nothing functional (the profile still records Area 7 honestly as `not assessed` when unprobed).

### A2. Add a "One last question" button
A secondary button in the finish area, beside "I'm done — Generate Profile" (e.g., "Ask me one more important question"). Enabled once the conversation has started (`canGenerate`) and not `busy`.

On click, `handleOneLastQuestion()` injects a **canned user turn through the existing send path** (the same code `handleSend` uses to POST to the chat API and stream the reply) — **no backend change**. The canned message:

> *"I think I'm about ready to finish. Before I generate, look back over everything we've covered and ask me the single most important question still missing for an accurate profile. If we haven't explored how students struggle, fail, and revise — productive failure / problem-solving — that's a strong candidate. Ask just one question, in your own words."*

The agent (which already holds all audit areas + the running `readiness.remaining`) then poses one natural question; the faculty answers as a normal turn and proceeds to generate. This converts the deficiency warning into an opt-in "catch what I missed" moment and lets problem-solving surface in the agent's own gentle phrasing rather than as a flag.

Implementation notes:
- Reuse the existing send pipeline: set the canned text as the outgoing message and call the same submit routine `handleSend` uses (factor the POST/stream body into a `sendText(text: string)` helper if `handleSend` currently reads only from the `input` state, so the canned turn doesn't depend on the textarea). The user's turn shows in the transcript like any other.
- The button is advisory; it does not gate generation.

---

## Part B — Course view (`app/view/[code]/CapturedView.tsx`)

### B1. Qualitative band (pure helper)
New `lib/program/problem-solving-band.ts`:

```ts
import type { Area7Block } from '@/app/view/[code]/CapturedView'; // or move Area7Block to a shared type — see note

export type ProblemSolvingBand = 'none' | 'slight' | 'moderate' | 'significant';

const PF_KEYS = [
  'generate_then_consolidate', 'open_ended_problems', 'revision_cycles',
  'structured_post_mortem', 'abstraction_bridging',
] as const;

/** Weighted evidence score over the five present/partial/absent conditions
 *  (present=2, partial=1, absent/absent-or-unassessed=0), mapped to a band.
 *  max_supporting_depth is a separate signal and is NOT scored here. */
export function problemSolvingBand(block: Area7Block): { band: ProblemSolvingBand; label: string; score: number } {
  let score = 0;
  for (const k of PF_KEYS) {
    const v = block[k];
    if (v === 'present') score += 2;
    else if (v === 'partial') score += 1;
  }
  const band: ProblemSolvingBand =
    score === 0 ? 'none' : score <= 3 ? 'slight' : score <= 7 ? 'moderate' : 'significant';
  const label = { none: 'no real', slight: 'slight', moderate: 'moderate', significant: 'significant' }[band];
  return { band, label, score };
}
```

(Type note: `Area7Block` currently lives in `CapturedView.tsx`. To import it cleanly into a `lib/` helper without a circular import, move the `Area7Block`/`PfCond` type definitions into a small shared module — e.g., `lib/ai/capture/area7-types.ts` — and re-export from `CapturedView`. The implementation plan will specify this.)

### B2. Render
In `Area7Conditions` (renders only when `block` is non-null — i.e. Area 7 was probed; unchanged), replace the always-open per-condition `<ul>` with:

- **One-line statement:** *"This course shows **{label} evidence** toward building habits of problem-solving and critical thinking."* (e.g., "…shows no real evidence…", "…shows moderate evidence…"). The band word is visually weighted (e.g., faded for none/slight, normal/emphasized for moderate/significant) but never alarm-colored.
- **Roll-down:** a collapsed `<details>` ("Condition-by-condition detail") containing the existing per-condition `present/partial/absent` list + the "a missing row means not assessed" note + the `max_supporting_depth` line. Discoverable, not front-and-center.

When `block` is null (Area 7 never probed), the section stays omitted entirely — exactly as today. So a course that wasn't probed shows nothing, and a course that was probed but isn't building it shows a calm "no real evidence" line instead of a red all-absent list.

---

## Edge cases

- **Fewer conditions assessed** (older snapshots missing some keys): absent/undefined contribute 0, so the score just lands in a lower band — honest (less evidence captured). No special-casing.
- **`max_supporting_depth`** is not part of the band score (it's a depth number, a different signal); it stays in the roll-down detail.
- **Band thresholds** assume the 5-condition scale (max 10): `0 → none`, `1–3 → slight`, `4–7 → moderate`, `8–10 → significant`.

---

## What this does NOT include

- No change to `capture-chat-agent.md` Section 7 (the agent keeps probing the six conditions; "name the high-depth-but-absent pattern" stays — that's in-conversation framing the operator is fine with, not the bottom-of-window warning).
- No change to synthesis or the `productive_failure_conditions` schema.
- No new gating of generation — "One last question" is advisory.

---

## Files touched

| File | Change |
|---|---|
| `lib/ai/capture/area7-types.ts` (new) | Move `PfCond` + `Area7Block` here; re-export from `CapturedView` |
| `lib/program/problem-solving-band.ts` (new) | Pure `problemSolvingBand(block)` |
| `app/view/[code]/CapturedView.tsx` | `Area7Conditions`: one-line band + `<details>` roll-down; import the band helper + moved types |
| `app/capture/[code]/CaptureChatPanel.tsx` | Remove warning + gating const (+ unused heuristic); add "One last question" button + `handleOneLastQuestion()`; factor `sendText(text)` from `handleSend` |
| Tests | `problem-solving-band.test.ts` (thresholds, all-absent, partial-only, missing keys); CaptureChatPanel test (warning gone; "One last question" sends the canned turn) |

---

## Testing

- **Band helper:** all-absent → none; one partial → slight; mix summing to 4–7 → moderate; all-present (10) → significant; block missing keys → lower band, no throw.
- **View:** `Area7Conditions` with a mostly-absent block renders the one-line "no real evidence" statement and a collapsed detail (not an open all-absent list); a null block renders nothing.
- **Interview:** the "didn't cover problem-solving" warning no longer renders; clicking "One last question" issues a send with the canned text (assert the chat POST body / outgoing message contains the canned prompt) and the button is disabled while busy / before any turn.
