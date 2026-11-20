# Ingestion and retrieval benchmarks in curriculum — inventory

Date: 2026-11-19. For rag-core's central guide (one entry per media type; curriculum's recipes become
candidates). Compiled read-only from the code and STATE.md; key claims spot-checked. `[inference]` marks what
wasn't read directly. Results stored outside the repo (`~/.local/share/gc-curriculum-tool/…`,
`~/.local/state/gc-curriculum-tool/bench-2026-11/`) are known only from STATE.md.

There are no bench npm scripts; everything runs as `pnpm exec tsx <file>` (or `node …/tsx/dist/cli.mjs <file>`).

## Retrieval

| Benchmark | Run | Measures | Media | Set | Latest result | Runs against another backend? |
|---|---|---|---|---|---|---|
| **Gold-set retrieval** `scripts/capture/eval-goldset.ts` (added 2026-11-19) | `[RERANK=off] tsx scripts/capture/eval-goldset.ts <gold.json>`; read-only on live Weaviate | hit@1/3/10, MRR@10, ms/query; hit = chunk `fileName` equals the pair's file and its text contains every expected substring (same rule as rag-core `eval/harness.py::_matches`) | any text chunk; not split by format | rag-core's v2 curriculum set, 17 pairs (GC 1040, 3460, 3800, 4440), converted to JSON; kept outside the repo | 2026-11-19, live index: rerank off → on: hit@1 41% → 59%, hit@3 71% → 65%, hit@5 12/17 both, hit@10 88% both, MRR 0.572 → 0.648, +~0.3 s; "file > section" before the passage: hit@1 53% | No: calls `embedText` + `createVectorStore().hybridSearch` directly. The `VectorStore` interface (`lib/capture/vector-store.ts`) is the seam an adapter would implement. Gold JSON and the hit rule are backend-neutral |
| **Interview replay** `scripts/capture/interview-bench.ts` + `interview-bench-cases.json` | `DATABASE_URL=<…scratch> tsx … --expect-db <…scratch> [--configs model:effort] [--loop pi] [--endpoint campus] [--cases …] [--max-credits N] [--out f.json]`; refuses non-scratch DBs; copies a session temporarily | per turn: did it search, cite a file, bad citations; tokens, cost, s/turn; questions written out for a blind read (Opus) | whatever `search_materials` returns: agent search + citation behavior, not ranking | 9 moments (GC 2070, 1010, 1020; 2026-10-27) on dev; **29** on branch `feat/interview-reask` (+13 GC 3400 full arc, +7 PKSC 2200 late turns, 2026-11-19) | 2026-11-19 GC 3400 blind review, 13 moments × 3 passes: Sol medium 87% acceptable / mean 3.51; Terra medium (Pi) 90% / 3.44; Qwen3.8 81% / 3.08; DeepSeek 69% / 3.03. PKSC 2200: Terra medium 5/5 acceptable, mean 3.60, no re-asks. Earlier: STATE.md Converse round (2026-11-03/08) | No: runs curriculum's production prompt, context builder and agent loops |
| Chunk-context bake-off `scripts/bench/chunk-llm-bakeoff.ts` | `pnpm exec tsx scripts/bench/chunk-llm-bakeoff.ts` | latency, JSON parse rate, blurb quality (gpt-5.5 pairwise) for `chunk-contextualize` | — (blurbs) | 6 hard-coded GC 3460 chunks + 1 digest | not recorded | n/a (model calls only) |
| Chunk-context bake-off, real chunks `scripts/bench/chunk-llm-bakeoff-real.ts` | same | same, on 10 indexed chunks of a real material (default GC 2400) | — | 10 chunks | not recorded | No (`db`, `chunkMaterial`) |
| Digest / contextualize one-offs (not in the repo) | — | digest: blind gpt-5.4 on 6 dimensions; contextualize: MRR / hit@1 / precision@5 / recall@5 | — | 6 materials / 12 chunks; then 150 chunks, 24 audit queries | 2026-07-16 (STATE.md): keep gpt-oss-120b digests; blurb on: precision@5 0.642 → 0.700, same-material recall@5 0.567 → 0.725 (an earlier chunk-derived A/B showed recall@1 80% without vs 70% with) | [inference] |

## Ingestion

| Benchmark | Run | Measures | Media | Set | Latest result | Another backend? |
|---|---|---|---|---|---|---|
| Classification holdout `scripts/bench/classify-holdout.ts` | `env -i … MODEL=… FILES=files.json OUT=out.json [PROMPT_FILE] [PEEK=1] pnpm exec tsx …`; paid path needs `PROVIDER=openai MAX_USD`; refuses if `DATABASE_URL` is set | tier (high / middle / background) vs stored tier, fed what `classifyFile` sends (name, MIME, size, pages) | files (not slides, YouTube or syllabi); linked items (Docs, Drive, YouTube) | 135 files + 155 linked items, blind Opus labels (2026-11-09, STATE.md) | 2026-11-09: on 124 confident files, gpt-5.4-mini 114 agree, DeepSeek Flash off 116, Qwen3.8 off 115; linked: DeepSeek 137/155. Shipped DeepSeek default | Partly: reads a plain JSON file list and a prompt; any classifier that emits tiers for that list can be scored |
| Extract-role bench `scripts/bench/role-extract.ts` | `env -i … DATABASE_URL=<bench copy> AI_PROVIDER=campus … pnpm exec tsx …` | schema failures, speed; blind Opus check vs source | syllabus field parse, material analysis, check-in, prereq-gap merge, classify | 6–9 items per function | 2026-11-01: GLM-5.3 11/44 schema failures; Qwen3.8 off 6/6 syllabus parses, 5/6 analyses (stored gpt-5.4 4/6), 5/6 merges | No |
| Slide-note vision bench (Python, outside the repo: `~/.local/share/gc-curriculum-tool/vision-bench/describe_bench.py`, `grade.py`) | — | fidelity = mean(correctness, terminology)/3, hallucination, gate accuracy (substantive vs low), latency, memory | slides | 20 GC 1010 slides, 5 decks; truth = gpt-5.4 vision, operator spot-checked; judge gpt-5.4 | 2026-06-23: gemma-12B fidelity 0.842 / gate 0.85 / 3.0 s; 2026-10-20 (bench v2): RCD qwen3.6-35b fidelity 0.883 / gate 0.75 / 1.7 s (live since) | Yes in principle: takes slide images, a note and truth [inference] |
| Vision / OCR eval (`EVAL-2026-07-vision-ocr-granite.md`, outside the repo) | — | 0–3 per page, gpt-5.4 judge | scans, handwritten pages, printed structured docs | own docs; OCR re-run n=4 | 2026-07: dense handwritten scans → gpt-5.4 (local models ran away); Granite-Docling good on clean print; 2026-10-20: RCD qwen3.6 OCR 2.75/2.25 on 4 scans | Yes in principle [inference] |
| Digest bench (`~/.local/share/gc-curriculum-tool/digest-bench/EVAL.md`, `scorecard.json`) | — | — | digests | — | not read | [inference] |

**No benchmark or gold set exists for:** YouTube/video transcription, spreadsheet extraction, chunker quality,
Google Docs/Slides/Sheets text exports, or standalone images.

## Regression checks (unit tests; curriculum-internal, mocked)

Chunker (`tests/lib/capture/chunker.test.ts`); scan detection (`tests/courses/scan-detect.test.ts`);
tiering (`tests/lib/capture/material-tier.test.ts`, `linked-tier`, `tier-change-reread`,
`finalize-extraction-tier`); spreadsheet compaction (`spreadsheet-compact.test.ts`); slide vision
(`slide-vision.test.ts`); output sanitizing (`sanitize-extracted-text.test.ts`); extraction routing
(`tests/courses/extract-text.test.ts`, `material-extractor.test.ts`,
`tests/lib/courses/extract-text-{granite,vision-fallback,image-routing}.test.ts`, `docling-gate.test.ts`);
OCR repetition and vision offload (`tests/lib/ai/ocr-repetition-penalty.test.ts`, `vision-offload.test.ts`,
`lib/ai/__tests__/vision-*.test.ts`); YouTube audio (`tests/lib/youtube/transcribe-audio.test.ts`); digest and
contextualize (`tests/ai/analyze/{material-digest,chunk-contextualize,…}.test.ts`,
`tests/lib/capture/finalize-extraction*.test.ts`); ingest queue (`tests/lib/capture/ingest-*.test.ts`,
`run-course-ingest.test.ts`); retrieval (`lib/ai/__tests__/rerank.test.ts`,
`lib/capture/__tests__/rerank-hits.test.ts`, `tests/lib/capture/vector-store*.test.ts`,
`lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`). None would run against another backend.
