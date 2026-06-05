# Evidence Ladder — Capture Credibility as a Surfaced Annotation (Design)

> **Status:** design draft, 2026-06-04 — for review. Reframed per the explicit product decision that the tool is **a curriculum-conversation engine first**, measurement later.
>
> **Origin:** an adversarial review of the problem-solving deep-dive (#3, #10) and the [capture-adequacy audit](../2026-06-04-capture-adequacy-audit.md), which independently reached the same bottom line — the tool can produce *beautifully structured maps from weak input evidence*. **This spec subsumes the held "evidence-traceability floor" (audit step 3)** and changes its character: from a *gate* (reject uncited high depths) to a *transparency layer* (show how credible each claim is).

## The principle (the reframe)

For a **measurement instrument**, the honest move is to *reject* a high score that can't be evidenced. For a **conversation engine**, that's wrong twice over: it over-claims (pretends the tool can adjudicate the score) and it's lossy (it discards a real-but-unverified faculty judgment that a committee should still see and weigh).

**The conversation-engine move: surface the credibility of each claim, and never gate the score.** A `D=5` should visibly carry "instructor claim only" vs "rubric-assessed" vs "student-artifact-verified," so faculty and the curriculum committee can argue over a map whose evidential strength is legible. The defense against "structured maps from weak evidence" is not to pretend the evidence is strong — it's to make its strength visible.

## The ladder

The conceptual ladder (from the review), per claim:

| Level | Meaning | Reachable today? |
| --- | --- | --- |
| 0 | Instructor claim only | yes (common) |
| 1 | An assignment prompt / course material supports the claim | yes |
| 2 | A rubric explicitly assesses the condition | yes (if rubrics are ingested + distinguishable) |
| 3 | Student-work artifacts show the condition occurred | **rarely** — student work is mostly not ingested (FERPA) |
| 4 | Pre/post, revision history, or external review confirms a learning effect | no — out of reach until validation data exists |

**Honest practical banding for v1** (what the tool can actually derive today), three bands:

- **Claimed** (≈L0) — the score rests on instructor testimony or inference, with no resolvable material citation.
- **Materials-supported** (≈L1–L2) — the score cites a real course-material chunk (syllabus / assignment / rubric). (Distinguishing prompt from rubric — L1 vs L2 — needs material-type classification; see Open Decisions.)
- **Artifact-verified** (≈L3–L4) — the score cites student-produced evidence. Surfaced as a distinct band but expected to be empty until student-work ingestion exists; its presence in the UI is itself honest (it shows the program how far it is from verified).

## Derivation — compute, don't author (no schema change, works retroactively)

The level is **derived mechanically from signals the snapshot already carries**, at read time. No new schema field, no synthesis change, no migration — and it applies to **every existing snapshot retroactively**.

A pure function (new module, e.g. `lib/program/evidence-ladder.ts`):

```ts
type EvidenceBand = 'claimed' | 'materials_supported' | 'artifact_verified';

function deriveEvidenceBand(claim: {
  source?: 'instructor' | 'materials' | 'inferred';   // CaptureProfileSource
  citations?: CaptureProfileCitation[];                 // chunk / instructor, provenance-checked
}): EvidenceBand;
```

Derivation rules (v1, from existing fields):
- No resolvable citation, or `source === 'inferred'`, or only `instructor`-type citations → **claimed**.
- ≥1 resolvable `chunk` citation (a real course-material chunk) → **materials_supported**.
- A citation resolving to student-produced material → **artifact_verified** (effectively unreachable today; the resolver/material metadata determines this when it ever lands).

This reuses the provenance machinery already shipped: `CaptureProfileSource` (`instructor`/`materials`/`inferred`), the resolvable-citation discipline (`CaptureProfileCitation` requires a real `chunkId`/`messageId`), and the recently-added rule that a credited `structured_post_mortem` must cite a graded artifact (already a step up the ladder).

## Surfacing

1. **Review panel (`/capture/[code]`).** Extend the existing `SourceBadge` (today: instructor/materials/inferred teal/amber/gray) to render the **evidence band** per competency / incoming-expectation / PF condition — a small "claim · materials · artifact" chip, clickable through to the `CitationDrawer` that already exists. This is the primary surface; it makes the strength legible exactly where faculty review the profile.
2. **Program views.** In the matrix and scaffolding rollups, **split "claimed" from "materials-supported"** — e.g., a per-target line "N of M upper-depth cells are materials-supported; K rest on instructor claim." The conversation question becomes "where are our high scores actually grounded?" rather than "how high is the number."
3. **The "unverified high score" flag (this is what step 3 becomes).** Instead of *rejecting* a high depth with no citation, **flag it**: a `D≥3` (or the chosen threshold) cell in the **Claimed** band gets a subtle visual marker ("high score, instructor-claimed — no material cited"). Same information the held hard-floor would have acted on, but surfaced for the conversation instead of gating the score. No synthesis rejection, no lost signal.

## Relationship to the held "evidence-traceability floor" (step 3)

| Held step 3 (gate) | This spec (transparency) |
| --- | --- |
| Zod `superRefine` rejects uncited high depths; synthesizer must cite or downgrade | No rejection. The score stands; its **band** is shown, and high-but-claimed scores are **flagged**. |
| Measurement-grade discipline | Conversation-engine-grade honesty |
| Risk: loses real-but-unverified faculty judgment | Keeps the judgment, labels its strength |

Step 3's two open questions (threshold, hard-vs-soft) collapse: **soft, always** (it's a flag), and the threshold only controls *which* claimed cells get the "unverified high score" marker (recommend `D≥3` or `U≥3` — the "advanced attainment" band, same as the original step-3 proposal).

## Non-goals

- **No score gating / rejection** anywhere — the entire point of the reframe.
- **No student-work ingestion** (FERPA); the `artifact_verified` band is surfaced but expected empty until that's a separate, deliberate build.
- **No migration / no schema change** — the band is computed from existing fields. (A future option to *persist* a derived `evidence_level` is in Open Decisions, not v1.)
- **No change to the depth scores or the synthesis prompts' scoring** — only the credibility annotation is added.

## Decisions (resolved 2026-06-04 — went with all recommendations)

All four resolved to the recommended option: **3 bands**; **defer** prompt-vs-rubric typing (revisit via the Canvas rubric-✓ signal); **compute at read time** (no persist); **light prompt nudge**, bundled whenever rubric typing lands. The detail + rationale per item:

1. **Band granularity.** Three bands (claimed / materials-supported / artifact-verified) for v1, or the full 0–4? *Recommendation: three bands now* — they're honestly derivable; 0–4 is the conceptual frame in the docs.
2. **Prompt-vs-rubric (L1 vs L2).** Distinguishing them needs material-type classification (is the cited chunk a rubric?). *Recommendation: defer* — collapse to "materials-supported" for v1; revisit if the ingestion pipeline starts tagging material types.
3. **Compute vs persist.** Derive at read time (recommended — retroactive, zero schema cost) vs. stamp a derived `evidence_level` into the snapshot at synthesis (immutable record of credibility-at-capture). *Recommendation: compute at read time for v1; persist only if a stable historical record is later needed.*
4. **Should the prompts be nudged to cite rubrics specifically** (to make L2 reachable), even though we won't gate? *Recommendation: a light prompt nudge ("prefer rubric citations for assessed conditions"), no enforcement.*

## Success criteria

- Every scored claim in the review panel shows an evidence band derived from its existing source/citations — with no change to the score itself.
- A high depth (`D≥3`) resting on instructor claim alone is visibly flagged, not rejected.
- Program rollups can answer "how much of our upper-depth surface is materials-supported vs instructor-claimed."
- No migration; the band is correct on every pre-existing snapshot.
- The published docs' "evidence ladder" framing (deep-dive top section) is now backed by a real, visible artifact in the tool.

## Related

- [`docs/superpowers/2026-06-04-capture-adequacy-audit.md`](../2026-06-04-capture-adequacy-audit.md) — the Q1 evidence soft spot this addresses.
- `lib/ai/capture/schema.ts` — `CaptureProfileSource`, `CaptureProfileCitation` (the signals derivation reuses).
- `app/capture/[code]/` — `SourceBadge`, `CitationDrawer` (the surfaces to extend).
- The held step-3 framing in the audit doc's recommendations — superseded by this spec.
