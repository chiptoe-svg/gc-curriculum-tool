# Running the curriculum tool locally (Phase 2 hybrid deploy)

This is the local Mac side of the Phase 2 hybrid deployment — see
`plans/2026-05-25-phase2-hybrid-deploy.md` for the why. The Vercel
deploy continues to handle partner-facing surfaces; this guide is
for the faculty-facing side.

## Faculty access (the short version)

Once the Mac is on and Clemson-network-connected:

- URL: `http://<mac-lan-ip>:3000` (currently `http://130.127.162.180:3000`)
- Username: `gcfaculty`
- Password: `godfrey`
- Browser remembers credentials after first login. Bookmark the URL.

The Mac must be awake and on the Clemson network (or Clemson VPN) for
faculty to reach it. Off → unreachable.

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

**Both Next.js and docling-serve are managed by launchd.** They start
automatically at login and restart on crash. You don't need to do
anything to make them run.

Plists live at:
- `~/Library/LaunchAgents/com.gc.curriculum-tool.plist` — Next.js dev server (port 3000, 0.0.0.0)
- `~/Library/LaunchAgents/com.gc.docling-serve.plist` — docling-serve (port 5001, 127.0.0.1)
- omlx is started separately (assumed already on; not managed by us)

To check status:
```bash
launchctl list | grep com.gc.
# Both should show a PID. Status code 0 = running healthy.
tail -f /tmp/curriculum-next.log     # Next.js logs
tail -f /tmp/docling-serve.log       # Docling logs
```

To restart one of them (e.g. after a code change that crashed Next.js):
```bash
launchctl kickstart -k "gui/$(id -u)/com.gc.curriculum-tool"
```

To stop both temporarily (rare — e.g. before a system update):
```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.gc.curriculum-tool.plist
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.gc.docling-serve.plist
# Reload with `launchctl bootstrap` (same command shape).
```

### One-time: allow inbound traffic through macOS firewall

If macOS firewall is on (System Settings → Network → Firewall), the
first time Next.js tries to accept an inbound connection on port 3000,
macOS prompts to allow or deny. Click **Allow**. If you missed the
prompt:

1. System Settings → Network → Firewall → Options…
2. Find `node` (or `/opt/homebrew/Cellar/node/.../bin/node`) in the list
3. Set it to "Allow incoming connections"

(If the prompt never appears AND faculty can't connect: the firewall
is likely on and blocking silently. Toggle it off → on once with
Allow set globally to "Allow built-in software" + "Allow signed
software" as a quick fix.)

### Manual start (for development without launchd)

If you want to run the dev server in a terminal (e.g. to see Turbopack
errors live, or you're testing a code change), first stop the launchd
instance:

```bash
launchctl kill TERM "gui/$(id -u)/com.gc.curriculum-tool"
pnpm dev:lan    # binds 0.0.0.0:3000 like the launchd version
# OR
pnpm dev        # localhost-only, for solo dev work
```

When you're done, launchd will restart the agent automatically on next
login (or now: `launchctl kickstart "gui/$(id -u)/com.gc.curriculum-tool"`).

### docling-serve startup (handled by launchd)

The launchd plist `~/Library/LaunchAgents/com.gc.docling-serve.plist`
launches docling-serve with the right env vars baked in:

```
DOCLING_DEVICE=cpu                                          # Apple Silicon MPS workaround
DOCLING_SERVE_ALLOW_CUSTOM_PICTURE_DESCRIPTION_CONFIG=true  # enable per-request VLM config
DOCLING_SERVE_ENABLE_REMOTE_SERVICES=true                   # permit outbound API calls (to omlx)
```

The first two `DOCLING_SERVE_*` env vars enable the optional VLM
picture-description pass: docling-serve accepts a per-request custom
config pointing at any OpenAI-compatible chat-completions endpoint
(your local omlx). Without them, picture description is disabled and
only text + tables come through.

**`DOCLING_DEVICE=cpu` is required on Apple Silicon.** Docling's
layout model trips on a float64 MPS type conversion that PyTorch's
MPS backend doesn't support. CPU adds ~1-3 seconds per page but
works reliably. Track upstream Docling for MPS fixes; revisit when
fixed.

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

### Next.js startup (handled by launchd)

The launchd plist `~/Library/LaunchAgents/com.gc.curriculum-tool.plist`
runs `pnpm dev:lan` from the project directory. `dev:lan` is a
package.json script that runs `next dev --turbopack --hostname 0.0.0.0`
— same as `pnpm dev` but binds to all interfaces so Clemson LAN
traffic can reach it.

Next.js auto-loads `.env.local` on boot, including:
- `AI_PROVIDER`, `OPENAI_*`, `LOCAL_*` — AI backend
- `PDF_PARSER=docling`, `DOCLING_*` — Docling pipeline
- `DOCLING_VLM_*` — figure-description VLM
- `FACULTY_BASIC_AUTH=gcfaculty:godfrey` — gate on the faculty surfaces

When `FACULTY_BASIC_AUTH` is set, faculty surfaces (/capture, /explore,
/program, /admin, /settings) prompt for the configured username:password
(realm "GC Curriculum Tool - Faculty"). Public surfaces (/partners,
/preview) and the home page are not gated by Basic Auth (the partner
side has its own session-cookie auth).

Visit:
- Solo dev: `http://localhost:3000` (no creds prompt since the gate
  fires there too — log in with the same gcfaculty:godfrey)
- LAN: `http://$(ipconfig getifaddr en0):3000` from any device on
  Clemson network or VPN

## Stopping

Both services are launchd-managed and run continuously. Use `launchctl`
to stop them temporarily (see "Per-session startup" above). Or restart
the Mac — they'll come back on next login.

omlx is also expected to stay on; configuration is separate (see
`~/.omlx/settings.json`).

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
- **HTTP Basic Auth is a stopgap** — see plan doc. Real per-user auth
  (magic-link, Clemson SSO) deferred to deployment-planning phase.
- **Mac-must-be-on** — when the Mac is asleep/off, faculty side is
  unreachable. launchd ensures the services restart on login, but
  the machine itself isn't always-on. For 24/7 access this needs to
  move to a dedicated Clemson-hosted machine or accept the constraint.
- **No backup/restore strategy** for the local data (Neon is still
  the DB, so DB-side backups are Neon's responsibility). See plan
  doc for backup roadmap.
