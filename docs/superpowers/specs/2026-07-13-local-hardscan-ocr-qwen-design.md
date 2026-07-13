# Local hard-scan OCR (Qwen-35B on the Spark) — Design

**Date:** 2026-07-13
**Status:** Design approved (brainstorm) — implementation plan not yet written.

## What this is

Replace the **OpenAI OCR fallback** for hard/handwritten/messy image-based PDFs with **Qwen3.6-35B-A3B on the Clemson DGX Spark** (`gcspark.clemson.edu:8080`, NVFP4+MTP), behind a flag, default off. This is a **single-lane swap** at the bottom of the existing extraction lane tree — it does **not** touch born-digital PDFs (Docling text extraction), the clean-scan lane (Granite-Docling), or slide description (gemma).

## Why

The July 2026 vision/OCR evaluation (`~/.local/share/gc-curriculum-tool/vision-bench/EVAL-2026-07-vision-ocr-granite.md`) established Qwen3.6-35B (NVFP4+MTP) as the first local model to transcribe real handwritten lab scans without collapsing — `compl 2.75 · acc 2.50 · zero repetition`, near the gpt-5.4 reference. Today those scans go to OpenAI: external, paid, and the *worst* case for privacy (scanned, handwritten, possibly student-identifying material). This lane keeps that content on Clemson infrastructure — local, free, FERPA-friendlier — at ~1.6× the per-page latency, which is acceptable for a background ingest step. **The path has fired 0/134 times in production to date**; this prewires the FERPA-safe route before the first scanned upload arrives.

## The lane tree (this change is one leaf)

```
PDF upload
 └─ Docling standard extraction  (docling-serve, PDF_PARSER=docling)          ← every PDF
      ├─ charsPerPage ≥ 100  →  BORN-DIGITAL: Docling text   → method:'text'   (untouched)
      └─ charsPerPage < 100  →  image-based, OCR lanes:
            ├─ lane 2: Granite-Docling (same service, pipeline=vlm)  [flag-gated, dark]  (untouched)
            └─ lane 3: flat OCR fallback   OpenAI  →  Qwen-35B (Spark)          ← THIS CHANGE
```

The signal that separates lane 2 (clean printed) from lane 3 (hard residue) is Granite's own output quality (`repetitionRatio < 0.3`) — Granite accepts clean scans, declines junk, and the decline falls through to lane 3. No separate classifier.

## The seam

`lib/courses/extract-text.ts`, the `isImageBased` branch (line ~120):

```
const provider = opts?.visionProvider ?? getProvider();   // getProvider() = OpenAI today
const transcribed = await provider.transcribeDocument({ fileBytes, mimeType, maxPages });
```

Born-digital PDFs (`charsPerPage ≥ 100`) never enter this branch, so they are structurally unaffected.

## Components

### 1. Endpoint config (0 code)
Point the existing vision-offload at the Spark:
- `VISION_OFFLOAD_BASE_URL=http://gcspark.clemson.edu:8080/v1`
- `VISION_OFFLOAD_MODEL=qwen3.6-35b-a3b`
- `VISION_OFFLOAD_API_KEY=…`

`LocalProvider.transcribeDocument` already renders → canonicalizes → offloads per-page → pins `chat_template_kwargs:{enable_thinking:false}` + `repetition_penalty:1.3` → stitches. Setting `VISION_OFFLOAD_*` lights up that already-built path. **Backup endpoint (env-swap, no code):** `qwen3.6-35b-a3b-fp8` at `https://llm.rcd.clemson.edu/v1` (campus RCD) — verified 2026-07-13 vision-capable, honors `enable_thinking:false`, quality parity (2.50/2.25), but ~3× slower (53s/pg, no MTP, shared infra). Swap the three env vars if the Spark is down.

### 2. Force all hard-scan pages to the Spark (option B)
`LocalProvider.transcribeDocument`'s two-phase offload is **size-tiered** — `shouldOffload()` keeps small (1–2 page) docs on the on-Mac omlx and only shunts multi-page docs to the DGX. For this lane we want **every** hard-scan page on the exact benchmarked Spark variant, not a size-dependent mix. Add a `forceOffload` option (threaded from the hard-scan call site) that bypasses the size tier so all pages go to the offload endpoint. The per-page omlx error-fallback inside `twoPhaseOffload` stays as an inner safety net (still local); it does not change which backend normally runs.

### 3. Flag-gated routing flip
New flag `LOCAL_HARDSCAN_OCR` (env, default **off**). When on, the `isImageBased` lane-3 uses the local/Spark vision provider (`buildLocalProvider()`, `forceOffload:true`) instead of `getProvider()` (OpenAI). Off → today's behavior byte-for-byte (straight to OpenAI). Independent of the "use local" ingest mode (which already passes `buildLocalProvider()`); this flag governs the **default** ingest.

### 4. OpenAI fallback-on-failure (never break ingestion)
If the local/Spark path throws or returns empty (`< MIN_MEANINGFUL_CHARS`), fall through to the existing OpenAI `transcribeDocument` rather than returning `status:'failed'`. This is a new fallback at the seam — today a `transcribeDocument` throw returns `method:'vision', status:'failed'`; under the flag, a local failure retries once on OpenAI first. Endpoint chain end-to-end: **Spark → (env-swap backup: campus FP8) → OpenAI**.

## Flag

`LOCAL_HARDSCAN_OCR` (env), default off. Off = today's behavior byte-for-byte (image-PDF OCR → OpenAI). On = Spark Qwen first, OpenAI as failure fallback. Reversible instantly.

## Data flow & observability
- Result stays `method:'vision'` (the lane is still "vision OCR"); the backend distinction (local vs OpenAI) is visible in logs, not a new persisted enum value — keeps the migration surface zero.
- Local Spark cost is **0** (`visionCostUsdCents: 0`); an OpenAI-fallback hit records its real cost as today.
- Downstream (digest → chunk → index) consumes the returned `text` unchanged — same contract.

## Error handling
The local path can **decline to OpenAI, never fail the ingest**: any Spark error, timeout, or empty output routes to the OpenAI fallback (§4). Mirrors the Granite lane's "can only decline, never fail" discipline.

## The mix issue (pre-existing debt — explicitly NOT fixed here)
Routing is decided **once per document** (`charsPerPage` averaged over the whole file; both lanes act on the whole file), but a PDF's content can be **heterogeneous per page**. Consequences: (a) a mostly-text doc with a few scanned pages averages above 100 → `isImageBased=false` → the scanned pages are **silently dropped** from extraction; (b) a doc mixing clean + handwritten pages gets one blended `repetitionRatio`, so one page type's fate decides the whole doc's lane. This is orthogonal to the OpenAI→Qwen swap — the swap changes *who does the hard OCR*, not the routing granularity, so it neither causes nor fixes the mix issue. The real fix is **per-page routing** (classify each page's density → route independently → stitch), which is a substantially larger change and pure YAGNI against a 0/134-usage path. **Documented as debt in STATE.md; not in scope.**

## Testing
- **Routing** (mock the local provider + the OpenAI provider): (a) flag on + local returns text → `method:'vision'`, local provider used, OpenAI not called; (b) flag on + local throws → OpenAI fallback fires, ingest succeeds; (c) flag on + local returns empty → OpenAI fallback fires; (d) flag off → OpenAI directly, local never constructed; (e) born-digital PDF → neither lane (unchanged).
- **`forceOffload`**: with it set, a 1-page doc offloads to the Spark endpoint (not the on-Mac omlx); without it, existing size-tier behavior is preserved.
- **Live smoke:** the 4 real lab scans through the flagged path → non-empty transcription, `method:'vision'`, zero repetition.

## Rollout gate (not code)
Flag stays **off** until a live smoke on real image-based materials confirms the Spark path end-to-end (including the OpenAI fallback firing when the Spark is unreachable). Then set `LOCAL_HARDSCAN_OCR=1` + `VISION_OFFLOAD_*` in the deploy `.env.local`. Reversible instantly (unset the flag).

## Out of scope (YAGNI)
- **Per-page routing / the mix issue** — documented as pre-existing debt.
- **Granite clean-scan lane activation** — separate MLX-engine-on-docling-serve blocker.
- **Slide description** — stays gemma, untouched.
- **Runtime multi-endpoint failover** — the campus FP8 backup is an env-swap, not an automatic 2nd-tier failover chain.
- **A new persisted `extractionMethod` value** for the local-vs-OpenAI distinction — logs suffice; keeps migration surface zero.
