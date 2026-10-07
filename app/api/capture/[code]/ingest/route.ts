import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';
import { resolveCourseCodeCaseInsensitive } from '@/lib/db/courses-queries';
import { checkIngestCooldown, recordIngestStart } from '@/lib/capture/ingest-cooldown';
import { runCourseIngest, type IngestMode } from '@/lib/capture/run-course-ingest';

interface RouteContext { params: Promise<{ code: string }> }

/**
 * POST /api/capture/[code]/ingest?slug=...
 * Body: { mode?: 'hybrid' | 'local' }
 *
 * Course-scoped twin of POST /api/admin/v2-backfill — same underlying work
 * (lib/capture/run-course-ingest.ts), but classified 'course-write' by
 * lib/auth/authorize.ts so a scoped access-link holder (capture capability,
 * scope = this course) can trigger it, not just an admin/operator credential.
 *
 * The course code comes from the PATH, resolved against the DB
 * case-insensitively (G2, security re-review 2026-10-07) via
 * resolveCourseCodeCaseInsensitive and then used in its STORED spelling
 * everywhere — so `GC%201010l` acts on the DB's actual `GC 1010L` row.
 * This REPLACES blindly lower-casing the suffix (canonicalizeCourseCode,
 * F4), which broke any live course with an upper-case-suffix code: the
 * guessed form matched no row, so ingest 404'd a real course. If no course
 * matches at all, this route 404s before doing anything else — a body
 * `courseCode` that disagrees (matched case-insensitively against the
 * resolved code, not a second DB lookup) is rejected rather than silently
 * followed.
 *
 * Cost backstops added in the same review (F2): a 60s per-course cooldown
 * (lib/capture/ingest-cooldown.ts, keyed by the resolved/stored code)
 * refuses a repeat call on the same course before it starts; the daily
 * cost cap (lib/rate-limit/daily-cap.ts, same check /api/transcribe uses)
 * refuses queueing anything once the day's spend is over the cap. Both run
 * AFTER body validation so a malformed request never consumes either
 * check — and the cooldown is recorded only once every other check has
 * passed, right before the call that actually starts work.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const { code: rawCode } = await params;
  const pathCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, pathCode, slug))) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const courseCode = await resolveCourseCodeCaseInsensitive(pathCode);
  if (!courseCode) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { courseCode?: unknown; mode?: unknown };
  if (typeof body.courseCode === 'string' && body.courseCode.trim()) {
    if (body.courseCode.trim().toLowerCase() !== courseCode.toLowerCase()) {
      return NextResponse.json({ error: 'courseCode does not match the path' }, { status: 400 });
    }
  }
  const mode: IngestMode = body.mode === undefined ? 'hybrid' : (body.mode as IngestMode);
  if (mode !== 'hybrid' && mode !== 'local') {
    return NextResponse.json({ error: "mode must be 'hybrid' or 'local'" }, { status: 400 });
  }

  const cooldown = checkIngestCooldown(courseCode);
  if (!cooldown.allowed) {
    // H1 (security re-review #3, 2026-10-07): a distinct body — `reason:
    // 'cooldown'` — so the client can tell this apart from the generic
    // IP-rate-limit 429 below and poll instead of showing a raw error.
    return NextResponse.json(
      {
        error: `Reading already started a moment ago — try again in ${cooldown.retryAfterSeconds} seconds`,
        reason: 'cooldown',
        retryAfter: cooldown.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 503 });

  recordIngestStart(courseCode);

  const result = await runCourseIngest(courseCode, { mode });
  if (!result) return NextResponse.json({ error: 'course not found' }, { status: 404 });
  return NextResponse.json(result);
}
