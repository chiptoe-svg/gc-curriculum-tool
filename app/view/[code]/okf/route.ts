import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { redactPiiDeep } from '@/lib/capture/redact-pii';
import { profileToOkfMarkdown } from '@/lib/okf/profile-to-okf';

interface RouteContext { params: Promise<{ code: string }>; }

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);

  const course = await getCourseByCode(code);
  if (!course) {
    return new Response(`No such course: ${code}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const snapshot = await getLatestSnapshotByCourse(code);
  if (!snapshot) {
    return new Response(`No captured profile for ${code}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const origin = new URL(req.url).origin;
  const md = profileToOkfMarkdown({
    course: {
      code: course.code, title: course.title,
      prefix: course.prefix, level: course.level, track: course.track,
      buildsToCareer: course.buildsToCareer, catalogUrl: course.catalogUrl,
    },
    profile: redactPiiDeep(snapshot.profile),
    snapshot: { id: snapshot.id, createdAt: snapshot.createdAt, instructorName: snapshot.instructorName },
    viewUrl: `${origin}/view/${encodeURIComponent(code)}`,
  });

  const filename = `${code.toLowerCase().replace(/\s+/g, '-')}.md`;
  return new Response(md, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
