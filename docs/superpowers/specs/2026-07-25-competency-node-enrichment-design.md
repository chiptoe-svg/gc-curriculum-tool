# Competency Node Enrichment + Strict Matching — Design (Stage 1)

**Date:** 2026-07-25
**Status:** Design (approved in brainstorming; pending spec review → plan)
**Program context:** Stage 1 of the **competency-graph substrate** — a canonical competency graph (nodes + relation edges + faculty curation) that serves two consumers: **coverage-identity** (the Q1 supply→canonical seam) and **relatedness/stacking** (prereq, scaffolding, gap-discovery). This spec is Stage 1 only; Stages 2–3 get their own specs.

---

## 1. Problem + why this increment

The shipped Q1 supply→canonical alignment (course competencies → canonical career sub-competencies, in `snapshot_target_coverage`) was measured at **~70–92% wrong** on a 58-row fixture of real matches, judge-robust across a 3-model panel (see [`2026-07-25-q1-alignment-quality-measurement.md`](../2026-07-25-q1-alignment-quality-measurement.md)). A prompt fix (foundational-leak + same-skill-not-topic rules) is deployed and helped directionally, but the feature is still ~70–79% wrong even with the best model — it will not become trustworthy from models/prompts alone.

Two measured root causes are structural, not model-limited:
- **Thin / overlapping canonical nodes** — the `sub_competencies` carry only a name + K/U/D descriptors, too underspecified for reliable "same skill vs same topic" discrimination.
- **Thematic over-crediting** — the matcher credits topical resemblance as a skill match (e.g., "deliver a presentation" → "Proposal development").

**Why nodes first:** enriching the nodes (a) directly attacks both root causes, (b) is a prerequisite for Stage 2 (faculty-confirm-the-matches) and Stage 3 (relation edges), and (c) builds the shared node substrate both consumers need. Embeddings were measured to *not* fix this (identity is an LLM reject/rule/dimension judgment, not a nearest-neighbor problem) — they belong on Stage 3's relatedness edges, not here.

## 2. Goals / Non-Goals

**Goals (Stage 1):**
- Enriched canonical node **definitions** (boundaries, examples, distinguish-from, evidence pattern, aliases), authored AI-draft → faculty-confirm.
- A **strict matching** contract in `program-score-coverage` that uses the enrichment: evidence-required, default "not served," inside-the-boundary (not topical).
- A re-measurement against the existing fixture proving the wrong-rate drops materially.

**Non-Goals (explicit):**
- **Stage 2** — faculty confirming per-course *matches* (coverage *trust*). Stage 1 confirms node *definitions*, once; matches remain AI-produced.
- **Stage 3** — relation **edges** between nodes (relatedness/stacking); no hand-authored node→node links here (Stage 3 derives them from co-occurrence + topic embeddings, then faculty-confirms).
- The model switch (gpt-5.5 → gpt-5.6-sol) is orthogonal and handled separately (a config flip); not part of this spec.
- No change to the coverage-matrix output shape or the demand side.

## 3. Data model

Additive JSONB column on `sub_competencies` (30 rows, evolving shape → JSONB over discrete columns; additive → no migration risk to existing coverage rows):

```
enrichment jsonb  -- nullable; null = not yet enriched
{
  boundaries:      { includes: string, excludes: string },
  examples:        { positive: string[], negative: string[] },
  distinguishFrom: [{ siblingId: string, note: string }],
  evidencePattern: string,          // what artifact evidences this skill
  aliases:         string[],         // stored; lightly used in Stage-1 matching (mainly Stage-3 dedup)
  status:          'ai_draft' | 'faculty_confirmed',
  updatedAt:       string
}
```

Node **edges** are deliberately absent (Stage 3).

## 4. Authoring — AI drafts, faculty confirms

- **New AI function `sub-competency-enrich`.** Input per node: its name + K/U/D descriptors + its sibling nodes (same career target, for `distinguishFrom`) + **the judged fixture's matches for that node** — correct matches → seed positive examples, wrong matches → seed negative examples (grounded in real data, not invented). Output: the `enrichment` object (status `ai_draft`). Strict-schema (OpenAI discipline: every property in `required`, nullable unions for optionals).
- **Faculty review surface.** Extend an existing admin/program surface: list nodes with their draft enrichment; faculty edit/approve → `status: 'faculty_confirmed'`, `updatedAt` stamped. Reuse the existing auth (faculty Basic Auth + slug). This is node-**definition** curation, distinct from Stage-2 match curation.
- **Idempotent + re-runnable:** re-drafting a node overwrites the `ai_draft` but never silently clobbers a `faculty_confirmed` node (re-draft of a confirmed node stages a new draft for re-confirmation).

## 5. Strict matching (`program-score-coverage` change)

- **Thread enrichment into the scoring prompt.** For each sub-competency, include its `boundaries`, `examples` (pos/neg), and `distinguishFrom` alongside the existing descriptors.
- **Tighten the match contract:** a non-None match requires the course competency to fall **inside the node's boundaries** (not merely share a topic) **and** carry a cited evidence excerpt; when the link is only thematic, classify **None**. This composes with the already-deployed foundational-leak + same-skill-not-topic rules.
- **Output shape unchanged** — still one cell per sub-competency (`snapshot_target_coverage`); the matrix simply gets more honest `None`/`d_depth:0` cells instead of low-depth thematic matches. No schema change to coverage rows, no matrix-UI change.
- **Graceful when un-enriched:** a node with `enrichment = null` scores exactly as today (the change is purely additive context) — so partial enrichment is safe and the feature never regresses on un-enriched nodes.

## 6. Validation (go/no-go before Stage 2)

Re-run the fixture measurement (harness: `scripts/_one-off/validate-coverage-fix.ts`) with enriched nodes + strict matching, produced by the current model, **judged by gpt-5.6-sol** (the honest judge; cross-check a sample with glm-5.2). Success criteria:
- meaningful-depth (≥2) wrong-rate drops **materially** from the ~70–79% baseline (target: a clear, judge-robust improvement — exact threshold set in the plan against the enriched fixture);
- foundational→technical leak ≈ 0;
- fewer force-matched cells (more honest None) without dropping genuine matches.
A faculty spot-check on a sample remains the ultimate ground truth.

## 7. Testing

- Unit: `sub-competency-enrich` strict-schema round-trip (recursive required-vs-properties audit); the enrichment JSONB read/write queries; the "un-enriched node scores unchanged" invariant.
- The strict-matching prompt change is validated by §6 (measurement), not unit tests (prompt-driven).

## 8. Open questions / risks

- **Example staleness:** positive/negative examples drawn from current captures can drift as courses change — mitigated by re-draft + faculty re-confirm; not auto-invalidated.
- **Faculty review load:** 30 nodes × rich drafts is real review effort — mitigated by AI grounding (drafts should be mostly-right) and by allowing incremental confirmation (partial enrichment is safe, §5).
- **Prompt size:** threading full enrichment for 5–7 sub-comps per call grows the prompt; bounded (30 nodes total, 5–7 per target call) and well within context.
- **Aliases + precision:** aliases could invite thematic hits; Stage-1 matching uses them only lightly (recall aid), with boundaries/exclusions as the precision guard.
