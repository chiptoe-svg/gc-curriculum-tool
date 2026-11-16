import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { db } from '@/lib/db/client';
import { courses, planSyllabusDrafts } from '@/lib/db/schema';
import { getPlan } from '@/lib/db/curriculum-plan-queries';
import { getExtractorFor } from '@/lib/courses/material-extractor';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import {
  SYLLABUS_TEXT_MAX, SYLLABUS_TEXT_MIN, draftSyllabus, normalizeCourseCode, prereqLinks, syllabusModel, toCourseEdits,
} from '@/lib/builder/syllabus-draft';
import type { PlanState } from '@/lib/builder/types';

interface Ctx { params: Promise<{ id: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEW_REF = /^new:[a-z0-9]{1,40}$/i;
const FILE_MAX = 20 * 1024 * 1024;
const TYPES: Record<string, 'extract' | 'text'> = {
  'application/pdf': 'extract',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'extract',
  'text/plain': 'text',
};
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const field = (f: FormData, k: string, max: number) => { const v = f.get(k); return typeof v === 'string' ? v.trim().slice(0, max) : ''; };

/**
 * POST /api/build/plans/[id]/syllabus (multipart): draft a course on this plan from its syllabus (spec §4b).
 * Fields: courseRef (a tracked course code or a proposed `new:` id), code and title (used for a course not tracked),
 * and either `file` (PDF, Word or plain text) or `text` (pasted, at least 300 characters), optional authorName.
 * A free campus model drafts it; the draft and the text are kept in plan_syllabus_drafts. The plan itself is not
 * changed here: the client merges the returned edits and links and saves.
 * → 200 { draftId, fileName, at, edits, links } | 400 | 404 | 502 (the campus model failed) | 503 (not configured)
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return bad('not found', 404);
  const cfg = syllabusModel();
  if (!cfg) return bad('Importing from a syllabus needs the campus model, which is not set up on this server.', 503);

  let form: FormData;
  try { form = await req.formData(); } catch { return bad('Send the syllabus as a file or pasted text.'); }
  const courseRef = field(form, 'courseRef', 80);
  if (!courseRef || (!NEW_REF.test(courseRef) && !normalizeCourseCode(courseRef))) return bad('Pick the course the syllabus is for.');

  const plan = await getPlan(id);
  if (!plan) return bad('not found', 404);
  const state = (plan.state ?? {}) as Partial<PlanState>;

  // The course: a tracked course by its code, else the code and title the dialog gives.
  let course = { code: field(form, 'code', 40), title: field(form, 'title', 160) };
  if (!NEW_REF.test(courseRef)) {
    const [row] = await db.select({ code: courses.code, title: courses.title }).from(courses).where(eq(courses.code, courseRef));
    if (!row) return bad('That course is not in the tool.', 404);
    course = row;
  }
  if (!course.code || !course.title) return bad('A new course needs a code and a title.');

  // The text: an uploaded file (read with the materials extractor) or pasted text.
  let text = '';
  let fileName = 'Pasted text';
  const file = form.get('file');
  if (file && typeof file !== 'string' && file.size > 0) {
    fileName = (file.name || 'syllabus').slice(0, 200);
    // Browsers may add a charset, or send no type at all for a .txt or .docx; fall back to the extension.
    const ext = /\.([a-z]+)$/i.exec(fileName)?.[1]?.toLowerCase();
    const mime = file.type.split(';')[0]!.trim() || (ext === 'pdf' ? 'application/pdf' : ext === 'txt' ? 'text/plain'
      : ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '');
    const kind = TYPES[mime];
    if (!kind) return bad('Upload a PDF, a Word (.docx) file or a plain text file.');
    if (file.size > FILE_MAX) return bad('The file is larger than 20 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    try {
      text = kind === 'text' ? bytes.toString('utf-8')
        : (await getExtractorFor(mime).extract({ fileBytes: bytes, mimeType: mime, fileName })).text;
    } catch (err) {
      console.warn('[syllabus] extraction failed:', err instanceof Error ? err.message : err);
      return bad('The file could not be read. Try a different copy, or paste the text instead.', 422);
    }
  } else {
    text = typeof form.get('text') === 'string' ? (form.get('text') as string) : '';
  }
  text = text.trim().slice(0, SYLLABUS_TEXT_MAX);
  if (text.length < SYLLABUS_TEXT_MIN) {
    return bad(`The syllabus needs at least ${SYLLABUS_TEXT_MIN} characters of text${file && typeof file !== 'string' ? '; this file has too little readable text (a scanned copy?)' : ''}.`);
  }

  let drafted: Awaited<ReturnType<typeof draftSyllabus>>;
  try {
    drafted = await draftSyllabus(text, course);
  } catch (err) {
    console.warn('[syllabus] draft failed:', err instanceof Error ? err.message : err);
    return bad('The campus model did not return a usable draft; try again.', 502);
  }

  const who = personalName(auth.grant) ?? (field(form, 'authorName', NAME_MAX) || 'Department login');
  const [row] = await db.insert(planSyllabusDrafts).values({
    planId: id, courseRef, fileName, text, model: drafted.model, draftedBy: who, draft: drafted.draft,
  }).returning({ id: planSyllabusDrafts.id, at: planSyllabusDrafts.draftedAt });
  const at = row!.at.toISOString();

  const edits = toCourseEdits(drafted.draft, { by: who.slice(0, 120), at, draftId: row!.id, fileName });
  // A named course proposed on this plan is linked by its id; any other code is linked as written.
  const proposedByCode = new Map((state.proposed ?? []).map(p => [normalizeCourseCode(p.code) ?? p.code, p.id]));
  const links = prereqLinks(drafted.draft, { ref: courseRef, code: course.code }, code => proposedByCode.get(code) ?? code);
  return NextResponse.json({ draftId: row!.id, fileName, at, edits, links });
}
