# Phase 2: Hybrid Deployment — Local Faculty / Vercel Partners

**Status:** planning — implementation not started
**Date:** 2026-05-25
**Owner:** chiptoe-svg

## Goal

Move the faculty-facing surfaces of the curriculum tool off Vercel and onto
a local Mac server, while keeping the partner/CareerCapture surfaces on
Vercel for public reach. Same codebase, same DB, different runtime
context per deployment.

## Why now

Three converging forces:

1. **PDF parsing on Vercel is fundamentally limited.** Recent crash
   (DOMMatrix at module load, 78c8aa6 → 3477c56) is the latest example;
   unpdf is the best we can do in Node serverless and it doesn't
   describe charts or reconstruct tables well.
2. **A best-in-class local PDF pipeline is available.** Docling +
   omlx-hosted VLM (Qwen3.5-4B is the sweet spot for figure
   descriptions per our benchmark review) gives table reconstruction +
   chart descriptions for $0 per page on the user's existing hardware.
3. **Privacy.** Course materials currently flow through OpenAI for
   audits. Local-first eliminates that for the faculty workflow without
   touching partner-side architecture.

## What stays on Vercel

- `/partners/*` (magic-link partner survey)
- `/preview/*` (public partner preview / CareerCapture interface)
- `/api/partners/*`, `/api/preview/*`
- Neon DB connection (shared with local)
- All current code, deploys, and CI

## What moves to local Mac

- `/capture/*`, `/explore/*`, `/program/*`, `/admin/*`, `/settings/*`
- Their `/api/*` counterparts (everything not in the Vercel-keeps list)
- PDF extraction (via local Docling)
- AI calls (via omlx with `AI_PROVIDER=local`)

## Architecture

```
Faculty (on Clemson LAN/VPN)         Partners (anywhere)
       │                                    │
       ▼                                    ▼
  http://<mac-ip>:3000              https://curriculum.vercel.app
       │                                    │
       │  basic auth (stopgap)              │  magic-link session
       ▼                                    ▼
  ┌──────────────────────┐         ┌──────────────────────┐
  │  Next.js (local Mac) │         │  Next.js (Vercel)    │
  │  AI_PROVIDER=local   │         │  AI_PROVIDER=openai  │
  │  PDF_PARSER=docling  │         │  PDF_PARSER=unpdf    │
  └──────┬───────┬───────┘         └──────────┬───────────┘
         │       │                            │
         │       ▼                            │
         │  localhost:5001                    │
         │  (docling-serve)                   │
         │       │                            │
         │       ▼                            │
         │  localhost:8000                    │
         │  (omlx — Qwen3.5-4B VLM            │
         │   + 27-31B for heavy reasoning)    │
         │                                    │
         └────────────┬───────────────────────┘
                      ▼
              Neon Postgres (shared)
```

## Decisions made

| Decision | Choice | Date |
|---|---|---|
| PDF parser | Docling (with unpdf fallback for Vercel) | 2026-05-25 |
| Local VLM for figure descriptions | Qwen3.5-4B (Apache 2.0, OCRBench 85, fast) | 2026-05-25 |
| Local heavy-reasoning model | One of existing 27-31B (Qwen3.5-9B or larger Qwens, Gemma 4 31B) — TBD by user | 2026-05-25 |
| Faculty access scope | Clemson LAN (`0.0.0.0:3000`) | 2026-05-25 |
| Faculty auth | HTTP Basic Auth via Next.js middleware — STOPGAP | 2026-05-25 |
| Tunneling | NO — Clemson IT stance against outbound persistent tunnels | 2026-05-25 |
| Database | Stay on shared Neon for now | 2026-05-25 |
| Docling deployment | Local-only `docling-serve` on port 5001 (bound 127.0.0.1) | 2026-05-25 |

## Deferred to a later deployment-planning phase

⚠️ **These items must be addressed before this can be called "deployed"
rather than "testbed":**

- **Real auth for faculty.** Basic Auth is a stopgap. Options to revisit:
  magic-link / per-user sessions (same pattern as `/partners`), Clemson
  SSO/Shibboleth integration, OAuth via a Clemson IdP.
- **DB migration off Neon.** Either to a Clemson-hosted Postgres or a
  local Postgres with a sync strategy. Touches backup/restore.
- **Backup and restore strategy.** Currently none. Needs:
  point-in-time recovery, off-site copies, restore drill cadence,
  retention policy.
- **Always-on hosting.** Today the server runs when the Mac is on.
  Eventually needs a dedicated machine, a Clemson VM, or a launchd
  setup with health monitoring.
- **Observability.** Logs, errors, AI cost tracking for the local
  deployment (currently goes to Vercel).
- **Two-app split.** If/when divergence between faculty and partner
  surfaces grows large, formalize as separate packages or repos.
- **Disaster recovery.** What happens if the Mac dies mid-audit-session.

## Implementation plan

### 1. PDF parser abstraction (no deploy dependency)
- New `PDF_PARSER` env var (`docling` | `unpdf`, default `unpdf`).
- New `lib/courses/docling-extractor.ts` adapter — POSTs file bytes to
  `${DOCLING_URL}/v1alpha/convert/file` (or current docling-serve API).
- Refactor `lib/courses/extract-text.ts` to dispatch on `PDF_PARSER`.
- Tests: mock the HTTP call, verify status mapping and text return.
- Vercel keeps `PDF_PARSER=unpdf` (default), so Vercel behavior unchanged.

### 2. Faculty Basic Auth middleware
- Extend `middleware.ts` matcher to also cover faculty routes.
- Inside middleware: skip `/partners/*` and `/preview/*` (their own
  gates / public). If `FACULTY_BASIC_AUTH` env var is set (format
  `user:password`), require `Authorization: Basic <b64>` on faculty
  routes; respond `401` with `WWW-Authenticate: Basic realm="..."`
  otherwise.
- On Vercel, leave `FACULTY_BASIC_AUTH` unset → middleware no-ops on
  faculty routes (Vercel surfaces unchanged).
- Tests: mock requests, verify gating per env-var state.

### 3. Local Docling setup
- Install `docling-serve` via Docker (recommended) or `pip install
  docling-serve`. Configure to bind 127.0.0.1:5001.
- Configure Docling pipeline to use omlx as VLM backend
  (OpenAI-compatible base URL `http://localhost:8000/v1`, model
  `Qwen3.5-4B-Instruct` or whatever MLX build the user installs).
- Confirm an MLX build exists in `mlx-community/*`; convert via
  `mlx_lm.convert` if not.

### 4. Local `.env.local`
- Template file: `.env.local.example`. Real `.env.local` (gitignored)
  with `AI_PROVIDER=local`, `LOCAL_*`, `PDF_PARSER=docling`,
  `DOCLING_URL`, `FACULTY_BASIC_AUTH`.

### 5. Mac firewall + LAN exposure
- `pnpm dev -- --hostname 0.0.0.0` (or update `package.json` dev script).
- macOS firewall: allow inbound on port 3000 for `node`.
- Find LAN IP: `ipconfig getifaddr en0`.
- Bookmark `http://<lan-ip>:3000` for faculty.

### 6. End-to-end test
- Real PDF (a rubric, a lecture slide, a research paper) → upload via
  CourseCapture → Docling extracts → omlx audits → compare extracted
  text vs current Vercel pipeline output side-by-side.

### 7. Documentation
- Add `docs/superpowers/running-locally.md` with the full setup steps.
- Update `CLAUDE.md` (project) with the dual-deployment note.

## Open questions

- **Which omlx model for heavy text reasoning?** User has Qwen3.5-9B,
  another Qwen3.5 variant, and Gemma 4 31B (likely text-only despite
  being described as multimodal — needs confirmation). Pick after
  seeing actual omlx `/v1/models` list.
- **Will the existing OpenAI structured-output JSON schemas survive
  the swap to local models?** Some local models handle
  `response_format` worse than GPT-5; may need per-function tuning or
  schema simplification.
