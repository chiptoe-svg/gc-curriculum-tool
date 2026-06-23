# Slide-note Vision Benchmark Implementation Plan (Spec A)

> **For agentic workers:** REQUIRED SUB-SKILL: Phases 0–1 are a research spike — execute the protocol, record results, apply the decision rule. Phase 2 (the `describeSlide` upgrade) is TDD — use superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Empirically pick the local VLM + note-schema (+ gemma soft-token budget + decoding params) that gives `describeSlide` enough fidelity to serve as a slide's KUD-audit footprint, then adopt it for all ingests.

**Architecture:** A benchmark over a small real-GC slide corpus with a gpt-5.x ground truth, scored by a gpt-5.x judge against a pre-committed decision rule (spec §3.E–F). The gemma candidates run on the **isolated patched stack** (`vision-bench/.venv-1426` + the `omlx-1986` clone), never the shared `:8000`. The verdict parameterizes a small `describeSlide` upgrade.

**Tech Stack:** Python bench harness (`~/.local/share/gc-curriculum-tool/vision-bench/`), mlx-vlm #1426 (patched), omlx #1986 (patched), campus LLMs; TypeScript/Vitest for the `describeSlide` upgrade. Spec: `docs/superpowers/specs/2026-06-23-slide-note-vision-benchmark-design.md`.

**Pre-committed before running (spec §3.F):** adopt the lightest/fastest `(model, schema, budget)` clearing mean-fidelity ≥ 0.75×max, mean-hallucination ≤ 0.5, gate-accuracy ≥ 0.85, ≤ 18 s/slide at concurrency 2, no OOM. If none clears → keep `gemma-4-E4B`, document the gap.

---

## Phase 0 — Corpus + ground truth

### Task 0.1: Build the slide corpus

**Files:** `~/.local/share/gc-curriculum-tool/vision-bench/slides/` (PNGs + `manifest.json`)

- [ ] **Step 1: Pick source decks.** From already-ingested GC courses (start with GC 1010 + 1–2 others). List candidate materials:
  ```bash
  cd /Users/admin/projects/curriculum_developer
  # find middle-tier slide decks with a readable local blob
  ```
  Render to PNG via the same path the app uses (`pdftoppm -r 150`), or reuse already-rendered pages.
- [ ] **Step 2: Curate 15–25 slides spanning the §3.A types** (dense concept, diagram/figure, mixed, procedural/steps, table/data, low-content title/agenda). Copy into `slides/` with stable names. **Exclude any deck flagged by `detectFerpaRisk`.**
- [ ] **Step 3: Write `slides/manifest.json`** — one entry per slide: `{ file, course, slideType, expectedContentLevel: "substantive"|"low" }`.
- [ ] **Step 4: Commit the manifest** (PNGs live in the bench dir, not the repo — consistent with existing bench artifacts).

### Task 0.2: Establish ground truth (gpt-5.x vision + spot-check)

**Files:** `vision-bench/slides/ground-truth.json`, `vision-bench/make_ground_truth.py`

- [ ] **Step 1: Write `make_ground_truth.py`** — for each slide, call gpt-5.x vision once to produce `{ transcription, concepts: string[], slideType, expectedContentLevel }`; write `ground-truth.json`. (Use the project's OpenAI key via env; one call/slide, bounded cost — log the total.)
- [ ] **Step 2: Run it**, then **operator spot-checks ~5** entries to confirm the reference is trustworthy. Correct any obvious misses by hand.
- [ ] **Step 3: Record** the cost + spot-check outcome in `vision-bench/README.md`.

---

## Phase 1 — Run the bench

### Task 1.1: Describe-task bench script

**Files:** `vision-bench/describe_bench.py`

Distinct from the transcription probes (`bench_1426.py` etc.): this runs the **describe** prompts (P1/P2/P3, spec §3.C) and emits a `SlideNote`-shaped JSON per (model, prompt, budget, slide).

- [ ] **Step 1: Write `describe_bench.py`** taking `--model --prompt {P1,P2,P3} --budget N --rep-penalty 1.3 --backend {mlxvlm,omlx,campus}`:
  - local gemma via direct mlx-vlm (`.venv-1426`) with `vision_soft_tokens_per_image=budget, repetition_penalty=1.3`;
  - local Qwen via the same venv (no budget axis; `enable_thinking:false`);
  - campus via HTTP (`enable_thinking:false`).
  - Output: `runs/<model>__<prompt>__b<budget>.jsonl` — one `{slide, note, latency_s, prompt_tokens}` per slide.
- [ ] **Step 2: Smoke it** on 2 slides with `gemma-4-12B` P1 b560 to confirm shape.

### Task 1.2: Execute the matrix (spec §3.B–C, §3.G memory discipline)

- [ ] **Step 1: Local gemma** (E4B baseline / 12B / 26B-A4B) × {P1,P2} at pinned **budget 560**, `repetition_penalty=1.3`, **one model loaded at a time, unload between** (memory). Record peak mem / any 507.
- [ ] **Step 2: Local Qwen** (27B, 35B-A3B) × {P1,P2}, `enable_thinking:false`.
- [ ] **Step 3: Campus** (gemma-4-31b, qwen twins) × {P1,P2}.
- [ ] **Step 4: Budget sweep** — the leading gemma (by P2 score so far) × {280,560,1120} at its best prompt.
- [ ] **Step 5: P3** — top 1–2 models only.
- [ ] **Step 6:** if a gemma API-path check is wanted, serve the `omlx-1986` clone on a throwaway port (`:8011`, `127.0.0.1`), run, then **kill + deregister** (do NOT touch `:8000`).

### Task 1.3: Grade + verdict

**Files:** `vision-bench/grade.py`, `vision-bench/README.md` (scorecard + VERDICT)

- [ ] **Step 1: Write `grade.py`** — a gpt-5.x judge scores each run's notes vs `ground-truth.json` on the §3.E dimensions (instructional-point correctness, terminology preservation, hallucination-inverse, gate accuracy), 0–3 each; aggregate per (model, prompt, budget). Log judge cost.
- [ ] **Step 2: Run it**, write the scorecard table to `README.md`.
- [ ] **Step 3: Apply the §3.F decision rule** → **VERDICT: `(model, schema, budget, rep_penalty)`** OR "keep gemma-4-E4B + document gap". Write the verdict + the full table to `README.md`.
- [ ] **Step 4: Commit** a short results summary into the repo (`docs/superpowers/pilot/2026-06-23-slide-note-bench-results.md`) pointing at the bench README for detail.

---

## Phase 2 — `describeSlide` upgrade (TDD; parameterized on the VERDICT)

> Only if the verdict picks something other than the status quo. All paths below use the verdict's `(MODEL, SCHEMA, BUDGET, REP_PENALTY)`.

**Files:** `lib/capture/slide-vision.ts`, `lib/capture/__tests__/slide-vision.test.ts`, `lib/capture/finalize-extraction.ts`

### Task 2.1: SlideNote schema + coerce (if the verdict's schema ≠ current)

- [ ] **Step 1: Write the failing test** in `lib/capture/__tests__/slide-vision.test.ts`: with a faked omlx HTTP response containing the verdict schema's fields (e.g. P2 adds `keyTerms: string[]`), assert `describeSlide` parses them and malformed input → `SAFE_DEFAULT`.

```ts
// example for P2 (keyTerms); adjust to the verdict schema
it('parses the new note fields and falls back safely', async () => {
  // mock fetch → { choices:[{message:{content: JSON.stringify({topic:'t',teaches:'x',keyVisual:'v',keyTerms:['a','b'],contentLevel:'substantive'})}}] }
  const note = await describeSlide(Buffer.from('png'));
  expect(note.keyTerms).toEqual(['a','b']);
});
```

- [ ] **Step 2: Run → fail.** `pnpm vitest run lib/capture/__tests__/slide-vision.test.ts`
- [ ] **Step 3: Extend `SlideNote` + `coerce()`** with the verdict's fields (e.g. `keyTerms`, `definitions` for P2; or `text` for P3). Default missing fields safely.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.**

### Task 2.2: Request params — model, budget, repetition penalty, thinking flag

- [ ] **Step 1: Write the failing test:** assert the request body sent by `describeSlide` includes the verdict's params — `model = SLIDE_VISION_MODEL` (default = VERDICT model), `repetition_penalty = REP_PENALTY`, and (gemma) `vision_soft_tokens_per_image = BUDGET`, or (Qwen) `chat_template_kwargs:{enable_thinking:false}`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Update `describeSlide`'s `body`** to send those params; change the `SLIDE_VISION_MODEL` default to the verdict model.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.**

### Task 2.3: Wire the richer note into the embed text (LOAD-BEARING — spec §5)

- [ ] **Step 1: Write the failing test** in a `finalize-extraction` middle-tier test: assert the embedded chunk text includes the new fields (e.g. `keyTerms`) so the richer note actually reaches the vector store.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Update `finalize-extraction.ts`** middle-tier slide path (the `[note.topic, note.teaches, note.keyVisual].join('\n')` at ~`:252`/`:266`/`:276`) to include the new fields. *A schema change that doesn't update this captures nothing.*
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.**

### Task 2.4: Suite + STATE + env docs

- [ ] **Step 1:** `pnpm vitest run && pnpm exec tsc --noEmit` green.
- [ ] **Step 2: STATE.md** (spec §8): `SLIDE_VISION_MODEL` default changed; `describeSlide` schema/params updated; the **productionizing gate** — if the verdict model needs the patched omlx stack, note `describeSlide` stays on the current model in production until the shared-omlx upgrade is done (don't silently require a forked omlx in prod).
- [ ] **Step 3: Commit.**

---

## Critical gate (do not skip)

**Phase 2 must respect the productionizing decision (STATE Deferred/debt):** if the verdict model is a *patched-stack* gemma (resolution knob), the live `describeSlide` cannot use it until the shared `com.omlx.cli` is upgraded (or the PRs merge + pin bump). Until then, Phase 2 lands the schema/wiring but the **production default stays a model the stable omlx supports** — the patched model becomes the default only when the omlx upgrade ships with its regression pass. The bench verdict and the production switch are two separate gates.

## Self-review checklist (after writing)
- Every Phase-2 task names the verdict's `(MODEL, SCHEMA, BUDGET, REP_PENALTY)` rather than hard-coding.
- Phase-0 corpus excludes FERPA-flagged decks; ground-truth cost logged.
- gemma runs use the isolated stack; `:8000` untouched; throwaway port deregistered.
- The embed-text wiring (2.3) is present — the most common way a schema upgrade silently does nothing.
