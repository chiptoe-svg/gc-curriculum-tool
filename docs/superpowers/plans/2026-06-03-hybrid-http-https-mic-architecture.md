# Hybrid HTTP/HTTPS Architecture — Public Read, Faculty Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken HTTPS iframe bridge with a clean dual-surface architecture: a public HTTP landing + read-only profile views on the LAN IP, and Basic-Auth-gated edit/audit pages on the Tailscale Funnel HTTPS origin (where mic works natively as a top-level secure context).

**Architecture:** The HTTP iframe-into-HTTP-parent bridge is a spec dead-end — browsers refuse to grant secure-context status to an HTTPS iframe inside an HTTP parent, so `navigator.mediaDevices` is `undefined`. Fix: move the surfaces that *need* mic to a top-level HTTPS context (the existing Tailscale Funnel), gated by the existing Basic Auth. Surfaces that don't need auth (course list, read-only profile views) stay on plain HTTP — they're intentionally public on the LAN ("transparent curriculum" — anyone can read, only faculty can edit). Faculty enter Basic Auth once per browser session when they click Edit; the credential is cached for the HTTPS origin. No popups, no iframes, no certificate install.

**Tech Stack:** Next.js 15 App Router (existing), Tailscale Funnel (existing — re-scoped), Basic Auth middleware (existing — paths re-shuffled), `<VoiceRecorder />` component (existing — never deleted, returning to active use).

---

## Background — what this replaces

The current architecture (shipped 2026-06-03 in [`2026-06-03-microphone-bridge-via-tailscale.md`](./2026-06-03-microphone-bridge-via-tailscale.md)) is fundamentally broken in any spec-compliant browser. Per the W3C Secure Contexts spec, an iframe inherits non-secure status from its HTTP parent — so even though `https://tailnet.ts.net/voice-bridge` loads over HTTPS, when embedded inside `http://130.127.x.x:3000/capture/...` the iframe is **not** a secure context. `navigator.mediaDevices` is `undefined`. Mic blocked. Architectural fix required, not a bug fix.

What we keep:

- The Tailscale Funnel setup (cert, ACL `funnel` attribute, `tailscale funnel` CLI). Re-scope mounts from three narrow paths to the whole app.
- `lib/ai/transcribe.ts` (mic transcription with omlx + CLI + OpenAI ladder, shipped earlier today) — unchanged.
- `/api/transcribe` route — simplified (no token, no origin pin, no slug-rate-limit; just standard Basic Auth like every other API route).
- `VoiceRecorder` component (`components/VoiceRecorder.tsx`) — the original, pre-iframe component; was preserved as fallback, returns to primary use.

What we delete:

- `components/VoiceBridgeProxy.tsx` (the iframe-wrapper component)
- `app/voice-bridge/page.tsx` + `app/voice-bridge/VoiceBridgeClient.tsx` (the iframe target page)
- `app/api/voice-session/route.ts` + `lib/voice-session/store.ts` (the 24-hour session token store — no longer needed since Basic Auth IS the gate)
- `lib/rate-limit/slug-rate-limit.ts` (was added for the public `/api/transcribe`; redundant once it's Basic-Auth-gated like everything else)
- Permissions-Policy header in `next.config.ts` (was delegating mic to the funnel origin for iframe; not needed now)

What we add:

- New public HTTP landing at `/` (replaces current slug-gated home for HTTP visitors; HTTPS visitors with slug still get the faculty hub).
- New public HTTP read-only profile view at `/view/[code]`.
- A small `READ_ONLY_PREFIXES` allowlist in `lib/auth/basic-auth.ts` for the two paths above.
- Updated setup script that mounts `/` on the funnel + reflects the simpler arch.

---

## File structure

**New files:**
- `app/(public)/page.tsx` — public HTTP landing (course list, View + Edit links). Uses route groups so it doesn't conflict with the existing slug-gated `app/page.tsx` flow; the route group `(public)` doesn't appear in URLs.
  - Actually simpler: just rewrite `app/page.tsx` directly. The current home is one block. No route groups needed.
- `app/view/[code]/page.tsx` — public HTTP read-only profile view.
- `app/view/[code]/ReadOnlyProfile.tsx` — client-free render of the profile (no edit affordances, no client JS where avoidable).

**Modified files:**
- `app/page.tsx` — replace slug-gated home with public landing (read+forward to faculty hub if slug+auth present).
- `app/capture/[code]/CaptureChatPanel.tsx` — swap `VoiceBridgeProxy` → `VoiceRecorder` import + usage.
- `components/AskTab.tsx` — same swap.
- `lib/auth/basic-auth.ts` — drop voice-bridge entries from `PUBLIC_PREFIXES`; add `/view` and root `/` as new public paths.
- `app/api/transcribe/route.ts` — strip token validation, origin pinning, slug-rate-limit (Basic Auth on the middleware layer now handles auth; per-IP rate-limit + daily cost cap remain).
- `next.config.ts` — remove Permissions-Policy header block.
- `scripts/setup-tailscale-funnel.sh` — mount `/` instead of the four narrow paths.

**Deleted files:**
- `components/VoiceBridgeProxy.tsx`
- `app/voice-bridge/page.tsx`
- `app/voice-bridge/VoiceBridgeClient.tsx`
- `app/api/voice-session/route.ts`
- `lib/voice-session/store.ts` (+ the empty `lib/voice-session/` dir)
- `lib/rate-limit/slug-rate-limit.ts`

**Env vars retired:**
- `TAILSCALE_FUNNEL_ORIGIN` and `NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN` — no longer referenced after cleanup. Leave them in `.env.local` for now; `.env.example` was never updated to include them, so no doc change.

---

## Task 1: Re-scope the funnel mounts

**Files:**
- Modify: `scripts/setup-tailscale-funnel.sh`

- [ ] **Step 1: Update the mount script to expose `/` instead of four narrow paths**

The current script mounts `/voice-bridge`, `/api/transcribe`, `/api/voice-session`, `/_next`. We replace those with a single root mount so the funnel proxies the whole app — Basic Auth (in middleware) is now what gates access, not path-level exposure.

Open `scripts/setup-tailscale-funnel.sh` and replace the `PATHS=(...)` array + its for-loop with:

```bash
# Mount root — the funnel now proxies the whole app, with Basic Auth in
# middleware as the gate. The new HTTP landing at the LAN IP (which has
# a small allowlist for public read-only paths) is reachable separately
# at http://<lan-ip>:3000.
#
# Why root and not a path allowlist: the architecture moved from "narrow
# iframe bridge for mic" to "whole faculty app on HTTPS so mic works
# natively in a top-level secure context." See plan
# docs/superpowers/plans/2026-06-03-hybrid-http-https-mic-architecture.md.
echo "Mounting funnel: /"
tailscale funnel --bg --https=443 http://127.0.0.1:3000
```

Also update the trailing verification echoes:

```bash
echo
echo "✓ Funnel is up. Verify with:"
echo "  curl -I ${FUNNEL_ORIGIN}/capture/test   # expect 401 (Basic Auth challenge)"
echo "  curl -I ${FUNNEL_ORIGIN}/_next/static/  # expect 401 (Basic Auth challenge)"
echo
echo ".env.local should already have:"
echo "  TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo "  NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo "(These are no longer used by app code post-cleanup, but kept for"
echo " the landing page to know where to link Edit buttons.)"
```

Also delete the old comment block about Basic Auth bypass for narrow paths (lines 55-60 in the current script) since the rationale no longer applies.

- [ ] **Step 2: Apply the new funnel config to the running Mac**

```bash
tailscale serve reset
tailscale funnel --bg --https=443 http://127.0.0.1:3000
tailscale funnel status
```

Expected output of `tailscale funnel status`:
```
# Funnel on:
#     - https://admins-mac-studio-2.tailb723c1.ts.net

https://admins-mac-studio-2.tailb723c1.ts.net (Funnel on)
|-- / proxy http://127.0.0.1:3000
```

- [ ] **Step 3: Sanity-check that funnel reaches the app**

```bash
FUNNEL="https://admins-mac-studio-2.tailb723c1.ts.net"
curl -sk -o /dev/null -w '%{http_code}\n' "$FUNNEL/capture/test"
```

Expected: `401` (Basic Auth challenge from the middleware; not a 404, not a 503).

- [ ] **Step 4: Commit**

```bash
git add scripts/setup-tailscale-funnel.sh
git commit -m "fix(funnel): mount root instead of narrow voice paths

The iframe bridge approach is being replaced with whole-app HTTPS
exposure on the funnel — Basic Auth in middleware is now the only
gate, replacing the per-path allowlist that was needed when the
voice routes had to bypass Basic Auth for cross-origin iframe access."
```

---

## Task 2: Swap consumers from VoiceBridgeProxy to VoiceRecorder

**Files:**
- Modify: `app/capture/[code]/CaptureChatPanel.tsx`
- Modify: `components/AskTab.tsx`

- [ ] **Step 1: Update CaptureChatPanel import + usage**

In `app/capture/[code]/CaptureChatPanel.tsx`, change line 4:

```tsx
// Before:
import { VoiceBridgeProxy } from '@/components/VoiceBridgeProxy';

// After:
import { VoiceRecorder } from '@/components/VoiceRecorder';
```

Then around line 393, change:

```tsx
// Before:
<VoiceBridgeProxy slug={slug} onTranscript={appendTranscript} disabled={busy} />

// After:
<VoiceRecorder slug={slug} onTranscript={appendTranscript} disabled={busy} />
```

`VoiceRecorder` has the same `{ slug, onTranscript, disabled }` props signature — no other call-site changes needed.

- [ ] **Step 2: Update AskTab the same way**

In `components/AskTab.tsx`, change line 16:

```tsx
// Before:
import { VoiceBridgeProxy } from '@/components/VoiceBridgeProxy';

// After:
import { VoiceRecorder } from '@/components/VoiceRecorder';
```

Around line 255, change:

```tsx
// Before:
<VoiceBridgeProxy
  slug={slug}
  onTranscript={...}
  ...
/>

// After:
<VoiceRecorder
  slug={slug}
  onTranscript={...}
  ...
/>
```

Preserve every other prop on the existing `<VoiceBridgeProxy>` usage exactly — just rename the component. (If there are props `VoiceRecorder` doesn't accept, remove them and note any UX regression in the commit message.)

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/capture/[code]/CaptureChatPanel.tsx components/AskTab.tsx
git commit -m "refactor(voice): switch CaptureChatPanel + AskTab back to VoiceRecorder

The iframe-bridge architecture is being torn down because HTTPS iframes
inside HTTP parents are not secure contexts per W3C spec, so mic was
blocked. The faculty surfaces move to HTTPS via Tailscale Funnel, where
the page itself is a top-level secure context and VoiceRecorder works
natively. Same { slug, onTranscript, disabled } prop signature, so the
swap is mechanical."
```

---

## Task 3: Delete voice-bridge infrastructure

**Files:**
- Delete: `components/VoiceBridgeProxy.tsx`
- Delete: `app/voice-bridge/page.tsx`
- Delete: `app/voice-bridge/VoiceBridgeClient.tsx`
- Delete: `app/voice-bridge/` (empty dir)
- Delete: `app/api/voice-session/route.ts`
- Delete: `app/api/voice-session/` (empty dir)
- Delete: `lib/voice-session/store.ts`
- Delete: `lib/voice-session/` (empty dir)
- Delete: `lib/rate-limit/slug-rate-limit.ts`

- [ ] **Step 1: Delete the voice-bridge files**

```bash
rm -rf app/voice-bridge
rm -rf app/api/voice-session
rm -rf lib/voice-session
rm components/VoiceBridgeProxy.tsx
rm lib/rate-limit/slug-rate-limit.ts
```

- [ ] **Step 2: Verify nothing still imports the deleted symbols**

```bash
grep -rn "VoiceBridgeProxy\|voice-session/store\|slug-rate-limit\|VoiceBridgeClient" \
  --include='*.tsx' --include='*.ts' . \
  | grep -v node_modules | grep -v '.next' || echo "no references"
```

Expected: `no references`. If anything matches, it's stale and needs to be fixed (likely a comment in `next.config.ts` referencing `VoiceBridgeProxy` — keep that file for Task 4, fix the comment then).

- [ ] **Step 3: Verify typecheck still passes**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors. (Task 2 already swapped consumers.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(voice): delete iframe-bridge files (VoiceBridgeProxy, voice-bridge route, voice-session store)

Architecture replaced — see plan
docs/superpowers/plans/2026-06-03-hybrid-http-https-mic-architecture.md.
The iframe bridge was a workaround for HTTPS mic from HTTP parent, but
HTTPS iframes inside HTTP parents are not secure contexts per W3C spec.
The faculty surfaces are moving to HTTPS via Tailscale Funnel where
mic works natively in a top-level secure context."
```

---

## Task 4: Simplify /api/transcribe + next.config.ts

**Files:**
- Modify: `app/api/transcribe/route.ts`
- Modify: `next.config.ts`

- [ ] **Step 1: Strip voice-session token + origin pin + slug-rate-limit from /api/transcribe**

Open `app/api/transcribe/route.ts`. Replace the entire file with:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { transcribeAudio, isSupportedAudioMime } from '@/lib/ai/transcribe';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

// 5 MB ≈ 5 minutes of webm/opus voice at typical browser settings. Tuned
// to keep Whisper round-trip latency under a few seconds. Bump if longer
// recordings turn out to be useful.
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

// POST /api/transcribe?slug=...
// Body: multipart/form-data with field `audio` (the recording blob).
// Returns: { text: string }
//
// Reached only from faculty pages over the Tailscale Funnel HTTPS origin.
// Auth model: Basic Auth (middleware) is the gate; per-IP rate limit +
// daily cost cap remain as backstops. The earlier voice-session token +
// origin-pinning layer was needed when this route had to bypass Basic
// Auth for cross-origin iframe access — no longer the architecture.
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: 'missing audio field' }, { status: 400 });
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: 'empty audio' }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `audio too large (${audio.size} > ${MAX_AUDIO_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const mime = audio.type || 'audio/webm';
  if (!isSupportedAudioMime(mime)) {
    return NextResponse.json({ error: `unsupported audio MIME type: ${mime}` }, { status: 415 });
  }

  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const result = await transcribeAudio(bytes, mime);
    return NextResponse.json({ text: result.text, model: result.model });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'transcription failed';
    console.error('[/api/transcribe] failed:', message);
    return NextResponse.json({ error: 'transcription failed' }, { status: 500 });
  }
}
```

Key changes vs. the current file:
- Drop the `validateVoiceToken` import + the `x-voice-token` header check + the slug+IP token binding (the whole "voice-session token" layer).
- Drop the Origin pinning block (was `req.headers.get('origin') !== TAILSCALE_FUNNEL_ORIGIN`).
- Drop the `checkSlugRateLimit` import + call (the per-slug rate limit was a backstop for the public endpoint; Basic Auth handles auth now and per-IP rate limit remains).
- Keep: slug check, per-IP rate limit, daily cost cap (which happens inside `transcribeAudio` via the model providers), 5 MB size cap, MIME validation.

- [ ] **Step 2: Remove Permissions-Policy header block from next.config.ts**

Open `next.config.ts` and delete the entire `async headers()` block (the one that conditionally sets `Permissions-Policy: microphone=(self "${funnelOrigin}")`). The page itself is HTTPS now — `microphone=(self)` is the browser default for same-origin and we don't need to delegate to a foreign origin.

After the edit, the `next.config.ts` `NextConfig` object should look like:

```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ['unpdf'],
  outputFileTracingIncludes: {
    "/api/**/*": ["./lib/ai/prompts/**/*.md"],
  },
  experimental: {
    middlewareClientMaxBodySize: '25mb',
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};
```

(The `headers()` async function and its leading comment block get fully removed.)

- [ ] **Step 3: Verify typecheck still passes**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Restart Next.js so the new middleware + transcribe handler load**

```bash
launchctl kickstart -k gui/501/com.gc.curriculum-tool
```

- [ ] **Step 5: Smoke-test transcribe through the funnel with Basic Auth**

```bash
FUNNEL="https://admins-mac-studio-2.tailb723c1.ts.net"
BASIC=$(grep '^FACULTY_BASIC_AUTH=' .env.local | cut -d= -f2)
TMPDIR=$(mktemp -d)
ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:duration=2:sample_rate=16000" -ac 1 "$TMPDIR/test.wav"
curl -sk -u "$BASIC" -X POST "$FUNNEL/api/transcribe?slug=test" \
  -F "audio=@$TMPDIR/test.wav;type=audio/wav"
rm -rf "$TMPDIR"
```

Expected: a `{"text":"...","model":"..."}` JSON response (text will be empty or punctuation for the sine wave; the success is that we get a 200 with a `text` key).

- [ ] **Step 6: Commit**

```bash
git add app/api/transcribe/route.ts next.config.ts
git commit -m "refactor(transcribe): drop voice-session token + origin pin + Permissions-Policy

/api/transcribe is reached only by faculty pages on the HTTPS funnel
now. Basic Auth in middleware is the gate (same as every other faculty
API route); per-IP rate limit + daily cost cap remain as backstops.

Permissions-Policy header was delegating mic to the funnel origin so
the iframe-in-HTTP-parent could call getUserMedia. The whole faculty
app is now top-level HTTPS, so microphone=(self) — the browser default
for same-origin — is what we want."
```

---

## Task 5: Update Basic Auth allowlist for new public paths

**Files:**
- Modify: `lib/auth/basic-auth.ts`

- [ ] **Step 1: Replace the PUBLIC_PREFIXES allowlist**

Open `lib/auth/basic-auth.ts`. Replace the `PUBLIC_PREFIXES` block with:

```typescript
/** Paths whose prefixes are intentionally public or self-authenticating. */
const PUBLIC_PREFIXES = [
  '/partners',
  '/preview',
  '/api/partners',
  '/api/preview',
  // Public read-only surfaces. The HTTP landing at "/" lists every
  // course; "/view/[code]" renders the latest captured profile read-only.
  // Both are intentionally reachable by anyone on the LAN — the value
  // is "transparent curriculum, anyone can read; only faculty can edit."
  // Edit pages link to the HTTPS Tailscale Funnel where Basic Auth
  // gates them.
  '/view',
] as const;

/**
 * Returns true if the given pathname should be guarded by faculty
 * Basic Auth (assuming the env var that enables the gate is set).
 *
 * Special case: the bare home "/" path is public (it's the new landing).
 * Everything else not in PUBLIC_PREFIXES is gated.
 */
export function requiresBasicAuth(pathname: string): boolean {
  if (pathname === '/') return false;
  return !PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));
}
```

Key changes vs. current:
- Removed `/voice-bridge`, `/api/voice-session`, `/api/transcribe` (the first two are deleted; `/api/transcribe` is no longer special-cased — it gets Basic Auth like every other faculty route).
- Added `/view`.
- Added the `pathname === '/'` short-circuit (root is now public; we can't use a `/` prefix entry because `startsWith('/')` would match everything).

- [ ] **Step 2: Verify the helper logic via the existing tests**

```bash
ls lib/auth/*.test.ts 2>/dev/null && pnpm vitest run lib/auth/ || echo "(no existing tests for basic-auth — skipping)"
```

If tests exist and pass, great. If they don't exist, that's fine for this plan — the helper is small enough that the typecheck + manual smoke is sufficient.

- [ ] **Step 3: Restart Next.js and smoke-test the new public/private split**

```bash
launchctl kickstart -k gui/501/com.gc.curriculum-tool
sleep 3
LAN="http://127.0.0.1:3000"
echo "  /        : $(curl -s -o /dev/null -w '%{http_code}' $LAN/)            (expect 200 — public landing)"
echo "  /view/X  : $(curl -s -o /dev/null -w '%{http_code}' $LAN/view/X)      (expect 404 if X doesn't exist, 200 if it does — but NOT 401)"
echo "  /capture/: $(curl -s -o /dev/null -w '%{http_code}' $LAN/capture/test) (expect 401 — Basic Auth gated)"
echo "  /admin   : $(curl -s -o /dev/null -w '%{http_code}' $LAN/admin)       (expect 401)"
```

(After Task 7 the `/` page will exist; until then, this returns whatever the current home does. The key check here is `/capture/test` returns 401, confirming Basic Auth still gates faculty surfaces.)

- [ ] **Step 4: Commit**

```bash
git add lib/auth/basic-auth.ts
git commit -m "feat(auth): public root + /view; drop voice-bridge entries from allowlist

The new public surfaces are the HTTP landing at \"/\" and the read-only
profile view at \"/view/[code]\" — both intentionally reachable by
anyone on the LAN (transparent curriculum: anyone reads, faculty edits).

Voice-bridge entries (/voice-bridge, /api/voice-session, /api/transcribe)
removed: the first two no longer exist, and /api/transcribe is no
longer special-cased — it gets the standard Basic Auth gate like every
other faculty route now that mic flows through the HTTPS funnel."
```

---

## Task 6: New public read-only profile view

**Files:**
- Create: `app/view/[code]/page.tsx`
- Create: `app/view/[code]/ReadOnlyProfile.tsx`

- [ ] **Step 1: Write the page server component**

Create `app/view/[code]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db/client';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { courses, courseCaptureSnapshots } from '@/lib/db/schema';
import { ReadOnlyProfile } from './ReadOnlyProfile';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
}

/**
 * Public HTTP read-only profile view. No slug, no Basic Auth — anyone
 * on the LAN can read a captured course profile. Renders the latest
 * non-retired snapshot if one exists; falls back to a "no profile yet"
 * message otherwise.
 *
 * The Edit link sends faculty to the HTTPS Tailscale Funnel origin
 * where Basic Auth gates the editor and mic works natively.
 */
export default async function ViewCoursePage({ params }: Props) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);

  const [course] = await db
    .select({ code: courses.code, title: courses.title })
    .from(courses)
    .where(eq(courses.code, code))
    .limit(1);

  if (!course) notFound();

  const [snapshot] = await db
    .select({
      id: courseCaptureSnapshots.id,
      profile: courseCaptureSnapshots.profile,
      capturedAt: courseCaptureSnapshots.capturedAt,
    })
    .from(courseCaptureSnapshots)
    .where(
      and(
        eq(courseCaptureSnapshots.courseCode, code),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    )
    .orderBy(desc(courseCaptureSnapshots.capturedAt))
    .limit(1);

  // Bake the slug into the Edit link server-side so faculty don't need
  // to know or type it. The slug is a deeper-layer gate (defense in
  // depth alongside Basic Auth); the env var is the canonical source.
  const slug = process.env.PROTOTYPE_SLUG ?? '';
  const funnelOrigin = process.env.TAILSCALE_FUNNEL_ORIGIN ?? '';
  const editHref = funnelOrigin && slug
    ? `${funnelOrigin}/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {course.code} · read-only
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              {course.title ?? course.code}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              ← Courses
            </Link>
            {editHref && (
              <a
                href={editHref}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                title="Faculty edit (requires login)"
              >
                Edit →
              </a>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        {snapshot ? (
          <ReadOnlyProfile profile={snapshot.profile} capturedAt={snapshot.capturedAt} />
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
            <p>No captured profile yet for {course.code}.</p>
            {editHref && (
              <p className="mt-2 text-sm">
                Faculty can start a capture via the Edit link above.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write the read-only profile renderer**

Create `app/view/[code]/ReadOnlyProfile.tsx`:

```tsx
/**
 * Read-only profile renderer. No edit affordances, no client-side
 * state. Renders the captured profile JSON as static markup.
 *
 * Intentionally minimal — we're showing the canonical-shaped data
 * (overview narrative, competencies, audit notes, course emphasis)
 * with no edit chrome. Reuses the same Tailwind tokens as
 * ProfileReviewPanel but doesn't share its component tree to avoid
 * inheriting any client-state assumptions.
 */
interface Props {
  profile: unknown; // CaptureProfile JSON from snapshots — shape varies across v1/v2
  capturedAt: Date | string;
}

interface MinimalProfile {
  overview?: {
    narrative?: string;
    at_a_glance?: string[];
    who_for?: string;
    arc?: string;
  };
  competencies?: Array<{
    name: string;
    k?: number | null;
    u?: number | null;
    d?: number | null;
    rationale?: string;
  }>;
  course_emphasis?: Array<{
    competency: string;
    share_pct?: number;
    centrality?: string;
  }>;
}

function isMinimalProfile(p: unknown): p is MinimalProfile {
  return typeof p === 'object' && p !== null;
}

export function ReadOnlyProfile({ profile, capturedAt }: Props) {
  if (!isMinimalProfile(profile)) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        Profile data is in an unexpected shape and can't be rendered here.
      </div>
    );
  }

  const date =
    typeof capturedAt === 'string'
      ? new Date(capturedAt)
      : capturedAt;

  return (
    <article className="space-y-8">
      <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Captured {date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {profile.overview?.narrative && (
        <section>
          <h2 className="sr-only">Overview</h2>
          <p className="font-display text-lg leading-relaxed">{profile.overview.narrative}</p>
        </section>
      )}

      {profile.overview?.at_a_glance && profile.overview.at_a_glance.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            At a glance
          </h2>
          <ul className="space-y-1">
            {profile.overview.at_a_glance.map((bullet, i) => (
              <li key={i} className="text-sm">— {bullet}</li>
            ))}
          </ul>
        </section>
      )}

      {profile.competencies && profile.competencies.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold">Competencies</h2>
          <div className="space-y-3">
            {profile.competencies.map((c, i) => (
              <div key={i} className="rounded-md border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono-plex text-xs text-muted-foreground">
                    K{c.k ?? '—'} · U{c.u ?? '—'} · D{c.d ?? '—'}
                  </span>
                </div>
                {c.rationale && (
                  <p className="mt-1 text-sm text-muted-foreground">{c.rationale}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {profile.course_emphasis && profile.course_emphasis.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold">Course emphasis</h2>
          <div className="space-y-1">
            {profile.course_emphasis.map((e, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2 text-sm">
                <span>{e.competency}</span>
                <span className="font-mono-plex text-xs text-muted-foreground">
                  {e.share_pct != null ? `${e.share_pct.toFixed(0)}%` : '—'} {e.centrality ?? ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
```

This is a minimum-viable read-only view — it shows the most important sections (overview, competencies, course emphasis) and gracefully no-ops on missing fields. Faculty users have the rich `ProfileReviewPanel` on the HTTPS Edit page; public viewers get the essentials. We can iterate visually later without breaking the contract.

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
# Pick a course that has a snapshot — GC 4800 is the most heavily captured.
launchctl kickstart -k gui/501/com.gc.curriculum-tool
sleep 3
curl -s -o /dev/null -w "/view/GC%204800: %{http_code}\n" http://127.0.0.1:3000/view/GC%204800
curl -s -o /dev/null -w "/view/NONEXISTENT: %{http_code}\n" http://127.0.0.1:3000/view/NONEXISTENT
```

Expected:
- `/view/GC%204800: 200` (renders the profile)
- `/view/NONEXISTENT: 404` (page calls `notFound()`)

If you're in Safari, open `http://127.0.0.1:3000/view/GC%204800` and visually confirm it renders without any "401" or login prompt.

- [ ] **Step 5: Commit**

```bash
git add app/view/
git commit -m "feat(view): public HTTP read-only profile view at /view/[code]

No slug, no Basic Auth — intentionally reachable by anyone on the LAN.
Renders the latest non-retired snapshot's profile JSON via a minimal
read-only component (no edit chrome). Edit button links faculty to
the HTTPS Tailscale Funnel where Basic Auth gates the editor and mic
works natively.

ReadOnlyProfile handles missing sections gracefully and falls through
to a 'no profile yet' state when no snapshot exists. The slug is baked
into the Edit link server-side from PROTOTYPE_SLUG so faculty don't
need to know or type it."
```

---

## Task 7: New public HTTP landing at /

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace the existing home page with the new public landing**

Open `app/page.tsx`. Replace the entire file with:

```tsx
import Link from 'next/link';
import { listCoursesWithStatus } from '@/lib/db/capture-status-queries';

export const dynamic = 'force-dynamic';

/**
 * Public HTTP landing page. No slug, no Basic Auth.
 *
 * Two link types per course:
 *   - View → /view/[code] (HTTP, read-only, public)
 *   - Edit → https://<funnel>/capture/[code]?slug=<PROTOTYPE_SLUG>
 *            (Basic Auth challenge on the HTTPS funnel)
 *
 * Faculty visit once, click Edit, enter Basic Auth, and the browser
 * caches credentials for the HTTPS origin for the rest of the session.
 *
 * The slug is baked into Edit links server-side from PROTOTYPE_SLUG
 * (the same slug acting as the deeper-layer access gate); faculty
 * don't need to know or type it.
 */
export default async function HomePage() {
  const slug = process.env.PROTOTYPE_SLUG ?? '';
  const funnelOrigin = process.env.TAILSCALE_FUNNEL_ORIGIN ?? '';

  const rows = await listCoursesWithStatus();
  rows.sort((a, b) => (a.level ?? 9999) - (b.level ?? 9999) || a.code.localeCompare(b.code));

  // Group by 1000/2000/3000/4000-level (matches the existing /courses page).
  const groups = new Map<number, typeof rows>();
  for (const r of rows) {
    const lvl = r.level ?? 9999;
    const bucket = Math.floor(lvl / 1000) * 1000;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(r);
  }
  const orderedBuckets = Array.from(groups.keys()).sort((a, b) => a - b);

  const facultyHubHref = funnelOrigin && slug
    ? `${funnelOrigin}/courses?slug=${encodeURIComponent(slug)}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Clemson · Graphic Communications
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              Curriculum
            </h1>
          </div>
          {facultyHubHref && (
            <a
              href={facultyHubHref}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
              title="Faculty hub (requires login)"
            >
              Faculty hub →
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <p className="mb-8 max-w-3xl text-sm text-muted-foreground">
          What every course in the Graphic Communications curriculum builds.
          Anyone can read profiles; faculty edit via the HTTPS hub.
        </p>

        <div className="space-y-10">
          {orderedBuckets.map((bucket) => (
            <section key={bucket}>
              <h2 className="mb-3 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {bucket}-level
              </h2>
              <ul className="divide-y border-y">
                {groups.get(bucket)!.map((row) => {
                  const editHref = funnelOrigin && slug
                    ? `${funnelOrigin}/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`
                    : null;
                  return (
                    <li key={row.code} className="grid grid-cols-[8rem_1fr_auto] items-baseline gap-4 py-3">
                      <span className="font-mono-plex text-sm">{row.code}</span>
                      <span className="font-display text-base">{row.title ?? '—'}</span>
                      <span className="flex items-baseline gap-3">
                        <Link
                          href={`/view/${encodeURIComponent(row.code)}`}
                          className="text-sm text-muted-foreground hover:text-foreground"
                        >
                          View →
                        </Link>
                        {editHref && (
                          <a
                            href={editHref}
                            className="text-sm text-muted-foreground hover:text-foreground"
                            title="Faculty edit (requires login)"
                          >
                            Edit ↗
                          </a>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
```

Key behavior:
- No slug check, no auth gate (PUBLIC_PREFIXES handles this in middleware).
- Each row has a `View` link (HTTP, public) and an `Edit` link (HTTPS funnel, Basic Auth gated).
- If `PROTOTYPE_SLUG` or `TAILSCALE_FUNNEL_ORIGIN` is unset, Edit links don't render — the page degrades to a pure-View experience instead of producing broken links.
- The faculty hub link in the header is the existing `/courses` page (which is slug-gated and Basic-Auth-gated, hosted on HTTPS).

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors. (`listCoursesWithStatus` returns the same shape used in `app/courses/page.tsx`.)

- [ ] **Step 3: Manual smoke test**

```bash
launchctl kickstart -k gui/501/com.gc.curriculum-tool
sleep 3
curl -s -o /dev/null -w "/ (LAN, no auth): %{http_code}\n" http://127.0.0.1:3000/
echo
echo "First 500 chars of /:"
curl -s http://127.0.0.1:3000/ | head -c 500
```

Expected: 200, with HTML that mentions "Curriculum" and lists courses. The "Faculty hub →" link's `href` should be the HTTPS funnel URL with `?slug=<value>`.

Then in a browser:
1. Open `http://130.127.x.x:3000/` (LAN IP) — should render the landing with no login prompt.
2. Click any `View →` link — should render the read-only profile, still no login prompt.
3. Click any `Edit ↗` link — should navigate to the HTTPS funnel URL, prompt for Basic Auth, then render the editor. Mic button should work (no "navigator.mediaDevices.getUserMedia" error).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(home): public HTTP landing with course list + View / Edit per course

Replaces the slug-gated faculty hub at \"/\" with a true public
landing — no slug, no Basic Auth, reachable by anyone on the LAN.

Each course gets two links:
- View → /view/[code]  (HTTP, public, read-only)
- Edit → https://<funnel>/capture/[code]?slug=...  (HTTPS, Basic Auth)

The slug is baked into Edit links server-side from PROTOTYPE_SLUG so
faculty don't need to know or type it. Faculty hub link in the header
goes to the HTTPS funnel for the existing /courses index.

The previous slug-gated home moves to the HTTPS funnel automatically
since /courses already served that role — no separate /home route
needed."
```

---

## Task 8: Update STATE.md + retire the prior plan

**Files:**
- Modify: `docs/STATE.md`
- Modify: `docs/superpowers/plans/2026-06-03-microphone-bridge-via-tailscale.md` (add superseded note at top)

- [ ] **Step 1: Add a superseded banner to the prior microphone-bridge plan**

Open `docs/superpowers/plans/2026-06-03-microphone-bridge-via-tailscale.md`. Add the following block immediately after the H1 title (before any other content):

```markdown
> **Status (2026-06-03):** SUPERSEDED by
> [`2026-06-03-hybrid-http-https-mic-architecture.md`](./2026-06-03-hybrid-http-https-mic-architecture.md).
> The iframe-bridge approach this plan implemented turned out to be
> spec-broken: per W3C Secure Contexts, an HTTPS iframe inside an HTTP
> parent is NOT a secure context, so `navigator.mediaDevices` was
> `undefined` and mic didn't work. The replacement architecture moves
> faculty surfaces to top-level HTTPS via the Tailscale Funnel (Basic
> Auth gates them) while keeping a public HTTP landing + read-only
> profile views on the LAN IP.
```

Don't edit anything else in the file — it remains the historical record of the attempted approach.

- [ ] **Step 2: Update STATE.md "What's live" entries**

Open `docs/STATE.md`. The "Microphone bridge via Tailscale Funnel" entry in the Cross-cutting table (around line 52) is now historical. Replace it with:

```markdown
| **Public landing + read-only profile views; whole faculty app on HTTPS funnel** (2026-06-03) | Replaces the spec-broken iframe-bridge for mic. Public HTTP landing at `/` lists every course with View (HTTP, public, read-only `/view/[code]`) and Edit (HTTPS funnel, Basic Auth `/capture/[code]?slug=…`) buttons. Whole faculty app is now reachable via the Tailscale Funnel; Basic Auth in middleware gates everything except `/`, `/view/*`, `/partners/*`, `/preview/*`. Mic works natively because each faculty page is a top-level HTTPS secure context (no iframe). Faculty bookmark the LAN landing; one Basic Auth prompt per browser session when first clicking Edit. Removed: `components/VoiceBridgeProxy.tsx`, `app/voice-bridge/*`, `app/api/voice-session/*`, `lib/voice-session/*`, `lib/rate-limit/slug-rate-limit.ts`. Simplified: `app/api/transcribe/route.ts` (Basic Auth handles auth now), `next.config.ts` (no Permissions-Policy delegation), `lib/auth/basic-auth.ts` (PUBLIC_PREFIXES shuffled). Plan: [`2026-06-03-hybrid-http-https-mic-architecture.md`](./superpowers/plans/2026-06-03-hybrid-http-https-mic-architecture.md). Supersedes [`2026-06-03-microphone-bridge-via-tailscale.md`](./superpowers/plans/2026-06-03-microphone-bridge-via-tailscale.md). | live | 2026-06-03 |
```

Also update the "Last verified" line at the top of STATE.md:

```markdown
> **Last verified:** `<latest-commit-sha>` · 2026-06-03
```

Use the actual commit SHA from `git rev-parse HEAD` after the Task 8 commit.

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md docs/superpowers/plans/2026-06-03-microphone-bridge-via-tailscale.md
git commit -m "docs(state): document the hybrid HTTP/HTTPS architecture; supersede iframe-bridge plan"
```

---

## Self-review checklist

- ✅ Spec coverage: every architectural decision in the design doc has a task — funnel scope (Task 1), consumer swap (Task 2), file deletion (Task 3), transcribe simplification (Task 4), auth allowlist (Task 5), public read-only view (Task 6), public landing (Task 7), state documentation (Task 8).
- ✅ No placeholders — every step has the actual code or commands.
- ✅ Type consistency — `VoiceRecorder`, `VoiceBridgeProxy`, `PUBLIC_PREFIXES`, `requiresBasicAuth`, `transcribeAudio`, `listCoursesWithStatus`, `ReadOnlyProfile` are spelled identically everywhere they appear across tasks.
- ✅ Task ordering: tasks are sequenced so the codebase typechecks after every commit (consumers swap before file deletion; allowlist update before new public routes go live).
- ✅ Each commit is independently revertable — if any task ships and we find an issue, we can `git revert` that single commit without unwinding others.

---

## What this plan deliberately doesn't do

- **No client-side cert install (Option B / mkcert).** Reserved for a future deployment-planning phase if/when "feels LAN-only" matters more than "ships today."
- **No short-term token bridge (Variant 2 of the brainstorm).** Faculty will see one Basic Auth prompt per browser session when first clicking Edit. The 5-second cost doesn't justify the ~150-line token-handshake implementation right now; revisit if faculty complain.
- **No per-user faculty auth.** Basic Auth (shared credential) remains. Per-user auth (magic-link / Clemson SSO) is in `STATE.md → Deferred / debt` and is a separate project.
- **No auth-failure rate limiter on the funnel.** Worth doing as a follow-up (~30 min); deferred to keep this plan tight.
- **No tear-down of the `TAILSCALE_FUNNEL_ORIGIN` and `NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN` env vars.** They're still used by the new landing + view pages to build Edit links. The `NEXT_PUBLIC_` variant could now be deleted (it was only needed by the iframe proxy for cross-origin postMessage validation), but it's a no-op when unused — defer cleanup until next env-var audit.
