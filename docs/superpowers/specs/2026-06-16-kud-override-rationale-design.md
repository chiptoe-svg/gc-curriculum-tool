# Require a Rationale When Faculty Bump K/U/D Scores Up — Design

> **Status:** approved-in-conversation 2026-06-16; written for review.
> **Scope:** At profile approval, require a per-competency written rationale whenever a faculty raises a K/U/D score above the AI/baseline value, and record each override (what the AI said → what the faculty set → why) in the snapshot. Fixes the A15 guard's inverted incentive.

---

## Goal

Faculty reviewing a generated Course Outcome Profile can drag the K/U/D sliders freely and approve with no justification. Operator observation: *it's very tempting to bump scores up* — especially in lower-level courses where we only expect depth 1–2. The synthesis layer is deliberately conservative ("score low; faculty correct upward"), so **upward edits are both expected and exactly where unjustified inflation enters.** This adds a lightweight, targeted guard: an upward bump requires a one-line reason before the profile can be **approved**, and the override is preserved as a permanent audit record.

---

## Background — the A15 inversion

The approve guard today:

```
approveUnlocked = dirty || allWorthLookReviewed || noteSubstantive
```

So *making any edit* (`dirty`) **alone** unlocks Approve. That inverts the incentive: editing scores currently demands *less* justification than leaving them untouched (where you'd need to review every flagged row or write a ≥20-char note). Overriding an evidence-grounded score is precisely when a recorded reason matters — and an edited score otherwise silently detaches from the `evidence_*` excerpts that justified the AI's value (the evidence-ladder / trust model).

---

## Trigger & detection

The review panel already holds two profiles: the **baseline** (`profile` prop, as loaded into this session) and the live **`working`** copy. For each competency, matched **by array index** (the panel edits competencies in place — it never reorders, adds, or removes them, so indices stay aligned with the baseline), a dimension is an **upward bump** when:

```
working[i].<dim>_depth  >  baseline[i].<dim>_depth     // dim ∈ {k, u, d}
```

- Foundational competencies have `k_depth`/`u_depth` = `null` (only D is meaningful), so only the **D** dimension can bump there.
- Downward or unchanged edits never trigger the requirement (conservative corrections stay friction-free).
- A pure helper computes this:

```ts
interface UpwardBump { index: number; statement: string; changes: { dim: 'k' | 'u' | 'd'; from: number; to: number }[]; }
function upwardBumps(baseline: CaptureCompetency[], working: CaptureCompetency[]): UpwardBump[]
```

`baseline` is the session-loaded profile, so this catches **in-session inflation** — the live "watching them bump sliders" case. Cumulative drift across multiple save sessions (where a prior save becomes the new baseline) is a deferred refinement (would require stamping the original AI scores; see "What's NOT included").

**Evidence-line subset (the hard cases):** bumps that cross an evidence threshold — K into ≥2, U/D into ≥1 — are the non-negotiable subset (they enter territory the schema says needs evidence the AI didn't supply). They're already covered by "any upward bump requires a reason"; no separate rule, but the UI hint calls them out.

---

## UI — inline reason on the bumped row

When a competency card has ≥1 upward-bumped dimension, an inline **"Why this higher depth?"** `<textarea>` renders directly under its sliders, showing:

- the change(s): e.g. `D 1 → 4`, `K 1 → 3`;
- a **level-aware hint** when the course level is available to the panel: e.g. *"This is a 2000-level course — a depth of 3+ is unusual here. Cite the assignment, rubric, or graded artifact that supports it."* When level isn't available, a generic evidence prompt is shown instead (*"Cite the student-side evidence that supports this higher depth."*).

One reason per competency (it covers all of that row's bumped dimensions). The field appears immediately on bump and can be filled anytime; it is only **required** to Approve (see gate). An empty/whitespace reason on a bumped row counts as missing. If the faculty later lowers the score back to/under baseline, the row is no longer a bump and its reason is no longer required (and is dropped from the recorded overrides).

---

## Gate — fix the inversion (block Approve only)

Add a hard requirement layered onto the existing guard:

```
allUpwardBumpsJustified = upwardBumps(baseline, working).every(b => reason(b.index)?.trim().length > 0)
approveUnlocked = (dirty || allWorthLookReviewed || noteSubstantive) && allUpwardBumpsJustified
```

- **Approve** (the act that writes the permanent snapshot) is blocked until every upward-bumped row has a non-empty reason. The approve button's lock message names the count: *"N raised score(s) need a reason before you can approve."*
- **Save edits** (draft) is **not** blocked — faculty can park a half-finished review. (Optional: a soft inline note that unsaved bumps still need reasons before approval.)
- Conservative (downward/lateral) edits still unlock Approve via `dirty` with no reason, as today.

This keeps the low-friction path for everything except the one risky move (inflation), which now requires a recorded justification.

---

## Data model & persistence (the audit record)

At `persist()`/approve time, assemble the override records by diffing `working` vs baseline and pairing with the entered reasons:

```ts
interface ReviewerOverride {
  statement: string;                                  // the competency, for human-readable provenance
  changes: { dim: 'k' | 'u' | 'd'; from: number; to: number }[];
  reason: string;
}
```

Store as a new **optional** field on `CaptureProfile`:

```ts
reviewer_overrides: z.array(reviewerOverrideSchema).nullable().optional(),
```

- **No migration** — `CaptureProfile` is JSON; the field is optional/nullable, so existing profiles and snapshots parse unchanged.
- It is part of the `working` profile passed to `onSave`, so it persists with the draft and **freezes into the snapshot** — a permanent record of *what the AI scored, what the faculty set it to, and the stated reason.*
- Reasons live in component state (a `Map<index, string>`) during editing and are assembled into `reviewer_overrides` only at persist time (no per-keystroke profile mutation). On load, if the profile already carries `reviewer_overrides` (a re-review), seed the reason map from it so prior reasons aren't lost.

---

## What this does NOT include (deferred)

- **Cumulative-drift detection** across save sessions — baseline is the session-loaded profile, not the immutable original AI output. Catching multi-session creep would need the synthesis to stamp original AI scores (a schema change). Deferred.
- **Surfacing overrides downstream** — showing the override + reason on `/view/<code>` or in the `/program` matrix cell drawer ("faculty raised this from D2→D4: …") would strengthen the public trust story, but v1 only records them in the snapshot. Deferred.
- **Per-dimension reasons** — one reason per competency, not one per K/U/D. (Chosen for lower friction; the `changes[]` array still records each dimension's from→to.)
- **Downward-edit justification** — out of scope; conservative edits are not the risk.

---

## Files touched

| File | Change |
|---|---|
| `lib/ai/capture/score-overrides.ts` (new) | Pure `upwardBumps(baseline, working)` + `assembleOverrides(baseline, working, reasons)` helpers |
| `lib/ai/capture/schema.ts` | Add `reviewerOverrideSchema` + optional `reviewer_overrides` field on `captureProfileSchema` |
| `app/capture/[code]/ProfileReviewPanel.tsx` | Reason `Map` state; inline "Why this higher depth?" field on bumped cards (level-aware hint); `allUpwardBumpsJustified` gate folded into `approveUnlocked`; assemble `reviewer_overrides` into the profile at `persist()`; seed reasons from an existing profile on load; pass course level to the card if available |
| Tests | `upwardBumps`/`assembleOverrides` unit tests (technical, foundational D-only, up/down/null, threshold-crossing); panel test: Approve blocked with an unjustified bump and unlocked once a reason is entered; downward edit needs no reason; `reviewer_overrides` assembled correctly + excludes reverted bumps |

---

## Testing

- **Detection helper (pure):** technical competency bump on each dim; foundational bump (D only; null K/U ignored); downward and unchanged → empty; threshold-crossing flagged; multi-dimension bump → one `UpwardBump` with multiple `changes`.
- **Assembly:** reverting a bump to ≤ baseline removes it from the output; reasons map correctly to competencies by index/statement.
- **Gate:** with one unjustified upward bump, `approveUnlocked` is false (Approve disabled, message shows the count); after a non-empty reason, it unlocks; a downward-only edit unlocks with no reason; an unchanged profile behaves as today.
- **Backward compat:** a profile/snapshot without `reviewer_overrides` parses and renders unchanged.
