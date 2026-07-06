# Capture Review — Calibration Portrait (de-slidered K/U/D review)

**Date:** 2026-07-06
**Status:** Design approved (brainstorm) — implementation plan not yet written.
**Surface:** `app/capture/[code]/ProfileReviewPanel.tsx` (per-competency review card), `lib/ai/capture/schema.ts`, the capture scoring prompt.

---

## Problem

The per-competency review card renders K/U/D as **0–5 sliders** with the number shown (e.g. 4/2/3), and the only way for an instructor to disagree is to **drag the slider**. A slider parked at 2/5 reads as *"your course scored low on this,"* which invites an upward nudge. That is textbook social-desirability + anchoring bias operating directly on the numbers that feed the program-level Q1/Q2 coverage analysis — the measurement instrument is pulling its own inputs upward.

The instrument should elicit a **direction-of-error judgment** ("is our estimate too high or too low?"), recasting the instructor as an **auditor of the tool's estimate** rather than a self-grader of their course — not a magnitude self-report anchored on the max.

## Framework alignment

This design is a UX-forward surfacing of rules the framework and codebase already hold:

- **Evidence-above-zero** (`schema.ts:113–124`): any K>1, or U/D>0, already requires an evidence excerpt. A reviewer raising a score without evidence *already* fails schema validation. This design makes that invariant graceful (an inline evidence prompt) instead of a validation error.
- **K/U/D dissociation is load-bearing** (CLAUDE.md): K-high/U-low = jargon without rationale; D-high/U-low = craft without articulation. Correction must stay per-dimension or that signal is lost.
- **Foundational competencies score on D only** (`schema.ts:109–112`): K/U are `null` and hidden; zero would falsely imply "tried and failed."
- **Reviewer upward moves are already special-cased** (`lib/ai/capture/score-overrides.ts`): `upwardBumps()` detects any dimension moved up from baseline; `ReviewerOverride` records each with a reason; an approval-time guard requires every bump be reasoned.

## The card, end to end

### Default state — a portrait, not a scorecard

The card leads with **one woven description** of the students, assembled from three AI-generated task-specific sentences (K, then U, then D). The numeric read sits muted in the corner — present for the record, never a slider.

```
 Analyze packaging requirements & identify functions…        #2   K3 · U2 · D3
 ──────────────────────────────────────────────────────────────────────────
 Your students can name the package functions and market-positioning
 features on a real package, explain in their own words why a feature
 matters, and identify them independently on familiar package types —
 though they wouldn't yet reason through an unfamiliar or novel case.

 Evidence: 2 materials cited · Rationale ▾

        [  ✓ Sounds like them  ]     [  Something's off  ▾  ]
```

Agree → one tap on **Sounds like them**; the card confirms (maps to the existing per-card `reviewed`-set). No dimensional machinery ever surfaces.

### "Something's off" → compact K/U/D flag row

Only on disagreement does the dimensional structure appear. Default per row is "sounds right," so a partial disagreement is one click on the offending dimension:

```
 Which part?
   Naming     ● sounds right   ○ too high   ○ too low
   Reasoning  ● sounds right   ○ too high   ○ too low
   Doing      ● sounds right   ○ too high   ○ too low
```

### Asymmetric correction (the anti-inflation heart)

- **Too high** → show the *next lower* plain-language anchor(s) for that dimension (from `DEPTH_ANCHORS`, `lib/ai/capture/depth-anchors.ts`); the instructor picks the sentence that fits. Applied immediately — lowering an unsupported estimate is always safe, and the schema refinements never gate downward moves. **No numbers or sliders — anchor sentences only.**

  ```
  Reasoning · too high →  more like:
     ○ "Restates the explanation as given"      (U1)
     ○ "Explains the rationale in own words"     (U2)  ← pick the fit
  ```

- **Too low** → a **dimension-aware evidence prompt** gates the raise. The prompt asks for the kind of evidence that dimension's rule demands — an assessment item for Know, a student reasoning sample for Understand, a graded artifact for Do. The score moves up only once evidence is entered; that text is written into `evidence_{k,u,d}`, satisfying the schema refinement and producing a reasoned `upwardBump`.

  ```
  Reasoning · too low →
     "What shows students reason at a higher level here?
      A student explanation, a reasoning-based exam item…"
      [ ______________________________________________ ]
     (Understand can't go up on syllabus language alone.)
  ```

### Foundational competencies

Render a **Do-only** portrait and a one-row flag ("Doing"). K/U stay `null` and hidden. Too-low on D follows the same evidence gate (D>0 requires `evidence_d`).

### Magnitude, universally

Magnitude is always chosen by **picking an anchor sentence**, never a slider or number, anywhere in the card.

## Data & AI changes

### A. Three new fields on the existing scoring call

Add to `captureCompetencySchema` (`lib/ai/capture/schema.ts:95`):

- `k_says: z.string().nullable()` — task-specific sentence for the assigned K level ("your students…"), grounded in cited evidence, not aspiration.
- `u_says: z.string().nullable()`
- `d_says: z.string().nullable()`

Nullable because foundational K/U are null and pre-feature snapshots lack them. Generated in the **same structured scoring call** that already emits K/U/D + evidence + rationale — no extra round-trip.

**OpenAI strict-mode discipline** (`AI_PROVIDER=openai`): the strict **request** schema lives inline in `lib/ai/analyze/capture-scores.ts` (the `competencies` object `properties` + `required`, ~lines 80–102 / 89). All three new fields must be added to `properties` as `type: ['string','null']` **and** listed in `required`; then re-run the recursive `required`-vs-`properties` audit (per CLAUDE.md). The Zod **parse** schema (`schema.ts`) keeps them `.nullable()` (Campus Qwen tolerates absent fields; OpenAI does not).

The scorer prompt is `lib/ai/prompts/capture-synthesis.md` — its competencies JSON template (~lines 62–69, alongside `k_depth`/`evidence_k`) gains `k_says`/`u_says`/`d_says`, plus one authoring instruction: for each dimension, write one sentence translating that dimension's assigned depth anchor into the concrete skill, in "your students…" voice, grounded in the cited evidence — never syllabus verbs.

### B. Correction storage — reuse existing mechanisms

The panel already edits a `working: CaptureProfile` in place by index (competencies are never reordered/added/removed — the invariant `upwardBumps` relies on).

- **Too-high pick** sets the lower `*_depth`. No evidence required.
- **Too-low (after evidence)** sets the higher `*_depth` **and writes the entered text into `evidence_{k,u,d}`**. This single write (1) satisfies the schema refinement gate, and (2) produces an `upwardBump` whose reason is the evidence, so `assembleOverrides()` + the approval-time reasoned-bump guard keep working unchanged.
- **"Sounds like them"** uses the existing per-card `reviewed`-set confirm. v1 does **not** add a separately-stored per-dimension verdict (YAGNI — affirm vs. correct is already expressible through the reviewed-set and the override records).

### C. Backward-compat / display fallback

Snapshots created before this feature lack `*_says`. The portrait renderer falls back to weaving the generic `describeDepth()` anchor as each clause (what today's UI shows, just in prose). No regeneration required; no new elicitation mode (we chose AI-generated, not a template mode — the fallback is display-only).

## Panel integration (`ProfileReviewPanel.tsx`)

- Replace the per-card slider block + "Looks right ✓" with: portrait + **Sounds like them** / **Something's off** + the flag row.
- Confident rows still roll up (collapsed portraits); the "N to review / M confident" counts are unchanged.
- The approve-lock copy (`ProfileReviewPanel.tsx:1109`) rephrases from "adjust a score / mark Looks right / add a note" to "**affirm or correct each to-review card**." Approval remains an epistemic act, not a click-through.
- "Stress-test this profile" and "Approve the profile" flows are untouched.
- The upward-bump-reason guard at approval stays, now satisfied by the inline too-low evidence.

## Testing

- **Schema:** strict-mode `required`-vs-`properties` audit covers the three new fields (unit + the recursive audit helper); Zod parse accepts null and non-null.
- **Portrait rendering:** weaves three sentences into one description; renders **Do-only** for foundationals; falls back to `describeDepth` when `*_says` is null.
- **Correction:** too-high drops `*_depth` with no evidence required; too-low is blocked until evidence is entered, then raises `*_depth` **and** populates `evidence_{dim}`; `upwardBumps()` reports the raise; the schema refinement passes with the written evidence and fails without it.
- **Panel:** "Sounds like them" marks the card reviewed; the approve-lock releases only when every to-review card is affirmed or corrected.

## Out of scope (YAGNI)

- A separately-stored per-dimension reviewer verdict ("instructor affirmed U2" as distinct from "unchanged default"). Not needed for v1; revisit if the confidence story needs it.
- Regenerating existing snapshots to backfill `*_says` (display fallback covers them).
- Any change to the stress-test or approval flows beyond the approve-lock copy.
- Inline clause-tapping in the portrait (considered; rejected in favor of the compact flag row for build reliability).

## STATE.md triggers (update in the implementing commit)

Schema change (new competency fields), AI-function/prompt change (the scorer emits `*_says`), and a reviewer-path behavior change. Update **What's live** and note the strict-schema field addition; if implementation lands partially, record the remainder in **Deferred / debt**.
