import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { ChatMessage } from '@/lib/ai/analyze/capture-chat';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';
import { runAuditAgent } from '@/lib/ai/agent/audit-agent';
import { streamAuditAgent } from '@/lib/ai/agent/audit-agent-stream';
import { startNewSession } from '@/lib/db/capture-messages-queries';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/capture/[code]/chat?slug=...
// Body: { messages: ChatMessage[] }
// Returns: { reply: string }
//
// Stateless multi-turn chat. The full conversation history is provided on
// each request; we re-load the course context server-side every time so the
// caller doesn't have to round-trip large blobs.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  // Daily-cap gate (the cost ceiling). NOTE: per-turn spend is NOT yet recorded
  // for this streaming route — cost isn't forwarded through streamAuditAgent /
  // runAuditAgent yet (tracked in STATE.md Deferred/debt).
  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
  }

  const history: ChatMessage[] = (body.messages as unknown[])
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        typeof m === 'object' &&
        m !== null &&
        ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string',
    )
    .map(m => ({ role: m.role, content: m.content }));

  // Synthesize the per-turn audit reply from the v2 agent loop. (v1 capture-chat
  // path retired 2026-06-11; v2 is the only path.)
  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId.length > 0
      ? body.sessionId
      : startNewSession();

  // No user message = opening turn; runAuditAgent handles that by
  // self-introducing from at-rest context (no fake user row written).
  const lastUserMessage = history.filter(m => m.role === 'user').slice(-1)[0]?.content;

  // Instructor identity for this session — stamped on every message by the
  // agent so snapshots inherit it. Optional for back-compat with sessions that
  // started before the chooser UI shipped.
  const instructorName =
    typeof body.instructorName === 'string' && body.instructorName.length > 0
      ? body.instructorName
      : null;

  // When true, the agent's at-rest context skips the "prior sessions" block —
  // fresh-start capture for a new instructor who shouldn't be anchored on
  // prior instructors' findings.
  const includePriorSessions = body.includePriorSessions !== false;

  const wantsStream =
    url.searchParams.get('stream') === '1' ||
    (req.headers.get('accept') ?? '').includes('text/event-stream');

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const gen = streamAuditAgent({
            sessionId,
            courseCode,
            ...(lastUserMessage ? { userMessage: lastUserMessage } : {}),
            auditMode: course.auditMode as 'full' | 'simple',
            instructorName,
            includePriorSessions,
          });
          for await (const ev of gen) {
            controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(JSON.stringify({ kind: 'error', message }) + '\n'));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  }

  try {
    const { response, toolCallsUsed } = await runAuditAgent({
      sessionId,
      courseCode,
      ...(lastUserMessage ? { userMessage: lastUserMessage } : {}),
      auditMode: course.auditMode as 'full' | 'simple',
      instructorName,
      includePriorSessions,
    });
    return NextResponse.json({
      sessionId,
      reply: response.finding + '\n\n' + response.question,
      finding: response.finding,
      question: response.question,
      citations: response.citations,
      readiness: response.readiness,
      toolCallsUsed,
    });
  } catch (err) {
    console.error(`POST /api/capture/${courseCode}/chat failed`, err);
    return NextResponse.json({ error: 'agent loop failed' }, { status: 500 });
  }
}
