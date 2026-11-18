import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { createWhatIf, listWhatIfsForCourse } from '@/lib/db/what-if-queries';
import { ownerOf } from '@/lib/what-if/ownership';

interface Ctx { params: Promise<{ code: string }> }

const NAME_MAX = 120;

/**
 * POST /api/explore/[code]/what-ifs
 * Body: { authorName?: string } (read only for a login that names nobody).
 * Starts a what-if on the course's latest approved version. → 201 { id }
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  let body: { authorName?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch { /* a missing or malformed body counts as empty */ }

  const authorName = personalName(auth.grant)
    ?? (typeof body.authorName === 'string' ? body.authorName.trim().slice(0, NAME_MAX) : '');
  if (!authorName) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });

  if (!(await getCourseByCode(courseCode))) return NextResponse.json({ error: 'course not found' }, { status: 404 });
  const snapshot = await getLatestSnapshotByCourse(courseCode);
  if (!snapshot) return NextResponse.json({ error: 'This course has no approved version yet.' }, { status: 409 });

  const whatIf = await createWhatIf({ courseCode, baseSnapshotId: snapshot.id, authorName, ...ownerOf(auth.grant) });
  return NextResponse.json({ id: whatIf.id }, { status: 201 });
}

/**
 * GET /api/explore/[code]/what-ifs
 * Every what-if with a page, plus the caller's own unfinished ones (an admin
 * does not see other people's unfinished what-ifs here).
 */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await getCourseByCode(courseCode))) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const me = ownerOf(auth.grant);
  const rows = await listWhatIfsForCourse(courseCode);
  const whatIfs = rows
    .map((w) => ({
      id: w.id,
      title: w.title,
      authorName: w.authorName,
      summary: w.summary,
      pageCreatedAt: w.pageCreatedAt,
      createdAt: w.createdAt,
      hasPage: w.pageCreatedAt !== null,
      skillsOnly: !!w.skills && !w.profile,
      mine: w.ownerKind === me.ownerKind && w.ownerGrantId === me.ownerGrantId,
    }))
    .filter((w) => w.hasPage || w.skillsOnly || w.mine);
  return NextResponse.json({ whatIfs });
}
