import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { listAvailableChatModels } from '@/lib/ai/list-models';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

// GET /api/settings/available-models?slug=...
// Returns the chat-completion-capable models available to the configured
// OpenAI API key, filtered to canonical short names (no date suffixes,
// no embeddings/audio/etc.) and sorted with newest/largest first.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  try {
    const result = await listAvailableChatModels();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'failed to list models', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
