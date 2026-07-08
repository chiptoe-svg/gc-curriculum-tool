import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { readWikiPage } from '@/lib/wiki/git-ops';
import { streamExploreAgent } from '@/lib/ai/explore/agent';
import type { Message } from '@/lib/ai/tool-use-types';

export const maxDuration = 120;

interface Ctx { params: Promise<{ code: string }> }

/**
 * POST /api/explore/[code]/chat?slug=...
 * Body: { messages: { role: 'user' | 'assistant'; content: string }[] }
 *
 * Streams explore-agent NDJSON events back. On the first turn, pre-loads
 * the focused course's wiki page as anchor context so the agent doesn't
 * have to call `read_wiki` for the obvious starting point. The agent is
 * fully program-aware — anchoring is a starting hint, not a fence.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
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

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

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

  // Pre-load the course's wiki page as anchor context. If the page doesn't
  // exist yet (course not yet audited / wiki not yet seeded), we still hand
  // off to the agent — it can call list_wiki / search_wiki to orient.
  const courseSlug = courseCode.toLowerCase().replace(/\s+/g, '-');
  const coursePagePath = `courses/${courseSlug}.md`;
  const coursePage = await readWikiPage(coursePagePath);
  const anchorContext = coursePage
    ? `The user is currently looking at the **${courseCode} — ${course.title}** wiki page (\`${coursePagePath}\`):\n\n${coursePage}`
    : `The user is currently looking at **${courseCode} — ${course.title}**, but no wiki page has been generated for this course yet (no captured snapshot). Use \`list_wiki\` or \`search_wiki\` to find related pages, and let the user know the course itself doesn't have a wiki entry.`;

  const stream = streamExploreAgent({ courseCode, anchorContext, messages });

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
