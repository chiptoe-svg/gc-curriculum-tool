import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { readWikiPage } from '@/lib/wiki/git-ops';
import { streamCurriculumChat } from '@/lib/ai/wiki/chat';
import type { Message } from '@/lib/ai/tool-use-types';

export const maxDuration = 120;

/**
 * POST /api/ask/chat?slug=...
 * Body: { messages: { role: 'user' | 'assistant'; content: string }[] }
 *
 * Standalone curriculum chat — no course anchor. Pre-loads the wiki's
 * top-level `index.md` as orientation context if present; otherwise the
 * agent has to call `list_wiki` / `search_wiki` first. Mirror of
 * /api/explore/[code]/chat but without the course-scoped pre-load.
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

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 });
  }
  const messages: Message[] = (body.messages as unknown[])
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        typeof m === 'object' &&
        m !== null &&
        ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string',
    )
    .map(m => ({ role: m.role, content: m.content }));
  if (messages.length === 0 || messages[messages.length - 1]!.role !== 'user') {
    return NextResponse.json({ error: 'last message must be from the user' }, { status: 400 });
  }

  // Pre-load index.md as orientation context. The agent can still navigate
  // freely; this just saves it one obvious `read_wiki({path:'index.md'})`
  // call on most program-level questions.
  const indexPage = await readWikiPage('index.md');
  const anchorContext = indexPage
    ? `The user is asking about the GC curriculum at the program level — no specific course context. For orientation, here is the wiki's top-level index page (\`index.md\`):\n\n${indexPage}`
    : undefined;

  const stream = streamCurriculumChat({ ...(anchorContext ? { anchorContext } : {}), messages });

  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ kind: 'error', message: err instanceof Error ? err.message : String(err) }) + '\n',
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body$, {
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
