import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { issueVoiceToken } from '@/lib/voice-session/store';

/**
 * POST /api/voice-session?slug=...
 *
 * Issues a fresh voice-session token bound to (slug, ipHash). Token TTL
 * is 24 hours. Returned token is included in the X-Voice-Token header
 * on every subsequent /api/transcribe call from the voice-bridge iframe.
 *
 * Called from the main app (LAN HTTP) when faculty clicks the mic
 * button for the first time on a page. The token then flows via
 * postMessage to the HTTPS iframe and is reused for the lifetime of the
 * page session.
 */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const token = issueVoiceToken(slug, ipHash);
  return NextResponse.json({
    token,
    ttlSeconds: 24 * 60 * 60,
  });
}
