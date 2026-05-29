import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { createFeedbackIssue } from '@/lib/feedback/github';

const COURSE_CODE_RE = /\/(?:capture|explore)\/(GC\s+\d{4}[a-z]{0,2})/i;

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
  const name = typeof body.name === 'string' && body.name.trim().length > 0
    ? body.name.trim().slice(0, 80)
    : null;
  const route = typeof body.route === 'string' ? body.route.slice(0, 200) : '(unknown)';

  if (feedback.length < 5) {
    return NextResponse.json({ error: 'feedback too short — please describe the issue or idea' }, { status: 400 });
  }
  if (feedback.length > 8000) {
    return NextResponse.json({ error: 'feedback too long — please keep under 8000 characters' }, { status: 400 });
  }

  let courseCode: string | null = null;
  try {
    const decoded = decodeURIComponent(route);
    const m = decoded.match(COURSE_CODE_RE);
    if (m && m[1]) courseCode = m[1].toUpperCase();
  } catch { /* keep null */ }

  const result = await createFeedbackIssue({
    name,
    feedback,
    route,
    courseCode,
    userAgent: req.headers.get('user-agent') ?? '(none)',
    capturedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    if (result.reason === 'not-configured') {
      return NextResponse.json(
        { error: 'feedback intake not configured on this deploy' },
        { status: 503 },
      );
    }
    console.error('feedback issue creation failed:', result.errorDetail);
    return NextResponse.json({ error: 'failed to file feedback' }, { status: 502 });
  }

  return NextResponse.json({ issueUrl: result.issueUrl, issueNumber: result.issueNumber });
}
