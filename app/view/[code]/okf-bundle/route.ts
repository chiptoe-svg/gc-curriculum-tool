import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getSessionMessages } from '@/lib/db/capture-messages-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { redactPiiDeep } from '@/lib/capture/redact-pii';
import { isProgramVisible } from '@/lib/courses/program-visibility';
import { isCourseReadableBy } from '@/lib/sandbox/access';
import { buildOkfBundle } from '@/lib/okf/bundle';

interface RouteContext { params: Promise<{ code: string }>; }

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);

  const course = await getCourseByCode(code);
  // Opaque 404 for non-gc/non-offered, identical to /view/[code]/okf - a sandbox
  // course's bundle is reachable only via the scoped link (external-access plan).
  if (!course || !(await isCourseReadableBy(req, course, new URL(req.url).searchParams.get('slug') ?? undefined))) {
    return new Response(`No such course: ${code}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const snapshot = await getLatestSnapshotByCourse(code);
  if (!snapshot) {
    return new Response(`No captured profile for ${code}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const origin = new URL(req.url).origin;
  const viewUrl = `${origin}/view/${encodeURIComponent(code)}`;

  const rawMessages = snapshot.transcriptSessionId
    ? await getSessionMessages(code, snapshot.transcriptSessionId)
    : [];
  const transcriptMessages = redactPiiDeep(
    rawMessages.map(m => ({ role: m.role, content: m.content ?? '' })),
  );

  const materials = await listMaterialsByCourse(code);

  const zip = await buildOkfBundle({
    course: {
      code: course.code, title: course.title, prefix: course.prefix,
      level: course.level, track: course.track,
      buildsToCareer: course.buildsToCareer, catalogUrl: course.catalogUrl,
    },
    profile: redactPiiDeep(snapshot.profile),
    snapshot: { id: snapshot.id, createdAt: snapshot.createdAt, instructorName: snapshot.instructorName },
    viewUrl,
    transcriptMessages,
    materials: materials.map(m => ({
      fileName: m.fileName, extractedText: m.extractedText ?? null,
      ignored: m.ignored, mimeType: m.mimeType, uploadedAt: m.uploadedAt,
    })),
  });

  const filename = `${code.toLowerCase().replace(/\s+/g, '-')}-okf-bundle.zip`;
  return new Response(new Uint8Array(zip), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
