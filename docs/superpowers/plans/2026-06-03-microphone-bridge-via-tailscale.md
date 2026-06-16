# Microphone bridge via Tailscale Funnel

> **Status (2026-06-03):** SUPERSEDED by
> [`2026-06-03-hybrid-http-https-mic-architecture.md`](./2026-06-03-hybrid-http-https-mic-architecture.md).
> The iframe-bridge approach this plan implemented turned out to be
> spec-broken: per W3C Secure Contexts, an HTTPS iframe inside an HTTP
> parent is NOT a secure context, so `navigator.mediaDevices` was
> `undefined` and mic didn't work. The replacement architecture moves
> faculty surfaces to top-level HTTPS via the Tailscale Funnel (Basic
> Auth gates them) while keeping a public HTTP landing + read-only
> profile views on the LAN IP.

> **Status:** drafted, awaiting Chip's go-ahead. Independent of (but synergistic with) [`2026-06-03-single-db-local-migration.md`](./2026-06-03-single-db-local-migration.md), which shares the Tailscale Funnel setup.

**Goal.** Restore voice-input on the audit chat without forcing the entire app to HTTPS and without per-device cert installs. Solve it by exposing **only** the microphone-related paths (`/voice-bridge` + `/api/transcribe` + `/api/voice-session`) over an HTTPS Tailscale Funnel; the main app stays plain-HTTP LAN-only.

**Architecture in one paragraph.** Faculty visit the main app over plain HTTP at `http://gcworkflow.clemson.edu:3000` as today (no cert warnings, LAN-only). Clicking the mic button for the first time lazy-mounts a hidden iframe pointing at `https://<machine>.<tailnet>.ts.net/voice-bridge`. The iframe's own origin is HTTPS, so `getUserMedia()` works; it records, sends audio to `/api/transcribe` (also served over the Funnel), and `postMessage`s the transcript back to the main app's input field. The iframe stays mounted for the rest of the chat session so turns 2-30 have zero added round-trips. Authentication uses a session token (CSRF-style, 24-hour TTL, slug+IP bound, never appears in any URL) issued at the first mic click and reused for the session's lifetime.

**Tech stack.** Tailscale (already-considered Funnel feature), Next.js 15 (existing), no new dependencies. Reuses the existing `lib/ai/transcribe.ts` Whisper integration.

---

## Decisions baked in (per Chip's input across the prior discussion)

| Decision | Value |
|---|---|
| Tailscale Funnel vs. ngrok vs. mkcert-distribution | **Funnel** — real cert, stable URL, $0, no per-device install |
| What's exposed over the Funnel | **Only** `/voice-bridge`, `/api/transcribe`, `/api/voice-session` |
| Auth model | Session token (CSRF-style), not single-use nonces |
| Token TTL | **24 hours absolute**, slug+IP bound |
| Iframe mount timing | **Lazy** — on first mic click, not at page load |
| Iframe lifetime | Persists for the rest of the page session |

---

## File structure

```
app/
  voice-bridge/
    page.tsx              (NEW — the hidden HTTPS iframe page)
    VoiceBridgeClient.tsx (NEW — 'use client' component: record + post + postMessage)

  api/
    voice-session/
      route.ts            (NEW — POST /api/voice-session?slug=… → { token })
    transcribe/
      route.ts            (MODIFY — validate session token + Origin header + per-slug rate limit)

components/
  VoiceBridgeProxy.tsx    (NEW — drop-in replacement for VoiceRecorder; mounts iframe + handles postMessage)
  VoiceRecorder.tsx       (KEEP for now — fallback for local dev where Funnel isn't set up; eventually delete)

lib/
  voice-session/
    store.ts              (NEW — in-memory Map<token, {slug, ip, issuedAt}> + cleanup interval)

middleware.ts             (MODIFY — emit Permissions-Policy header allowing the Funnel origin to use mic)

scripts/
  setup-tailscale-funnel.sh (NEW — one-shot: install tailscale, register paths)
```

---

## Task 1: Tailscale install + Funnel configuration

**Files:** `scripts/setup-tailscale-funnel.sh` (new), `.env.local` (modify — `TAILSCALE_FUNNEL_ORIGIN`)

- [ ] **Step 1: Install Tailscale**

```bash
brew install --cask tailscale-app
# Or via App Store. Run the app, sign in with Chip's account.
```

- [ ] **Step 2: Note the machine's tailnet name**

```bash
tailscale status | head -2
# e.g. "host-mac.tailcb834.ts.net"
```

- [ ] **Step 3: Enable Funnel in the Tailscale admin console**

Web UI: https://login.tailscale.com/admin/dns → Funnel → Enable for this machine. (One-time per tailnet.)

- [ ] **Step 4: Configure path-restricted Funnel**

```bash
# Clear any defaults
tailscale serve --https=443 --bg / off

# Expose only the three voice-related paths over HTTPS
tailscale serve --https=443 --bg /voice-bridge   http://localhost:3000
tailscale serve --https=443 --bg /api/transcribe http://localhost:3000
tailscale serve --https=443 --bg /api/voice-session http://localhost:3000

# Promote to Funnel (public reachability)
tailscale funnel --https=443 --bg on
```

- [ ] **Step 5: Verify**

```bash
curl -I https://host-mac.tailcb834.ts.net/voice-bridge
# expect 200 (page) or 401 (slug gate) — NOT 404
curl -I https://host-mac.tailcb834.ts.net/capture/GC%204800
# expect 404 — main app NOT exposed
```

- [ ] **Step 6: Add origin to `.env.local`**

```
TAILSCALE_FUNNEL_ORIGIN=https://host-mac.tailcb834.ts.net
```

- [ ] **Step 7: Commit `scripts/setup-tailscale-funnel.sh`** wrapping steps 2-5 so a fresh machine can be brought up with one script.

---

## Task 2: Server-side session token

**Files:** `lib/voice-session/store.ts` (new), `app/api/voice-session/route.ts` (new)

- [ ] **Step 1: In-memory store**

```typescript
// lib/voice-session/store.ts
interface SessionTokenEntry {
  slug: string;
  ip: string;
  issuedAt: number;
}
const TTL_MS = 24 * 60 * 60 * 1000;
const store = new Map<string, SessionTokenEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [token, e] of store) if (now - e.issuedAt > TTL_MS) store.delete(token);
}, 5 * 60 * 1000);

export function issueToken(slug: string, ip: string): string {
  const token = crypto.randomBytes(24).toString('hex');
  store.set(token, { slug, ip, issuedAt: Date.now() });
  return token;
}

export function validateToken(token: string, slug: string, ip: string): boolean {
  const entry = store.get(token);
  if (!entry) return false;
  if (Date.now() - entry.issuedAt > TTL_MS) { store.delete(token); return false; }
  return entry.slug === slug && entry.ip === ip;
}
```

- [ ] **Step 2: Endpoint**

```typescript
// app/api/voice-session/route.ts
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const token = issueToken(slug, ipHash);
  return NextResponse.json({ token, ttlSeconds: 24 * 60 * 60 });
}
```

- [ ] **Step 3: Commit**

---

## Task 3: `/voice-bridge` page

**Files:** `app/voice-bridge/page.tsx` + `app/voice-bridge/VoiceBridgeClient.tsx` (new)

- [ ] **Step 1: Page shell**

```tsx
// app/voice-bridge/page.tsx
import { VoiceBridgeClient } from './VoiceBridgeClient';
export const dynamic = 'force-dynamic';
export default function VoiceBridgePage() {
  // Minimal HTML — invisible to the user. The client component handles
  // postMessage handshake, mic, transcribe, postMessage-back.
  return <VoiceBridgeClient />;
}
```

- [ ] **Step 2: Client component**

The voice-bridge component:
1. On mount, posts `{ kind: 'voice-bridge-ready' }` to `window.parent`
2. Listens for `{ kind: 'set-token', token }` from parent → stores in module state
3. Listens for `{ kind: 'start-record' }` → calls `getUserMedia({audio:true})` → starts MediaRecorder
4. Listens for `{ kind: 'stop-record' }` → stops MediaRecorder → uploads audio + token to `/api/transcribe` → posts `{ kind: 'transcript', text }` back to parent
5. Validates parent origin matches the expected main-app origin (passed as query param) before responding to commands

Pattern same as the existing `VoiceRecorder` but communicates via postMessage instead of callbacks.

- [ ] **Step 3: Commit**

---

## Task 4: `/api/transcribe` updates

**Files:** `app/api/transcribe/route.ts` (modify)

- [ ] **Step 1: Token + Origin + rate limit**

```typescript
// In the existing POST handler, before transcribe:
const token = req.headers.get('x-voice-token');
const slug = url.searchParams.get('slug') ?? '';
const ipHash = hashIp(req);
if (!token || !validateToken(token, slug, ipHash)) {
  return NextResponse.json({ error: 'invalid voice session token' }, { status: 401 });
}

// Origin pinning
const origin = req.headers.get('origin');
if (origin !== process.env.TAILSCALE_FUNNEL_ORIGIN) {
  return NextResponse.json({ error: 'invalid origin' }, { status: 403 });
}

// Per-slug rate limit (30/hour)
const allowed = await checkSlugRateLimit(slug, { limit: 30, windowMs: 60 * 60 * 1000 });
if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

// ... existing transcribe logic
```

- [ ] **Step 2: New `checkSlugRateLimit` helper** in `lib/rate-limit/slug-rate-limit.ts` modeled on `ip-rate-limit.ts`.

- [ ] **Step 3: Commit**

---

## Task 5: `<VoiceBridgeProxy>` replaces `<VoiceRecorder>`

**Files:** `components/VoiceBridgeProxy.tsx` (new), `components/AskTab.tsx` + `app/capture/[code]/CaptureChatPanel.tsx` (modify)

- [ ] **Step 1: VoiceBridgeProxy**

```tsx
// components/VoiceBridgeProxy.tsx
'use client';
interface Props {
  slug: string;
  disabled?: boolean;
  onTranscript: (text: string) => void;
}
export function VoiceBridgeProxy({ slug, disabled, onTranscript }: Props) {
  const [iframeMounted, setIframeMounted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // On first click: fetch token, mount iframe.
  async function handleStart() {
    if (!iframeMounted) {
      const res = await fetch(`/api/voice-session?slug=${encodeURIComponent(slug)}`, { method: 'POST' });
      const { token } = await res.json();
      setToken(token);
      setIframeMounted(true);
      // iframe will postMessage 'voice-bridge-ready' when loaded; we send token + start-record there
    } else {
      iframeRef.current?.contentWindow?.postMessage({ kind: 'start-record' }, FUNNEL_ORIGIN);
    }
    setRecording(true);
  }
  function handleStop() {
    iframeRef.current?.contentWindow?.postMessage({ kind: 'stop-record' }, FUNNEL_ORIGIN);
    setRecording(false);
  }

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== FUNNEL_ORIGIN) return;
      const msg = e.data as { kind: string };
      if (msg.kind === 'voice-bridge-ready' && token) {
        iframeRef.current?.contentWindow?.postMessage({ kind: 'set-token', token }, FUNNEL_ORIGIN);
        iframeRef.current?.contentWindow?.postMessage({ kind: 'start-record' }, FUNNEL_ORIGIN);
      } else if (msg.kind === 'transcript') {
        onTranscript((msg as { text: string }).text);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [token, onTranscript]);

  return (
    <>
      <button onClick={recording ? handleStop : handleStart} disabled={disabled} title="Record voice">
        🎤 {recording ? 'Stop' : 'Record'}
      </button>
      {iframeMounted && (
        <iframe
          ref={iframeRef}
          src={`${FUNNEL_ORIGIN}/voice-bridge?parentOrigin=${encodeURIComponent(window.location.origin)}`}
          style={{ width: 0, height: 0, border: 0, position: 'absolute' }}
          title="Voice bridge"
          allow="microphone"
        />
      )}
    </>
  );
}
const FUNNEL_ORIGIN = process.env.NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN ?? '';
```

- [ ] **Step 2: Add `NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN`** to `.env.local`

- [ ] **Step 3: Swap usages** in `components/AskTab.tsx` and `app/capture/[code]/CaptureChatPanel.tsx` — `<VoiceRecorder>` becomes `<VoiceBridgeProxy>`. Same prop shape.

- [ ] **Step 4: Commit**

---

## Task 6: Permissions-Policy header

**Files:** `middleware.ts` (modify) OR `next.config.ts` (modify)

- [ ] **Step 1: Allow Funnel origin to use mic**

Add a response header on every response from the main app:

```
Permissions-Policy: microphone=(self "https://host-mac.tailcb834.ts.net")
```

Without this, the iframe is blocked from accessing the mic even though its origin is secure context. Done in middleware OR via `headers()` in `next.config.ts`.

- [ ] **Step 2: Test** — open the capture page, click mic, browser prompts for permission, recording works, transcript appears.

- [ ] **Step 3: Commit**

---

## Task 7: STATE.md + smoke tests

- [ ] STATE.md: add a "Voice input via Tailscale Funnel mic bridge" entry. Document the Funnel origin env var, the path-restricted Funnel configuration, the session token TTL.
- [ ] Manual smoke tests:
  1. Open `/capture/GC 4800` over HTTP, click mic, browser asks for permission, record + transcribe works
  2. Reload, click mic, no permission prompt the second time
  3. Open Web Inspector, confirm no `/voice-bridge` request before mic is clicked (lazy mount)
  4. Click mic 30 times in succession — no degradation in latency
  5. Attempt `curl -X POST https://host-mac.tailnet.ts.net/api/transcribe` from a non-allowed Origin → 403
  6. Attempt `curl -X POST https://host-mac.tailnet.ts.net/api/transcribe` with no token → 401
- [ ] Commit STATE.md update.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Tailscale daemon goes down → mic unavailable | launchd KeepAlive on Tailscale; existing watchdog cron extends to probe `https://hostname.tailnet.ts.net/voice-bridge`. App degrades gracefully (no mic; everything else fine). |
| `/api/transcribe` abused via leaked token | TTL 24hr + slug+IP bound + per-slug 30/hr rate limit + daily cost cap. Worst-case abuse cost: bounded by daily cap. |
| Browser blocks iframe mic permission | Permissions-Policy header in main app explicitly allows Funnel origin. Tested per browser. |
| Faculty postMessage replay from a rogue tab | Parent listener validates `event.origin === FUNNEL_ORIGIN`; rogue origin messages ignored. |
| Tailscale Funnel terms-of-service / fair-use kicks in for high volume | Funnel is intended for low-bandwidth services; voice transcription is bursty + small. Well within fair use for one classroom's worth of usage. |
| In-memory token store lost on Next.js restart | Faculty's first mic click after restart fetches a new token transparently. Minor — no user-visible impact. |

---

## Open questions (none)

Plan is ready to execute. Estimated wall-clock: half a day. Order is fixed (Task 1 → 7). Can be shipped independently of the Postgres migration.

If shipped first, the migration plan ([`2026-06-03-single-db-local-migration.md`](./2026-06-03-single-db-local-migration.md)) extends this Tailscale Funnel configuration to add `/partners/*` paths, eliminating the need for Neon + Vercel entirely.
