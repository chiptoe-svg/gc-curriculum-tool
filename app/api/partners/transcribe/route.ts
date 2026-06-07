import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { transcribeAudio, isSupportedAudioMime, estimateWhisperCostCents } from '@/lib/ai/transcribe';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

// POST /api/partners/transcribe?token=<magic>
//
// Partner-side voice transcription. Lives under /api/partners so the
// Basic Auth middleware doesn't gate it (partners never authenticate
// via Basic Auth — they bear a magic-link token). The token is the
// auth credential; we look it up via findPartnerByToken before
// accepting the audio. Per-IP rate limit remains as a backstop.
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 401 });

  const partner = await findPartnerByToken(token);
  // Reject revoked (inactive) partners — matches every other partner route and
  // the "inactive partners always resolve to null" revocation invariant. A
  // revoked magic link must not be able to spend transcription budget.
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });

  // Daily cost cap. This route is internet-facing (magic-link, not Basic Auth)
  // and on a host without the local Whisper binary it ALWAYS takes the paid
  // OpenAI path — so the cap matters most here.
  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 503 });

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
    if (result.backend === 'openai') {
      await recordSpend(estimateWhisperCostCents(audio.size));
    }
    return NextResponse.json({ text: result.text, model: result.model });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'transcription failed';
    console.error('[/api/partners/transcribe] failed:', message);
    return NextResponse.json({ error: 'transcription failed' }, { status: 500 });
  }
}
