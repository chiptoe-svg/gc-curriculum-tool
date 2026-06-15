import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getMessageById } from '@/lib/db/capture-messages-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string; messageId: string }> }

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const { code: rawCode, messageId } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const msg = await getMessageById(courseCode, messageId);
  if (!msg) return NextResponse.json({ error: 'message not found' }, { status: 404 });

  // Assistant messages store JSON {finding, question, citations, readiness}.
  // Surface the prose form for the drawer rather than the raw JSON.
  let prose = msg.content ?? '';
  if (msg.role === 'assistant' && prose.startsWith('{')) {
    try {
      const parsed = JSON.parse(prose) as { finding?: string; question?: string };
      prose = [parsed.finding, parsed.question].filter(Boolean).join('\n\n');
    } catch { /* keep raw */ }
  }

  return NextResponse.json({
    id: msg.id,
    role: msg.role,
    turnIndex: msg.turnIndex,
    content: prose,
  });
}
