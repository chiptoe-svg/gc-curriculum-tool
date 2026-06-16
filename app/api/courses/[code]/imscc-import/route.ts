import { NextResponse } from 'next/server';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isValidSlug } from '@/lib/slug';
import { authorizedForBasicAuth } from '@/lib/auth/basic-auth';
import { hashIp } from '@/lib/ip-hash';
import { getCourseByCode, updateCourseCanvasImport } from '@/lib/db/courses-queries';
import { insertMaterial, findMaterialByFileName, updateMaterialMetadata, updateExtractionResult } from '@/lib/db/course-materials-queries';
import { enqueue } from '@/lib/capture/ingest-queue';
import { parseImscc } from '@/lib/canvas/parseImscc';
import { assembleCanvasMaterials } from '@/lib/canvas/assemble-canvas-materials';
import { extractText, SUPPORTED_MIME_TYPES, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { isLegacyOfficeMime } from '@/lib/courses/legacy-converter';
import { resolveScopedSession } from '@/lib/sandbox/access';

export const maxDuration = 120;

interface Ctx { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: Ctx) {
  try {
    return await runImport(req, params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[imscc-import] unhandled exception:', msg, stack);
    return NextResponse.json(
      { error: `Unexpected server error during IMSCC import: ${msg}` },
      { status: 500 },
    );
  }
}

async function runImport(req: Request, params: Ctx['params']): Promise<Response> {
  const { code } = await params;

  // A scoped external-tester session bound to THIS course authorizes the
  // import in place of faculty Basic-Auth + slug (this route is excluded
  // from the middleware matcher, so middleware injection can't reach it).
  const scoped = await resolveScopedSession(req);
  const scopedOk = scoped?.courseCode === code;

  // Basic Auth enforced HERE because this route is excluded from the
  // middleware matcher (see middleware.ts — Node-middleware body buffering
  // broke real-size multipart .imscc uploads). Same gate, same env var,
  // same no-op-when-unset semantics as the middleware.
  const expectedAuth = process.env.FACULTY_BASIC_AUTH;
  if (!scopedOk && expectedAuth && !authorizedForBasicAuth(req.headers.get('authorization'), expectedAuth)) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="GC Curriculum Tool"' },
    });
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const slug = String(form.get('slug') ?? '');
  const sourceCode = form.get('sourceCode') ? String(form.get('sourceCode')) : null;

  if (!scopedOk && !isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  if (!file) return NextResponse.json({ error: 'No .imscc file uploaded' }, { status: 400 });
  if (file.size > 500 * 1024 * 1024) {
    return NextResponse.json({ error: 'Cartridge too large (>500MB)' }, { status: 413 });
  }

  const course = await getCourseByCode(code);
  if (!course) return NextResponse.json({ error: `Course not found: ${code}` }, { status: 404 });

  const tmp = join(tmpdir(), `imscc-${randomUUID()}.imscc`);
  let parsed: Awaited<ReturnType<typeof parseImscc>>;
  try {
    // Buffer the upload to disk via arrayBuffer(). NOTE: do NOT switch this to
    // a streaming `file.stream()` pipeline — a File from req.formData() is
    // backed by an already-consumed body, so .stream() throws undici's
    // "Response body object should not be disturbed or locked" at runtime.
    // arrayBuffer() is off-heap, so even a few-hundred-MB cartridge is fine;
    // yauzl then random-accesses the temp file (the media bulk is never read).
    await writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    parsed = await parseImscc(tmp);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to parse cartridge' },
      { status: 400 },
    );
  } finally {
    await unlink(tmp).catch(() => {});
  }

  const { data, files, skipped } = parsed;

  const sheetsHasCatalog = (course.learningObjectives ?? []).length > 0;
  const toInsert = assembleCanvasMaterials(data, { sheetsHasCatalog });
  console.log(
    `[imscc-import] parsed "${data.course.name}": ${toInsert.length} structured material(s), ${files.length} embedded file(s), ${skipped.length} skipped`,
  );

  // Process binary file attachments from the cartridge (e.g. PDFs, DOCX).
  // Unsupported types are skipped (already recorded in `skipped`); extraction
  // failures skip that file but do not abort the whole import.
  for (const imsccFile of files) {
    const isSupported = (SUPPORTED_MIME_TYPES as readonly string[]).includes(imsccFile.mimeType);
    const isLegacy = isLegacyOfficeMime(imsccFile.mimeType);
    if (!isSupported && !isLegacy) {
      console.log(`[imscc-import] skipped (unsupported type): ${imsccFile.name} (${imsccFile.mimeType})`);
      skipped.push({ name: imsccFile.name, reason: 'unsupported', sizeBytes: imsccFile.bytes.length });
      continue;
    }
    try {
      const t0 = Date.now();
      console.log(`[imscc-import] extracting file: ${imsccFile.name} (${imsccFile.mimeType})…`);
      const result = await extractText({
        fileBytes: imsccFile.bytes,
        mimeType: imsccFile.mimeType as ExtractedMimeType,
        fileName: imsccFile.name,
      });
      if (result.status !== 'ok' || !result.text) {
        console.log(`[imscc-import] extraction ${result.status} for ${imsccFile.name}`);
        continue;
      }
      console.log(`[imscc-import] extracted ${imsccFile.name} (${result.text.length} chars) in ${Date.now() - t0}ms`);
      toInsert.push({
        fileName: `Canvas File: ${imsccFile.name}`,
        text: result.text,
        mimeType: imsccFile.mimeType,
      });
    } catch (e) {
      console.log(`[imscc-import] extraction error for ${imsccFile.name}:`, e instanceof Error ? e.message : e);
    }
  }

  // Upsert by (courseCode, fileName). Re-imports refresh existing rows in
  // place — no duplicates. Material names are stable per-cartridge
  // (Canvas: Syllabus, Canvas File: X.pdf), so fileName is the natural key.
  const imported: Array<{ id: string; fileName: string }> = [];
  let insertedCount = 0;
  let updatedCount = 0;
  const blobUrl = `imscc:${data.course.name}`;

  let matIdx = 0;
  for (const { fileName, text, mimeType } of toInsert) {
    matIdx++;
    const tMat = Date.now();
    console.log(`[imscc-import] queuing ${matIdx}/${toInsert.length}: ${fileName} (${text.length} chars)…`);
    const existing = await findMaterialByFileName(code, fileName, sourceCode);
    if (existing) {
      await updateMaterialMetadata({
        id: existing.id,
        blobUrl,
        mimeType,
        sizeBytes: text.length,
      });
      await updateExtractionResult({
        id: existing.id,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: text,
      });
      await enqueue(existing.id);
      imported.push({ id: existing.id, fileName });
      updatedCount++;
    } else {
      const ipHash = hashIp(req);
      const mat = await insertMaterial({
        courseCode: code,
        fileName,
        blobUrl,
        mimeType,
        sizeBytes: text.length,
        ipHash,
        sourceCode,
      });
      await updateExtractionResult({
        id: mat.id,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: text,
      });
      await enqueue(mat.id);
      imported.push({ id: mat.id, fileName });
      insertedCount++;
    }
    console.log(`[imscc-import] queued ${matIdx}/${toInsert.length}: ${fileName} in ${Date.now() - tMat}ms`);
  }

  // Stamp provenance so the Step-1 header can show source name + import date
  // without a live API call.
  await updateCourseCanvasImport(code, `Common Cartridge: ${data.course.name}`, new Date());

  console.log(`[imscc-import] done: ${imported.length} queued for indexing (${insertedCount} new, ${updatedCount} updated), ${skipped.length} skipped`);

  return NextResponse.json({
    imported: imported.length,
    inserted: insertedCount,
    updated: updatedCount,
    skipped,
  });
}
