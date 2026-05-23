import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import {
  getCaptureConversation,
  upsertCaptureConversation,
  deleteCaptureConversation,
  type ChatMessage,
} from '@/lib/db/capture-conversations-queries';
import { captureReadinessSchema, type CaptureReadiness } from '@/lib/ai/capture/schema';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// Slug check + course existence in one place.
async function authAndCourse(req: Request, codeParam: string): Promise<{ ok: true; courseCode: string } | { ok: false; res: Response }> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return { ok: false, res: NextResponse.json({ error: 'invalid slug' }, { status: 401 }) };
  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return { ok: false, res: NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 }) };
  const courseCode = decodeURIComponent(codeParam);
  const course = await getCourseByCode(courseCode);
  if (!course) return { ok: false, res: NextResponse.json({ error: 'course not found' }, { status: 404 }) };
  return { ok: true, courseCode };
}

// GET /api/capture/[code]/conversation?slug=...
// Returns the saved conversation (messages + last readiness) for the course,
// or { messages: [], readiness: null } if none.
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const gate = await authAndCourse(req, rawCode);
  if (!gate.ok) return gate.res;

  const conv = await getCaptureConversation(gate.courseCode);
  if (!conv) return NextResponse.json({ messages: [], readiness: null, updatedAt: null });
  return NextResponse.json({
    messages: conv.messages,
    readiness: conv.readiness,
    updatedAt: conv.updatedAt,
  });
}

// PUT /api/capture/[code]/conversation?slug=...
// Body: { messages: ChatMessage[], readiness: CaptureReadiness | null }
// Replaces the saved conversation in full.
export async function PUT(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const gate = await authAndCourse(req, rawCode);
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
  }
  const messages: ChatMessage[] = (body.messages as unknown[])
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        typeof m === 'object' &&
        m !== null &&
        ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string',
    )
    .map(m => ({ role: m.role, content: m.content }));

  let readiness: CaptureReadiness | null = null;
  if (body.readiness !== undefined && body.readiness !== null) {
    const parsed = captureReadinessSchema.safeParse(body.readiness);
    if (parsed.success) readiness = parsed.data;
  }

  await upsertCaptureConversation({ courseCode: gate.courseCode, messages, readiness });
  return NextResponse.json({ ok: true });
}

// DELETE /api/capture/[code]/conversation?slug=...
// Clears the saved conversation. Used after a successful Generate or by
// a manual "clear conversation" action.
export async function DELETE(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const gate = await authAndCourse(req, rawCode);
  if (!gate.ok) return gate.res;

  const deleted = await deleteCaptureConversation(gate.courseCode);
  return NextResponse.json({ ok: true, deleted });
}
