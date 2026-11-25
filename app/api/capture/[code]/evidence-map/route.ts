import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';
import { getSessionMessages, startNewSession } from '@/lib/db/capture-messages-queries';
import { createInterviewSession, getInterviewSession, claimPreRead, markEditedReady, saveEditedEvidenceMap, saveEvidenceMap } from '@/lib/db/capture-interview-sessions-queries';
import { runPreRead, materialsFingerprint, PRE_READ_STALE_MS } from '@/lib/capture/staged/pre-read';
import { EvidenceMapSchema } from '@/lib/capture/staged/evidence-map';
import { includedMaterialsOf } from '@/lib/ai/agent/audit-agent';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';

/** A pending read older than the timeout plus a minute died without saving. */
const readInFlight = (row: { mapStatus: string; mapStartedAt: Date | null }) =>
  row.mapStatus === 'pending' && !!row.mapStartedAt && Date.now() - new Date(row.mapStartedAt).getTime() <= PRE_READ_STALE_MS;

const MAX_BODY_BYTES = 256 * 1024;

interface RouteContext { params: Promise<{ code: string }> }

// Stage 0 of the staged interview: the pre-read evidence map.
//   POST {}                         -> creates a session, runs the pre-read, saves it: { sessionId, map, status }
//   GET  ?sessionId=                -> { sessionId, map, status }; re-runs the pre-read when the materials changed
//                                      before the interview started and the instructor has not edited the map
//   PUT  { sessionId, map }         -> saves the instructor's edited map
// All take ?slug= like the other /api/capture/[code]/* routes.

async function gate(req: Request, rawCode: string, opts: { cap: boolean }): Promise<{ ok: true; courseCode: string } | { ok: false; res: Response }> {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) return { ok: false, res: NextResponse.json({ error: 'invalid slug' }, { status: 401 }) };
  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return { ok: false, res: NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 }) };
  if (opts.cap) {
    const cap = await checkDailyCap();
    if (!cap.ok) return { ok: false, res: NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 }) };
  }
  if (!(await getCourseByCode(courseCode))) return { ok: false, res: NextResponse.json({ error: 'not found' }, { status: 404 }) };
  return { ok: true, courseCode };
}

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const g = await gate(req, (await params).code, { cap: true });
  if (!g.ok) return g.res;

  const sessionId = startNewSession();
  await createInterviewSession({ sessionId, courseCode: g.courseCode });
  // runPreRead never throws; a failed or empty read is saved as such and the session still starts.
  const r = await runPreRead(g.courseCode);
  await saveEvidenceMap(sessionId, r);
  return NextResponse.json({ sessionId, map: r.map, status: r.status });
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const g = await gate(req, (await params).code, { cap: false });
  if (!g.ok) return g.res;

  const sessionId = new URL(req.url).searchParams.get('sessionId') ?? '';
  const row = sessionId ? await getInterviewSession(sessionId) : null;
  if (!row || row.courseCode !== g.courseCode) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  // An edited row whose read died must not stay pending: the edit is final.
  if (row.mapEditedAt && row.mapStatus === 'pending' && !readInFlight(row)) {
    await markEditedReady(sessionId);
    return NextResponse.json({ sessionId, map: row.map, status: 'ready' });
  }

  // Read again when the materials changed before the interview started, or a read died (pending too long).
  // The claim is atomic, so polls and tabs during a read never start a second one; an edited map is never re-read.
  if (!row.mapEditedAt) {
    const turns = await getSessionMessages(g.courseCode, sessionId);
    if (!turns.some(m => m.role === 'assistant')) {
      const included = includedMaterialsOf(await listMaterialsByCourse(g.courseCode));
      const current = included.length ? materialsFingerprint(included) : null;
      const stalePending = row.mapStatus === 'pending' && (!row.mapStartedAt || Date.now() - new Date(row.mapStartedAt).getTime() > PRE_READ_STALE_MS);
      // A failed read is retried only when the materials changed since it; with no stored fingerprint it waits for a new POST.
      const changed = row.mapStatus === 'failed'
        ? row.materialsFingerprint !== null && current !== null && current !== row.materialsFingerprint
        : row.mapStatus !== 'pending' && current !== row.materialsFingerprint;
      if ((stalePending || changed) && (await checkDailyCap()).ok && (await claimPreRead(sessionId))) {
        const r = await runPreRead(g.courseCode);
        await saveEvidenceMap(sessionId, r);
        const fresh = await getInterviewSession(sessionId);
        return NextResponse.json({ sessionId, map: fresh?.map ?? r.map, status: fresh?.mapStatus ?? r.status });
      }
    }
  }
  return NextResponse.json({ sessionId, map: row.map, status: row.mapStatus });
}

export async function PUT(req: Request, { params }: RouteContext): Promise<Response> {
  const g = await gate(req, (await params).code, { cap: false });
  if (!g.ok) return g.res;

  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return NextResponse.json({ error: 'request too large' }, { status: 413 });
  let body: { sessionId?: unknown; map?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { /* 400 below */ }
  if (!body || typeof body.sessionId !== 'string' || !body.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  const parsed = EvidenceMapSchema.safeParse(body.map);
  if (!parsed.success) return NextResponse.json({ error: 'invalid map', issues: parsed.error.issues.slice(0, 5) }, { status: 400 });

  const row = await getInterviewSession(body.sessionId);
  if (!row || row.courseCode !== g.courseCode) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  await saveEditedEvidenceMap(body.sessionId, parsed.data);
  // A read still in flight settles the status when it saves; otherwise nothing will, so do it now.
  let status = row.mapStatus;
  if (!readInFlight(row)) { await markEditedReady(body.sessionId); status = 'ready'; }
  return NextResponse.json({ sessionId: body.sessionId, map: parsed.data, status });
}
