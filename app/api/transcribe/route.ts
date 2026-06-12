import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { authorizedForBasicAuth } from '@/lib/auth/basic-auth';
import { transcribeAudio, isSupportedAudioMime, estimateWhisperCostCents } from '@/lib/ai/transcribe';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
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
  // Top-level catch: the 2026-06-12 walkthrough hit a Next-level
  // "Response body object should not be disturbed or locked" TypeError that
  // escaped every inner catch and 500'd with NO log line. Everything below
  // runs inside this so a failure always leaves a diagnosable trace.
  try {
    return await handleTranscribe(req);
  } catch (e) {
    console.error(
      `[/api/transcribe] ${new Date().toISOString()} UNHANDLED:`,
      e instanceof Error ? `${e.name}: ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}` : e,
    );
    return NextResponse.json({ error: 'transcription failed (unhandled)' }, { status: 500 });
  }
}

async function handleTranscribe(req: Request): Promise<Response> {
  // Basic Auth enforced HERE because this route is excluded from the
  // middleware matcher (see middleware.ts — the Node-middleware body
  // buffering broke multipart uploads). Same gate, same env var, same
  // no-op-when-unset semantics as the middleware.
  const expectedAuth = process.env.FACULTY_BASIC_AUTH;
  if (expectedAuth && !authorizedForBasicAuth(req.headers.get('authorization'), expectedAuth)) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="GC Curriculum Tool"' },
    });
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });

  // Daily cost cap — transcription can hit the paid OpenAI Whisper backend
  // (WHISPER_BACKEND=openai, or the local-binary-missing fallback), which was
  // previously invisible to the cap. Gate before spending.
  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    // Aborted/locked request bodies land here (e.g. a recorder upload cut
    // mid-flight then retried). Log the real reason — "expected multipart"
    // alone hid the 2026-06-12 disturbed-body failure mode.
    console.warn(
      `[/api/transcribe] ${new Date().toISOString()} formData() failed:`,
      e instanceof Error ? `${e.name}: ${e.message}` : e,
    );
    return NextResponse.json({ error: 'could not read the upload — please retry' }, { status: 400 });
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
    // Record spend only for the paid path so the daily ledger stays accurate.
    if (result.backend === 'openai') {
      await recordSpend(estimateWhisperCostCents(audio.size));
    }
    return NextResponse.json({ text: result.text, model: result.model });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'transcription failed';
    console.error(`[/api/transcribe] ${new Date().toISOString()} failed (${mime}, ${audio.size}B):`, message);
    return NextResponse.json({ error: 'transcription failed' }, { status: 500 });
  }
}
