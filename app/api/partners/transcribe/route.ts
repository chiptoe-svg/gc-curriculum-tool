import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { transcribeAudio, isSupportedAudioMime } from '@/lib/ai/transcribe';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
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
  if (!partner) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

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
    console.error('[/api/partners/transcribe] failed:', message);
    return NextResponse.json({ error: 'transcription failed' }, { status: 500 });
  }
}
