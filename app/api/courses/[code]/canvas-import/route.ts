import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { insertMaterial, updateExtractionResult } from '@/lib/db/course-materials-queries';
import { parseCanvasUrl } from '@/lib/canvas/parseCanvasUrl';
import { fetchCanvasCourse } from '@/lib/canvas/fetchCanvasCourse';
import { htmlToText } from '@/lib/canvas/htmlToText';

export const maxDuration = 60;

interface Ctx { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const canvasUrl = typeof body.canvasUrl === 'string' ? body.canvasUrl.trim() : '';
  const canvasToken = typeof body.canvasToken === 'string' ? body.canvasToken.trim() : '';
  if (!canvasUrl) return NextResponse.json({ error: 'canvasUrl is required' }, { status: 400 });
  if (!canvasToken) return NextResponse.json({ error: 'canvasToken is required' }, { status: 400 });

  const courseId = parseCanvasUrl(canvasUrl);
  if (!courseId) return NextResponse.json({ error: 'Could not parse a Canvas course ID from the URL. Expected format: https://clemson.instructure.com/courses/12345' }, { status: 400 });

  const course = await getCourseByCode(code);
  if (!course) return NextResponse.json({ error: `Course not found: ${code}` }, { status: 404 });

  let canvasBaseUrl: string;
  try {
    const parsed = new URL(canvasUrl);
    canvasBaseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    return NextResponse.json({ error: 'Invalid Canvas URL' }, { status: 400 });
  }

  let data: Awaited<ReturnType<typeof fetchCanvasCourse>>;
  try {
    data = await fetchCanvasCourse(canvasBaseUrl, courseId, canvasToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('401')) return NextResponse.json({ error: 'Canvas API token is invalid or expired. Generate a new token in Canvas → Profile → Settings → Approved Integrations.' }, { status: 422 });
    if (msg.includes('404')) return NextResponse.json({ error: 'Canvas course not found. Check the URL and make sure you have access to that course.' }, { status: 422 });
    return NextResponse.json({ error: `Canvas import failed: ${msg}` }, { status: 502 });
  }

  const ipHash = hashIp(req);
  const toInsert: Array<{ fileName: string; text: string }> = [];

  const syllabusText = htmlToText(data.course.syllabusHtml);
  if (syllabusText) toInsert.push({ fileName: 'Canvas: Syllabus', text: syllabusText });

  if (data.assignments.length > 0) {
    const parts = data.assignments.map(a => {
      const desc = htmlToText(a.descriptionHtml);
      return `## ${a.name}${a.pointsPossible != null ? ` (${a.pointsPossible} pts)` : ''}\n${desc}`;
    });
    const assignmentsText = parts.join('\n\n');
    if (assignmentsText.trim()) toInsert.push({ fileName: 'Canvas: Assignments', text: assignmentsText });
  }

  if (data.modules.length > 0) {
    const parts = data.modules.map(m => {
      const items = m.items.map(i => `  - ${i.title} (${i.type})`).join('\n');
      return `## ${m.name}\n${items}`;
    });
    const modulesText = parts.join('\n\n');
    if (modulesText.trim()) toInsert.push({ fileName: 'Canvas: Module List', text: modulesText });
  }

  const imported: Array<{ id: string; fileName: string }> = [];
  for (const { fileName, text } of toInsert) {
    const mat = await insertMaterial({
      courseCode: code,
      fileName,
      blobUrl: canvasUrl,
      mimeType: 'text/html',
      sizeBytes: text.length,
      ipHash,
    });
    await updateExtractionResult({
      id: mat.id,
      extractionStatus: 'ok',
      extractionMethod: 'text',
      extractedText: text,
    });
    imported.push({ id: mat.id, fileName });
  }

  const details = {
    syllabusFound: !!syllabusText,
    assignments: data.assignments.map(a => a.name),
    modules: data.modules.map(m => m.name),
  };

  return NextResponse.json({ imported: imported.length, materials: imported, details });
}
