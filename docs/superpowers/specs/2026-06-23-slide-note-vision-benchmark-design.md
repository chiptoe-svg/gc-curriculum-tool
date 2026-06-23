# Slide-note vision benchmark — Design (Spec A)

**Date:** 2026-06-23
**Status:** Proposed (brainstorming-approved 2026-06-23)
**Surface:** `lib/capture/slide-vision.ts` (`describeSlide`, `SlideNote`, `SLIDE_VISION_MODEL`), the `~/.local/share/gc-curriculum-tool/vision-bench/` harness, and the middle-tier slide path in `lib/capture/finalize-extraction.ts` (consumer).
**Relationship:** Spec A of a two-spec split. **Spec B** (`2026-06-23-ingest-provider-estimates-completion-design.md`) is the ingestion-UX feature (estimates + use-local toggle + completion gate); it consumes Spec A's chosen slide model for its local-vision path and estimate constants. Spec A ships independently and does not block Spec B.

---

## 1. Motivation

Middle-tier slide decks are ingested via `describeSlide()` (`lib/capture/slide-vision.ts`), which sends each rendered page to a **local omlx vision model** — `SLIDE_VISION_MODEL`, default `gemma-4-E4B-it-MLX-8bit` — and returns a `SlideNote {topic, teaches, keyVisual, contentLevel}`. For a substantive slide, `finalize-extraction.ts:252` embeds `[topic, teaches, keyVisual].join('\n')` as **the slide's only chunk in the retrieval index**. So the note *is* the slide's entire footprint for the KUD/coverage audit: whatever the model fails to capture is invisible to the analysis — the slide effectively didn't teach it.

Two facts make the current state suspect:

1. **`gemma-4-E4B` was never benchmarked for this task.** It was wired in commit `2ad5e7c` ("feat(triage): per-slide vision note via omlx gemma-4-E4B") and assumed adequate. The 2026-06-23 vision bench (`vision-bench/README.md`) tested a *different, harder* task — full-text transcription (`transcribeDocument`) — and found local gemma-4 at every size fails on fine print, with `gemma-4-31B` prone to repetition-loop garbage on dense slides and `Qwen3.6-35B-A3B` (thinking off) the only viable local transcriber (~9–23 s/slide).
2. **The describe task's required fidelity is undefined.** `describeSlide` deliberately does not transcribe — but no one has established what it *must* capture for the downstream audit to have real K/U/D evidence, nor whether `gemma-4-E4B` clears that bar.

This benchmark establishes both: **the fidelity the slide note must carry, and the lightest local VLM that delivers it** — then adopts the result for all ingests.

## 2. Goals / non-goals

**Goals**
- Define, empirically, the note schema/fidelity that gives the KUD audit sufficient evidence per slide ("let the bench decide" — fidelity is an axis the bench sweeps, not a pre-set).
- Identify the lightest/fastest **local** VLM (or campus-hosted model) that meets a **pre-committed** fidelity + hallucination + gate-accuracy + latency/memory bar.
- Adopt the winner: update `SLIDE_VISION_MODEL` default + `describeSlide`'s instruction + `SlideNote` schema. This changes **all** ingests (not just local mode).

**Non-goals**
- Re-running the `transcribeDocument` (image-based-PDF) bench — that's settled (Qwen3.6-35B-A3B local; OpenAI default). Spec B owns wiring local `transcribeDocument`.
- Downloading new models (the candidate set is what's already on disk + campus-hosted). A download may be *recommended* by the verdict as a follow-up if nothing on-box clears the bar.
- Changing the middle-tier pipeline structure (render → describe → embed) — only the model + note shape behind `describeSlide`.
- Tuning embeddings or the audit retrieval (unchanged).

## 3. Design

### 3.A — Corpus (`vision-bench/slides/`)

15–25 real GC slides rendered to PNG (`pdftoppm -r 150`, same as `render-pages.ts`), drawn from already-ingested decks (GC 1010 + 1–2 others), with a `manifest.json` tagging each slide's type. The set deliberately spans the cases that stress a small VLM:

| type | why it's in the set |
|---|---|
| dense concept slide | most-text, fine-print risk — the hardest case |
| diagram / figure slide | tests whether `keyVisual` + teaches capture non-text instruction |
| mixed text + image | the common real case |
| procedural / numbered steps | tests ordered-content preservation |
| table / data slide | tests structured-content capture |
| low-content (title / agenda / divider / thank-you) | tests the `contentLevel: low` gate (must NOT be marked substantive) |

The existing `dense-1600.png`, `dense-2560.png`, `slide-dense-4000.png`, `slide-easy.png` seed the set. PNGs and manifest are committed to the bench dir (not the repo) alongside the other bench artifacts.

### 3.B — Candidate models

All **already on disk** under `~/projects/Models` (verified 2026-06-23) — no new downloads:

| model | role | notes |
|---|---|---|
| `gemma-4-E4B-it-MLX-8bit` | **baseline** (current default) | must include — the thing we're testing the skepticism against |
| `gemma-4-12B-it-qat-4bit` | small-mid candidate | per operator request; 4-bit, lighter than the 8-bit 12B that loop-failed transcription |
| `Qwen3.6-27B-UD-MLX-4bit` | mid candidate | vision-capable (omlx engine=vlm, `qwen3_5`), untested for this task |
| `Qwen3.6-35B-A3B-UD-MLX-4bit` | high candidate | transcription winner; run with `chat_template_kwargs:{enable_thinking:false}` |

Campus-hosted (zero local memory, free): `gemma-4-31b`, `qwen3.6-35b-a3b` / `qwen3.6-27b` twins (the qwen campus models **require** `enable_thinking:false` or they return empty content).

**Excluded:** `Qwen3-Omni-30B` (shelved 2026-06-23 — ~25 s/slide, too slow); `gemma-4-E2B`, `gemma-4-26B-A4B*` (available but out of scope to bound the matrix — addable if the four core local candidates all fail or all pass and we want a finer floor).

### 3.C — Fidelity-prompt variants (the "let the bench decide" axis)

Each note schema is a prompt + an output shape. Three levels:

- **P1 — gist (current).** `{topic, teaches, keyVisual, contentLevel}` — the existing `INSTRUCTION`.
- **P2 — concept + terminology.** P1 plus `keyTerms: string[]` (vocabulary/labels shown) and `definitions` (any definition/procedure stated, verbatim where short). Aimed at preserving K-level (terminology) and U-level (rationale) evidence.
- **P3 — near-transcription.** `{topic, contentLevel, text: <all instructional text on the slide>}` — merges describe + transcribe.

**Matrix bound:** all candidates run P1 + P2; only the top 1–2 (by P2 score) carry through to P3. This keeps runs ≈ `4 local × 2 prompts + campus + (≤2 × P3)` rather than a full cross-product.

### 3.D — Ground truth

For each slide, a reference record `{ transcription, concepts[], slideType, expectedContentLevel }` describing what is instructionally present. Built by a **strong cloud model (gpt-5.x vision)** in one pass, then **operator spot-checks ~5** to confirm the reference is trustworthy before it's used for grading. One-time, bench-only; the slides are course teaching material, not student PII (FERPA-screened decks only — exclude any deck flagged by `detectFerpaRisk`). Stored as `vision-bench/slides/ground-truth.json`.

### 3.E — Grading

A **gpt-5.x text judge** scores each `(model × prompt)` note against that slide's ground truth, per dimension, 0–3:

| dimension | 0 | 3 |
|---|---|---|
| instructional-point correctness | wrong/empty about what the slide teaches | fully correct |
| terminology / concept preservation | key terms lost or paraphrased away | all key concepts/terms present |
| hallucination (inverse — lower is better) | invents content not on the slide | nothing invented |
| gate accuracy (per slide, not 0–3) | — | `contentLevel` matches `expectedContentLevel` (boolean) |

Plus measured **latency** (s/slide) and **peak memory / OOM-on-box** (does it 507 under normal omlx tenancy). Aggregated to a per-`(model, prompt)` scorecard in `README.md`.

### 3.F — Pre-committed decision rule

Fixed **before** the run (the project's failure-criteria discipline — cf. `docs/graduate-outcome-validation.html`), so the verdict can't be post-rationalized:

> Adopt the **lightest/fastest** `(model, prompt)` that clears **all** of:
> - mean fidelity ≥ **0.75 × max** (fidelity = mean of correctness + terminology, over substantive slides),
> - mean hallucination ≤ **0.5** (on 0–3),
> - gate accuracy ≥ **0.85**,
> - per-slide latency such that a typical 20-slide deck stays ≲ 3 min wall-clock at `SLIDE_CONCURRENCY` — i.e. **≲ 18 s/slide** at concurrency 2,
> - fits memory: no 507 OOM on the box under normal omlx tenancy.
>
> If multiple clear it, pick lowest `latency × memory`. **If none clears it, keep `gemma-4-E4B` and document the gap** as accepted debt + recommend a download/campus follow-up.

Thresholds are proposals; lock them (adjust if needed) at the top of the bench `README.md` section *before* running.

### 3.G — Execution / memory protocol

Reuse the `vision-bench` harness (`bench.py`, `wait-for-omlx.sh`, the cron poller pattern). Constraints carried from the prior bench:
- **One local model loaded at a time** via omlx; explicitly unload (free RAM) between models — leftover loaded models were the memory-wall cause last time.
- omlx **507s rather than evicts** under pressure, so a queued load that 507s is a non-destructive "not enough RAM now" signal — record it as the memory result and move on / let the cron poller retry when RAM frees.
- Campus models need no local memory — test them anytime.
- omlx :8000 is **shared with nanoclaw agents** — never restart it out from under them; only load/unload models.
- Append all results to `vision-bench/README.md` (consistent with prior bench history).

## 4. Data flow

```
build corpus (render real GC slides → PNG + manifest.json)        [3.A]
  └─ ground truth: gpt-5.x vision → ground-truth.json (spot-check) [3.D]
for each candidate model [3.B] × prompt {P1,P2(,P3)} [3.C]:
  └─ omlx load (1 at a time, unload after) → describe each slide
  └─ record note + latency + peak mem                              [3.G]
gpt-5.x judge: score every (model,prompt) note vs ground truth     [3.E]
  └─ scorecard → README.md
apply decision rule                                                [3.F]
  └─ VERDICT: (model, schema)  OR  keep gemma-4-E4B + document gap
       └─ implement: SLIDE_VISION_MODEL default + describeSlide INSTRUCTION + SlideNote schema
            └─ consumed by Spec B (local-vision path + estimate constants)
```

## 5. Implementation surface (what the verdict changes)

Only `lib/capture/slide-vision.ts`, and only if the verdict picks something other than the status quo:
- `SLIDE_VISION_MODEL` default → the chosen model (still env-overridable).
- `INSTRUCTION` → the chosen prompt (P1/P2/P3 wording).
- `SlideNote` interface + `coerce()` → the chosen output shape (e.g. add `keyTerms`/`definitions` for P2, or `text` for P3).
- `finalize-extraction.ts:252` + `:266` + `:276` — the `[topic, teaches, keyVisual].join('\n')` embed text — extended to include any new fields, so the richer note actually reaches the index. **This is the load-bearing wiring: a schema change that doesn't update the embed text captures nothing.**

If `Qwen3.6-35B-A3B` wins, `describeSlide` must send `chat_template_kwargs:{enable_thinking:false}` (the `fetch` body gains the field) — currently it does not.

## 6. Error handling

- `describeSlide` already returns a `SAFE_DEFAULT` (`contentLevel:'low'`, empty fields) on any failure — preserved. A slower/heavier winner raises the per-slide timeout risk: bump `TIMEOUT_MS` (currently 60 s) if the chosen model's measured latency approaches it.
- Bench runs are non-destructive: a 507/OOM is recorded as a memory result, never a crash.
- Ground-truth cloud cost is one-time and bounded (≤25 slides); judge cost is `models × prompts × slides` gpt-5.x text calls — log the total in the README.

## 7. Testing

The bench itself is a research spike (scripts + a written verdict), not TDD. The *implementation* that consumes the verdict is testable:
- `slide-vision.test.ts`: with a faked omlx HTTP response, assert `describeSlide` parses the chosen schema (all new fields coerced; malformed → `SAFE_DEFAULT`); if the winner is Qwen, assert `enable_thinking:false` is in the request body.
- `finalize-extraction` middle-tier test: assert the embedded chunk text includes the new fields (e.g. `keyTerms`) so the richer note reaches the vector store.
- Full suite + `tsc` green.

## 8. STATE.md updates required on commit

- **AI functions / providers:** `SLIDE_VISION_MODEL` default changed (or explicitly confirmed unchanged); `describeSlide` schema/prompt updated; if Qwen wins, `enable_thinking:false` now sent.
- **What's live:** middle-tier slide notes now carry `<new fidelity>` (if changed).
- **Deferred/debt:** if no model cleared the bar, the kept-`gemma-4-E4B` gap + recommended follow-up; the bench thresholds + corpus location; any candidate deferred (E2B/26B, downloads).

## 9. Deferred / follow-ups

- A download candidate (small dedicated VLM) if the on-box set fails the bar.
- Periodic re-bench when omlx adds models or mlx-vlm fixes the gemma-4 variable-resolution path (`mlx-vlm #1425`).
- Applying the same describe-quality lens to the `transcribeDocument` image-PDF path (separate; Spec B wires it, quality already established).
