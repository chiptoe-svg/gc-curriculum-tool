import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { putLocal, courseSlug, safeFilename } from '@/lib/storage/local-storage';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { insertMaterial } from '@/lib/db/course-materials-queries';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';
import { extractText } from '@/lib/courses/extract-text';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';
import { SUPPORTED_MIME_TYPES, LEGACY_OFFICE_MIME_TYPES } from '@/lib/courses/material-extractor';

export const maxDuration = 120;

const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
// Allowlist combines modern formats (handled directly by the extractor)
// with legacy Office formats (transparently converted via LibreOffice in
// extract-text.ts when soffice is on PATH — local Mac only). Vercel can
// accept the legacy uploads too, but extraction will fail with a clear
// error message; rejecting at the upload layer would surface the same
// error earlier but with less context. Letting it through and failing in
// extraction is fine.
const ALLOWED_MIME_TYPES = new Set<string>([
  ...SUPPORTED_MIME_TYPES,
  ...LEGACY_OFFICE_MIME_TYPES,
]);

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { code } = await params;

  // Parse multipart form data.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  const slug = typeof form.get('slug') === 'string' ? (form.get('slug') as string) : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  // Verify the course exists.
  const course = await getCourseByCode(code);
  if (!course) {
    return NextResponse.json({ error: `course not found: ${code}` }, { status: 404 });
  }

  // IP rate limit.
  const ipHash = hashIp(req);
  const rl = await checkIpRateLimit(ipHash);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limit exceeded — try again in an hour' }, { status: 429 });
  }

  // Validate the uploaded file.
  // Use duck-type check rather than `instanceof File` — jsdom and undici expose
  // different File constructors, so instanceof can fail in test environments
  // even though the object is a valid File-like blob.
  const file = form.get('file') as File | null;
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error:
          `Unsupported MIME type: ${file.type}. Allowed: PDF, DOCX/DOC, PPTX/PPT, XLSX/XLS, CSV, HTML, PNG, JPG. ` +
          `PPTX/XLSX/CSV/HTML/image and legacy .doc/.ppt/.xls require the local Docling + LibreOffice pipeline (Phase 2 hybrid deploy).`,
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_SIZE_BYTES})` },
      { status: 400 },
    );
  }

  // Store on local disk under ~/.local/share/gc-curriculum-tool/materials/...
  // (was Vercel Blob; the local Mac deploy has no business reaching into Vercel).
  // We read the bytes once and reuse them for both storage and extraction.
  const fileBytes = Buffer.from(await file.arrayBuffer());
  const storageKey = `${courseSlug(code)}/${Date.now()}-${safeFilename(file.name)}`;
  let stored;
  try {
    stored = await putLocal({ key: storageKey, bytes: fileBytes });
  } catch (err) {
    console.error('local storage write failed', err);
    return NextResponse.json(
      { error: 'failed to store uploaded file on disk' },
      { status: 503 },
    );
  }

  // Insert the row with extractionStatus='pending'.
  const material = await insertMaterial({
    courseCode: code,
    fileName: file.name,
    blobUrl: stored.url,
    mimeType: file.type,
    sizeBytes: file.size,
    ipHash,
  });

  const vectorStore = createVectorStore();

  // Run extraction synchronously using the bytes we already read.
  const extracted = await extractText({
    fileBytes,
    mimeType: file.type as ExtractedMimeType,
    fileName: file.name,
  });

  // Gate vision transcription cost.
  if (extracted.visionCostUsdCents !== undefined && extracted.visionCostUsdCents > 0) {
    const cap = await checkDailyCap();
    if (cap.ok) {
      await recordSpend(extracted.visionCostUsdCents);
    }
  }

  // Persist extraction result.
  await finalizeExtraction({
    id: material.id,
    courseCode: code,
    fileName: material.fileName,
    extractionStatus: extracted.status,
    extractionMethod: extracted.method,
    extractedText: extracted.text,
    pageCount: extracted.pageCount,
    vectorStore,
  });

  return NextResponse.json({
    id: material.id,
    fileName: material.fileName,
    blobUrl: material.blobUrl,
    extractionStatus: extracted.status,
    extractionMethod: extracted.method,
    pageCount: extracted.pageCount,
  });
}
