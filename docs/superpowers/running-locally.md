# Running the curriculum tool locally (Phase 2 hybrid deploy)

This is the local Mac side of the Phase 2 hybrid deployment — see
`plans/2026-05-25-phase2-hybrid-deploy.md` for the why. The Vercel
deploy continues to handle partner-facing surfaces; this guide is
for the faculty-facing side.

## One-time setup

### 1. omlx (local LLMs)

Already installed and running. Models live in
`/Users/admin/projects/Models/`. Verify with:

```bash
curl -s http://localhost:8000/v1/models -H "Authorization: Bearer godfrey" | python3 -m json.tool
```

You should see at least:
- `Qwen3.6-35B-A3B-UD-MLX-4bit` (MoE, fast — used as default)
- `Qwen3.6-27B-UD-MLX-4bit` (dense, slower, higher single-shot quality)
- `gemma-4-31B-it-MLX-4bit` (alternative)

### 2. docling-serve (PDF extraction)

Installed via `uv tool install docling-serve`. Verify with:

```bash
docling-serve --version
```

### 3. .env.local

Already configured. To use the local pipeline, your `.env.local`
should have:

```
AI_PROVIDER=local
LOCAL_BASE_URL=http://localhost:8000/v1
LOCAL_API_KEY=godfrey
LOCAL_MODEL=Qwen3.6-35B-A3B-UD-MLX-4bit
PDF_PARSER=docling
DOCLING_URL=http://localhost:5001
```

(`AI_PROVIDER=local` flips AI calls to omlx. Leaving it as `openai`
keeps using OpenAI even with `PDF_PARSER=docling` — useful while
validating extraction quality independently of model swap.)

For Clemson LAN exposure (other GC faculty), add:

```
FACULTY_BASIC_AUTH=faculty:somepassword
```

…and bind Next.js to 0.0.0.0 (see "Per-session startup" below).

## Per-session startup

Three processes need to be running. omlx is typically already on
(it's launchd-managed or started at login). The other two need
manual start for now.

### Start docling-serve

```bash
DOCLING_DEVICE=cpu \
DOCLING_SERVE_ALLOW_CUSTOM_PICTURE_DESCRIPTION_CONFIG=true \
DOCLING_SERVE_ENABLE_REMOTE_SERVICES=true \
nohup docling-serve run --host 127.0.0.1 --port 5001 \
  > /tmp/docling-serve.log 2>&1 &
disown
```

The two `DOCLING_SERVE_*` env vars enable the optional VLM
picture-description pass: docling-serve will accept a per-request
custom config pointing at any OpenAI-compatible chat-completions
endpoint (i.e., your local omlx). Without them, picture description
is disabled and only text + tables come through.

**Important: `DOCLING_DEVICE=cpu` is required on Apple Silicon.**
Docling's layout model trips on a float64 MPS type conversion that
PyTorch's MPS backend doesn't support. CPU adds ~1-3 seconds per page
but works reliably. Track upstream Docling for MPS fixes; revisit
when fixed.

### Optional: enable VLM figure descriptions

In `.env.local` (Next.js side), set:

```
DOCLING_VLM_ENABLED=true
DOCLING_VLM_URL=http://localhost:8000/v1/chat/completions
DOCLING_VLM_API_KEY=<your omlx key>
DOCLING_VLM_MODEL=Qwen3.6-35B-A3B-UD-MLX-4bit
```

When set, every PDF/PPTX/image with embedded figures will get a
1-2 sentence description appended per figure (chart type, axes,
key values, etc.). Adds ~3s per figure (CPU). Leave unset on
Vercel — the env vars are absent there and the feature no-ops.

Verify it's up:

```bash
curl -s http://127.0.0.1:5001/health   # → {"status":"ok"} or similar
```

First-time start downloads ~2GB of layout/table/OCR models from
HuggingFace — takes a minute or two. Subsequent starts are
near-instant (cached at
`~/.local/share/uv/tools/docling-serve/lib/python3.12/site-packages/rapidocr/models/`
and `~/.cache/huggingface/`).

### Start Next.js

```bash
cd ~/projects/curriculum_developer
pnpm dev                                 # localhost-only, default
# OR for Clemson LAN access:
pnpm dev -- --hostname 0.0.0.0           # binds 0.0.0.0:3000
```

Visit:
- Localhost: `http://localhost:3000`
- LAN: `http://$(ipconfig getifaddr en0):3000` from any device on
  Clemson network or VPN

When `FACULTY_BASIC_AUTH` is set, faculty surfaces (/capture,
/explore, /program, /admin, /settings) prompt for the configured
username:password. Public surfaces (/partners, /preview) and the
home page are not gated by Basic Auth (the partner side has its
own session-cookie auth).

## Stopping

```bash
# Next.js: Ctrl-C in its terminal
# docling-serve:
pkill -f "docling-serve run"
```

omlx stays on (launchd-managed).

## Verifying the local pipeline is actually being used

When you upload a PDF through CourseCapture and it's processed:
- Check `/tmp/docling-serve.log` — you should see POST /v1/convert/file
- Check `~/.omlx/logs/` for omlx hits during the audit

If you see neither but extraction succeeded, you might still be on
the unpdf path or the OpenAI path — confirm `.env.local` is loaded
(Next.js prints the path it reads on dev start) and check
`PDF_PARSER` / `AI_PROVIDER` aren't being shadowed by a parent shell
env var.

## Known gaps (Phase 2 testbed)

- **Docling on CPU is 3-5× slower than GPU would be** — adequate for
  testing, may need MPS fix or external Docling deploy for production
  load.
- **Docling figure-description VLM not yet wired** — basic text +
  table extraction works; chart descriptions still go through the
  existing vision fallback heuristic (which routes image-based PDFs
  to OpenAI). Will wire docling → omlx VLM after this is validated.
- **No always-on hosting** — when Mac is off, faculty side is
  unreachable. See plan doc for hosting roadmap.
- **HTTP Basic Auth is a stopgap** — see plan doc.
