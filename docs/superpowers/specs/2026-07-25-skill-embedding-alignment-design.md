# Skill-Embedding Layer + Cross-Check Alignment — Design

**Date:** 2026-07-25
**Status:** Design (approved in brainstorming; pending spec review → plan)
**Scope:** Slice 1 — a general skill-embedding layer, wired to one consumer (supply→canonical competency alignment) via an LLM×embedding cross-check, with disagreements surfaced for faculty review. Dedup and gap-retrieval are designed-for but out of this spec.

---

## 1. Problem

The Q1 seam (curriculum **supply** vs. career **demand**) resolves both sides to a canonical `sub_competency_id`:

- **Demand:** `career_target_demand` — `(careerTargetId, subCompetencyId) × (kDemand, uDemand, dDemand)`, aggregated from position captures.
- **Supply:** `snapshot_target_coverage` / `coverage_scores` — a course's competencies mapped to `subCompetencyId × (K,U,D)`.

Today the mapping is an **LLM exact-key match**: `program-score-coverage` / `intended-skills-extract` hand the model the canonical catalog and ask it to emit a `sub_competency_id`, then validate the id against the catalog (reject-if-invalid). This is brittle in exactly the ways name-matching is:

- a **near-synonym** gets the wrong id ("prepress color workflow" → the wrong canonical row);
- a **missed connection** drops the supply entirely (course develops X, canonical row for X exists, model didn't connect them);
- a **hallucinated id** is discarded, silently losing the signal.

There is no independent check on the mapping, and no legible record of *how confident* the alignment is.

## 2. Goals / Non-Goals

**Goals (slice 1):**
- A reusable, storage-agnostic **skill-embedding layer** (embed a skill concept, nearest-canonical, similarity, centroid).
- A **cross-check** consumer: the LLM's `sub_competency_id` and an independent embedding match vote; agreements auto-accept, disagreements surface as reviewable items.
- Keep the **K/U/D depth explicit** — the embedding aligns *which* skill; depth stays numeric and does the sufficiency math.
- A **justification** grounded in prior art, added to the background docs.

**Non-goals (explicit YAGNI):**
- Cross-source **dedup/canonicalization** of the competency sprawl (same primitives; later slice).
- **"What's near this gap"** retrieval UX (same primitives; later slice).
- Any change to how *demand* is captured, or to the depth scales.
- Vector **composition** ("skill algebra"): we provide `centroid` (mean-pool, defensible for aggregation) but not additive skill synthesis, which is not a reliable operation.

## 3. Justification (prior art)

Embedding-based mapping of free-text skills to a controlled competency taxonomy is a mature, well-evidenced technique, and the specific pattern we're building — **LLM extraction + embedding alignment to a canonical vocabulary + adjudication/verification** — is established practice for exactly our problem (curriculum↔labor-market alignment).

- **Semantic skill→taxonomy matching is standard.** The skill-extraction/classification literature maps job-posting skills to controlled taxonomies (ESCO, O*NET) via sentence embeddings + cosine similarity; Sentence-BERT (Reimers & Gurevych, 2019) is the workhorse, with domain variants (JobBERT, CareerBERT) and LLM-based matchers (SkillGPT). See the field survey *Deep Learning-based Computational Job Market Analysis* (arXiv:2402.05617) and *Ontology-Aligned Embeddings for Data-Driven Labour Market Analytics* (arXiv:2509.04942).
- **Curriculum→competency matching specifically is an active area.** *UniSkill: A Dataset for Matching University Curricula to Professional Competencies* (arXiv:2603.03134) frames precisely our supply-side task.
- **Our exact pipeline has precedent.** *An NLP-Driven Framework for Curriculum–Labor Market Alignment* describes a four-stage system: schema-constrained LLM extraction → Sentence-BERT alignment against a controlled vocabulary → **inter-model adjudication** → verification, with multi-dimensional gap quantification. That is our cross-check design, and it is the direct citation for it.
- **The cross-check is a recognized hallucination-mitigation pattern.** Retrieval-based verification compares an LLM's output against a trusted source to catch entity errors; grounding entity-linking in a fixed dictionary and *omitting no-exact-match annotations* reduces mislinking (cf. the hallucination survey, ACM TOIS 10.1145/3703155). Our embedding vote is that independent, retrieval-grounded verifier.

**How our design differs (and why):**
1. **Local, evidence-anchored taxonomy, not ESCO/O*NET.** The canonical `sub_competencies` are the GC department's own, each carrying `know/understand/do` descriptors — richer and more specific than a generic ontology row, and the right target for a department's curriculum audit.
2. **Depth is a first-class, separate axis.** Most of the literature does binary skill *presence*. Our alignment is depth-agnostic (embed the concept) and the **K/U/D depth (0–5) stays explicit** — preserving the evidence-above-zero discipline the whole framework rests on. Collapsing depth into the embedding would delete the signal that distinguishes "color management at D2-with-a-checklist" from "at D4-troubleshoot-novel."
3. **Interpretability over automation.** Vectors *propose*; faculty *confirm*. Disagreements become legible review items, consistent with the tool's "maps a committee argues over" ethos — not an opaque auto-relabel.

A condensed version of this section is added to `docs/background.html` (new subsection under the coverage/alignment discussion) so the method is documented and defensible.

## 4. Architecture

**`lib/ai/skill-embedding/` — the foundation layer (four storage-agnostic primitives):**
- `embedSkill(text: string): Promise<number[]>` — embed a skill *concept* via the existing `qwen3-embedding-4b` campus embedder (reuse `lib/ai/embeddings.ts`; no new model).
- `nearestCanonical(vec, k): { subCompetencyId, similarity }[]` — top-k canonical sub-competencies by cosine.
- `similarity(a, b): number` — cosine.
- `centroid(vecs): number[]` — mean-pool (for aggregation use-cases; *not* composition).

**What gets embedded — the concept, depth-agnostic:**
- **Canonical sub-competency:** `name + know_descriptor + understand_descriptor + do_descriptor` (all already in `sub_competencies`).
- **Course competency (supply):** `statement + evidence excerpts`.
- Depth (K/U/D) is never part of the embedded text.

**Storage/compute — start small, designed to grow.** The canonical taxonomy is only dozens of rows, so slice 1 precomputes their vectors into a small **`sub_competency_embeddings`** table (regenerated when a descriptor changes; keyed by `subCompetencyId` + a hash of the descriptor text for staleness detection) and does **in-process cosine**. When the dedup/retrieval consumers arrive (thousands of course/position competency vectors), the same primitives move to **Weaviate** (already deployed) with no interface change.

## 5. Cross-check flow (the consumer)

At coverage-scoring time (`program-score-coverage`, `intended-skills-extract`), for each course competency the LLM already emits a `sub_competency_id`. We add an independent embedding vote and a pure `reconcile()`:

| verdict | condition | action |
|---|---|---|
| **agree** | LLM id ∈ embedding top-k above τ (ideally == top-1) | auto-accept; record high alignment confidence |
| **disagree** | LLM picked A; embedding's top-1 B has similarity ≫ A's | **flag for review** (the core quality signal) |
| **llm-only** | LLM matched, but every canonical is below τ | flag: possible wrong match / genuine new concept |
| **embedding-only** | LLM emitted no match; embedding finds one above τ | flag: possible **missed supply** |

`reconcile(llmId, nearest[], τ)` is a pure function (fully unit-testable). `τ` (similarity floor) and `k` are config constants with sane defaults, tuned against the fixture set (§8).

**Surfacing:** the verdict + the embedding's top-k (with similarities) are recorded alongside the coverage row. Disagreements/flags render on the program-coverage surface via the existing **`faculty_flags`** mechanism (keyed by course×target×sub-comp, so they survive re-scores) — an "alignment ⚑" marker a faculty reviewer can accept or correct. No auto-relabeling.

## 6. Data model

- **New:** `sub_competency_embeddings` — `{ subCompetencyId (pk, fk), vector (jsonb or pgvector), descriptorHash, updatedAt }`.
- **Additive to coverage:** an `alignment` record per scored competency — `{ verdict, llmSubCompetencyId, embeddingTopK: {id, similarity}[], reviewed: bool }`. Stored on/alongside `snapshot_target_coverage` (nullable, additive — no migration risk to existing rows).
- Faculty review reuses `faculty_flags` (no new table).

## 7. Error handling / graceful degradation

- **Embedder unavailable** (campus down, no fallback): the cross-check is **skipped**, not fatal — coverage scoring proceeds LLM-only exactly as today, and the alignment verdict is recorded as `unavailable`. The feature never blocks ingestion.
- **Stale canonical embeddings** (descriptor edited): `descriptorHash` mismatch triggers a lazy re-embed of that row; a missing/failed embed for a canonical row excludes it from that run's `nearestCanonical` (logged), never crashes.
- **Empty candidate set** (no canonical above τ): that's the `llm-only`/`embedding-only` path, handled, not an error.

## 8. Testing

- **Unit:** `reconcile()` across all four verdicts with synthetic vectors; `centroid`/`similarity` numerics; `descriptorHash` staleness.
- **Quality fixture:** a small hand-labeled set of (course competency → correct canonical sub-competency) pairs. Measure the cross-check's agreement/disagreement precision and compare match quality vs. the current LLM-only baseline (does the embedding vote catch real LLM mis-maps without excessive false-flags?). This is the go/no-go signal for τ.
- **Degradation:** embedder-down path yields `unavailable` + unchanged LLM-only scoring.

## 9. Open questions / future slices

- **Dedup consumer:** cluster course/position competency vectors to canonicalize synonym sprawl (feeds taxonomy maintenance). Same primitives, Weaviate-backed.
- **Gap-retrieval consumer:** for an unmet demand, retrieve nearest supply. Same primitives.
- **Threshold governance:** whether τ should be per-career-target (some domains have denser sub-comp spaces than others).
- **pgvector vs. jsonb** for `sub_competency_embeddings` (dozens of rows → jsonb + in-process is fine; revisit if Postgres-side ANN is wanted before the Weaviate move).
