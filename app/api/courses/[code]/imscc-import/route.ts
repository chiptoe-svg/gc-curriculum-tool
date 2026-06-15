import { NextResponse } from 'next/server';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { getCourseByCode, updateCourseCanvasImport } from '@/lib/db/courses-queries';
import { insertMaterial, findMaterialByFileName, updateMaterialMetadata } from '@/lib/db/course-materials-queries';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';
import { parseImscc } from '@/lib/canvas/parseImscc';
import { assembleCanvasMaterials } from '@/lib/canvas/assemble-canvas-materials';
import { extractText, SUPPORTED_MIME_TYPES, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { isLegacyOfficeMime } from '@/lib/courses/legacy-converter';

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

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const slug = String(form.get('slug') ?? '');
  const sourceCode = form.get('sourceCode') ? String(form.get('sourceCode')) : null;

  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  if (!file) return NextResponse.json({ error: 'No .imscc file uploaded' }, { status: 400 });
  if (file.size > 500 * 1024 * 1024) {
    return NextResponse.json({ error: 'Cartridge too large (>500MB)' }, { status: 413 });
  }

  const course = await getCourseByCode(code);
  if (!course) return NextResponse.json({ error: `Course not found: ${code}` }, { status: 404 });

  const tmp = join(tmpdir(), `imscc-${randomUUID()}.imscc`);
  let parsed: Awaited<ReturnType<typeof parseImscc>>;
  try {
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

  const { data, files } = parsed;

  const sheetsHasCatalog = (course.learningObjectives ?? []).length > 0;
  const toInsert = assembleCanvasMaterials(data, { sheetsHasCatalog });

  // Process binary file attachments from the cartridge (e.g. PDFs, DOCX).
  // Images and unsupported types are silently skipped; extraction failures
  // skip that file but do not abort the whole import.
  for (const imsccFile of files) {
    const isSupported = (SUPPORTED_MIME_TYPES as readonly string[]).includes(imsccFile.mimeType);
    const isLegacy = isLegacyOfficeMime(imsccFile.mimeType);
    if (!isSupported && !isLegacy) {
      console.log(`[imscc-import] skipped (unsupported type): ${imsccFile.name} (${imsccFile.mimeType})`);
      continue;
    }
    try {
      const result = await extractText({
        fileBytes: imsccFile.bytes,
        mimeType: imsccFile.mimeType as ExtractedMimeType,
        fileName: imsccFile.name,
      });
      if (result.status !== 'ok' || !result.text) {
        console.log(`[imscc-import] extraction ${result.status} for ${imsccFile.name}`);
        continue;
      }
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
  const vectorStore = createVectorStore();
  const imported: Array<{ id: string; fileName: string }> = [];
  let insertedCount = 0;
  let updatedCount = 0;
  const blobUrl = `imscc:${data.course.name}`;

  for (const { fileName, text, mimeType } of toInsert) {
    const existing = await findMaterialByFileName(code, fileName, sourceCode);
    if (existing) {
      await updateMaterialMetadata({
        id: existing.id,
        blobUrl,
        mimeType,
        sizeBytes: text.length,
      });
      await finalizeExtraction({
        id: existing.id,
        courseCode: code,
        fileName,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: text,
        vectorStore,
      });
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
      await finalizeExtraction({
        id: mat.id,
        courseCode: code,
        fileName,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: text,
        vectorStore,
      });
      imported.push({ id: mat.id, fileName });
      insertedCount++;
    }
  }

  // Stamp provenance so the Step-1 header can show source name + import date
  // without a live API call.
  await updateCourseCanvasImport(code, `Common Cartridge: ${data.course.name}`, new Date());

  return NextResponse.json({
    imported: imported.length,
    inserted: insertedCount,
    updated: updatedCount,
  });
}
