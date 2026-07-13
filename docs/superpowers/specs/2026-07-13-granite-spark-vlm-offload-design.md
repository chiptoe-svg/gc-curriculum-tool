# Granite-Docling VLM offload to the Spark — Design

**Date:** 2026-07-13
**Status:** Design approved (brainstorm) — this is a **config/runbook + validation** design, not a TDD build (almost no app code).

## What this is

Unblock the already-built, flag-gated **Granite clean-scan lane** by moving *only* the Granite VLM **inference** off the local CPU and onto the **DGX Spark GPU**, while docling-serve keeps doing render + DocTags→markdown parsing locally. Achieved via a docling-serve **custom remote-VLM preset** (`ApiVlmOptions` → Spark), with **no change to our application code**.

## Why

The Granite clean-scan lane (`feat/granite-docling-lane`, built 2026-07-12, flag `GRANITE_DOCLING_ENABLED` default off) is inert-and-correct but **blocked**: docling-serve runs `DOCLING_DEVICE=cpu`, and on CPU the Granite VLM **empties/times-out on multi-page image decks** (validated 2026-07-12: `final_salary` 16pg → 88s/0 chars; `advising_slides` 40pg → 504 timeout; a 1-page form worked in 4s).

**Root cause (precise):** the CPU pin is a deliberate workaround for a *different* bug — docling's **torch layout model** crashes on Apple **MPS** (a float64 op MPS rejects). `DOCLING_DEVICE` is global, so it also pins the Granite VLM to CPU. But the **VLM pipeline never uses the torch layout model** — Granite emits its own layout as DocTags. So the render (step 1) and DocTags→markdown parse (step 3) are CPU-light and fine; only the **VLM inference (step 2)** is GPU-heavy and times out. Move step 2 to the Spark GPU and the blocker dissolves — without touching the CPU setting that (correctly) protects the standard born-digital extraction pipeline.

## Feasibility (verified 2026-07-13)

Inspected the installed docling / docling-serve (`~/.local/share/uv/tools/docling-serve`):
- **docling** exposes `ApiVlmOptions` — a VLM config that calls a remote OpenAI-compatible endpoint (`InferenceFramework` values: MLX, TRANSFORMERS, VLLM).
- **docling-serve `settings.py`** exposes `custom_vlm_presets: dict`, `allow_custom_vlm_config`, `default_vlm_preset` (currently `"granite_docling"`), and `enable_remote_services`.
- **`DOCLING_SERVE_ENABLE_REMOTE_SERVICES=true` is already set** in the plist — the flag that permits outbound VLM calls.

So a named custom preset whose VLM config is an `ApiVlmOptions` pointing at the Spark is a supported configuration, not a fork.

## Architecture

```
image-based PDF (Granite lane, GRANITE_DOCLING_ENABLED=1)
  → our app: transcribeWithGranite → POST local docling-serve :5001 (pipeline=vlm)   [UNCHANGED]
       docling-serve, preset=granite_spark:
         1. render pages → images            (LOCAL CPU — light)
         2. VLM inference → DocTags           (REMOTE → Granite on the Spark GPU)   ← the move
         3. parse DocTags → markdown          (LOCAL CPU — light)
  → repetitionRatio guard: clean → method:'granite'; junk/empty/error → OpenAI fallback  [UNCHANGED]
```

## Components (note how little is app code)

1. **Operator / Spark side (prerequisite, NOT this repo):** serve `granite-docling-258M` on the Spark's vLLM gateway with **`--revision untied`** (the model card's mandatory vLLM safeguard). It becomes a model on `gcspark.clemson.edu:8080` alongside the existing gemma/qwen/deepseek models.

2. **docling-serve config (plist env / settings, NOT app code):** add a `custom_vlm_presets` entry — `granite_spark` → `ApiVlmOptions{ url: <Spark chat-completions>, model: "granite-docling-258M", prompt: <DocTags prompt>, timeout: <generous> }` — and select it (`default_vlm_preset=granite_spark`, or pass the preset per request from `transcribeWithGranite`). Keep `enable_remote_services=true`; set `allow_custom_vlm_config` if per-request selection is used. Restart the service.

3. **Application code:** **none.** `transcribeWithGranite` (`lib/courses/material-extractor.ts`) already POSTs to `:5001` with `pipeline=vlm`; the lane, the `repetitionRatio` guard, and the OpenAI fallback are already built and tested.

4. **Flip `GRANITE_DOCLING_ENABLED=1`** in the deploy `.env.local` — only after the validation gate passes.

## Data flow & observability

- Result contract unchanged: clean Granite → `method:'granite'`, `visionCostUsdCents:0` (Spark is Clemson infra — free, FERPA-safe); junk/empty/error → OpenAI fallback (`method:'vision'`). Adoption + fallback rate readable from the persisted `extraction_method`, exactly as the built lane already provides.

## Error handling

Unchanged from the built lane: **Granite can only decline, never fail.** Any Spark error, cold-start stall, timeout, empty output, or high `repetitionRatio` routes to the OpenAI fallback. A Spark hiccup can never break ingestion.

## Validation gate (the actual work of this increment)

Flag stays **off** until, on the real decks that fail today:
1. `final_salary` (16pg) and `advising_slides` (40pg) return **non-empty structured markdown**, fast (target ≈ the standalone MLX Granite's 1–5s/pg, now on the Spark GPU).
2. The `repetitionRatio` guard still correctly **declines** genuinely-degenerate output → OpenAI.
3. **The one thing to prove hands-on:** that Granite-via-vLLM-`ApiVlmOptions` returns DocTags docling **parses to clean markdown** (the DocTags prompt + response wiring is the only untested seam). If the round-trip markdown matches the standalone MLX run's structure, the design holds.

Then set `GRANITE_DOCLING_ENABLED=1` + the docling-serve preset in the deploy config. Reversible instantly (revert the preset / unset the flag).

## Risks / open items

- **Exact `custom_vlm_presets` shape** (env JSON vs config file; the `ApiVlmOptions` field names) — resolve against the installed docling-serve during the config step.
- **Spark on-demand cold-start:** docling-serve's VLM call is synchronous; a cold Granite load or eviction could stall or time out. Mitigation: generous docling-serve VLM timeout + the decline→OpenAI fallback already covers it. Consider a keep-warm if the lane sees steady traffic (YAGNI until it does).
- **DocTags prompt fidelity over the API:** the vLLM-served Granite must receive the DocTags-eliciting prompt docling expects; validated in the gate.

## Out of scope (YAGNI)

- **The 2nd-Mac MLX Granite instance** and the **upstream float64/MPS layout patch** — both were alternatives to this; Option A supersedes them for the clean-scan lane.
- **Born-digital PDFs** (standard Docling text extraction) and the **hard-scan OCR lane** (Qwen on the Spark, shipped `feat/local-hardscan-ocr`) — untouched; this is only the Granite VLM path.
- **Granite's targeted instructions** (chart→table, formula→LaTeX, section-header retrieval) — future enhancement, not this lane.
- **Moving the standard extraction pipeline off CPU** — the MPS layout bug still forces CPU there; this design deliberately leaves born-digital extraction exactly as-is.

---

## Validation findings (2026-07-13)

**Status: pipeline VALIDATED end-to-end; blocked on a macOS permission + app wiring. Not shipped.**

**Proven** (via a temporary shell-owned docling-serve on `:5002`, which held the Local Network permission):
- `final_salary` (16pg, emptied on CPU 2026-07-12) → **9,401 chars clean structured markdown in 14s** on the Spark (headings, bullets, a full table, image placeholders).
- `advising_slides` (40pg, 504'd on CPU) → 12,248 chars, but **one page hit Granite's repetition runaway** (`stop_reason=length`) → overall repetitionRatio 0.44 > 0.3 → the built lane's guard **declines → OpenAI fallback**. Designed, safe — Granite stays a clean-docs tool.

**The config recipe (the real unknown — now solved).** docling-serve's `vlm_pipeline_model` form field is a **hard enum** (custom preset names → HTTP 422), and `custom_vlm_presets`/`default_vlm_preset` do **not** route via the HTTP API (they silently fall back to the local transformers model). The working path is the **per-request custom config**:

1. Server: `allow_custom_vlm_config: true` (via `DOCLING_SERVE_CONFIG_FILE` → `~/.config/docling-serve/config.json`) + `DOCLING_SERVE_ENABLE_REMOTE_SERVICES=true` (already set in the plist).
2. Request (multipart to `POST /v1/convert/file`): `pipeline=vlm`, `image_export_mode=placeholder`, and `vlm_pipeline_custom_config=<JSON>`.
3. The JSON is a `VlmConvertOptions` whose `engine_options` must be **manually spliced** — pydantic drops the `ApiVlmEngineOptions` subclass fields (`url`/`params`) on `model_dump` because the field is typed as the base class:

```python
# run with the docling-serve venv python
import json
from docling.datamodel.vlm_engine_options import ApiVlmEngineOptions
from docling.datamodel.pipeline_options import VlmConvertOptions
import docling.datamodel.stage_model_specs as sms
ms = sms.VLM_CONVERT_GRANITE_DOCLING.model_spec  # complete spec (prompt + response_format=doctags)
eng = ApiVlmEngineOptions(
    url="http://130.127.162.68:8080/v1/chat/completions",   # IP, not hostname
    headers={},
    params={"model": "granite-docling", "skip_special_tokens": False, "max_tokens": 4096},
    timeout=400.0, concurrency=4,
)
d = VlmConvertOptions(engine_options=eng, model_spec=ms, scale=2.0).model_dump(mode="json")
d["engine_options"] = eng.model_dump(mode="json")   # MANDATORY splice (else url/params dropped)
json.dump(d, open("/tmp/granite_vco.json", "w"))
```

Gotchas: **`skip_special_tokens: False` is REQUIRED** (else DocTags loc tokens are stripped and parsing fails); use the **IP** `130.127.162.68`, and the Spark model id is **`granite-docling`** (not the HF repo).

**The deploy blocker (not code, not docling): macOS Local Network privacy.** The launchd docling-serve (`:5001`) gets `EHOSTUNREACH "No route to host"` to the Spark, while a shell reaches it (HTTP 200, same venv python, same `requests`, no proxy). Cause: the Spark `130.127.162.68` is **same-subnet** as this Mac (`en0 130.127.162.67`), and macOS blocks headless launchd agents from same-subnet hosts without the **Local Network** permission (which Terminal/the shell holds). **Fix (GUI/human):** grant docling-serve (or `…/uv/tools/docling-serve/bin/python`) Local Network access in System Settings → Privacy & Security → Local Network, or launch the service in a permission-granted context.

**Remaining steps to ship (none done):** (1) grant the Local Network permission [operator]; (2) wire `transcribeWithGranite` to send `vlm_pipeline_custom_config` (above) instead of `vlm_pipeline_model=granite_docling`, and set `allow_custom_vlm_config`/`DOCLING_SERVE_CONFIG_FILE` on the deployed `:5001`; (3) re-validate through the deployed `:5001`; (4) flip `GRANITE_DOCLING_ENABLED=1`. Live box was restored to clean (plist reverted, `:5002` killed, flag off) — production unchanged.
