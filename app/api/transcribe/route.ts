import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { transcribeAudio, isSupportedAudioMime } from '@/lib/ai/transcribe';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkSlugRateLimit } from '@/lib/rate-limit/slug-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { validateVoiceToken } from '@/lib/voice-session/store';

// 5 MB ≈ 5 minutes of webm/opus voice at typical browser settings. Tuned
// to keep Whisper round-trip latency under a few seconds. Bump if longer
// recordings turn out to be useful.
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

// POST /api/transcribe?slug=...
// Headers: X-Voice-Token (issued by /api/voice-session)
// Body: multipart/form-data with field `audio` (the recording blob).
// Returns: { text: string }
//
// This endpoint is publicly reachable via the Tailscale Funnel so the
// voice-bridge iframe (HTTPS, mic-permitted) can hit it. Defense layers:
//   1. Slug gate (existing).
//   2. Voice-session token bound to slug+ipHash (issued from the LAN HTTP
//      main app, so an attacker without LAN access can't get one).
//   3. Origin pinning — the Origin header must match TAILSCALE_FUNNEL_ORIGIN.
//      Calls from `*` (curl/fetch with no Origin) and from other domains are
//      rejected.
//   4. Per-IP rate limit (existing) + per-slug rate limit (new, 30/hr).
//   5. Daily cost cap (existing AI-cost interlock).
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  // Voice-session token validation. Token issuance is LAN-gated; here we
  // require its presence + binding to this slug + ipHash on every call.
  const ipHash = hashIp(req);
  const token = req.headers.get('x-voice-token') ?? '';
  if (!token || !validateVoiceToken(token, slug, ipHash)) {
    return NextResponse.json({ error: 'invalid or missing voice-session token' }, { status: 401 });
  }

  // Origin pinning. Requests from anywhere other than the configured
  // Tailscale Funnel are refused. Production calls always carry the
  // Funnel origin in the Origin header (set by the browser when the
  // iframe at that origin makes a request).
  const expectedOrigin = process.env.TAILSCALE_FUNNEL_ORIGIN;
  if (expectedOrigin) {
    const origin = req.headers.get('origin') ?? '';
    if (origin !== expectedOrigin) {
      return NextResponse.json({ error: 'origin not permitted' }, { status: 403 });
    }
  }

  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });

  if (!checkSlugRateLimit(slug)) {
    return NextResponse.json({ error: 'rate limit exceeded (slug)' }, { status: 429 });
  }

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
  const mimeType = audio.type || 'audio/webm';
  if (!isSupportedAudioMime(mimeType)) {
    return NextResponse.json({ error: `unsupported audio type: ${mimeType}` }, { status: 415 });
  }

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const { text } = await transcribeAudio(buffer, mimeType);
    return NextResponse.json({ text });
  } catch (err) {
    console.error('POST /api/transcribe failed', err);
    return NextResponse.json({ error: 'transcription failed' }, { status: 500 });
  }
}
