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
// Slug-gated and rate-limited like every other AI endpoint. Audio bytes are
// streamed straight into Whisper; nothing is stored.
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

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
