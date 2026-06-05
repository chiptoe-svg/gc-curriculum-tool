import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById, updatePositionDraft } from '@/lib/db/position-capture-queries';
import { extractText } from '@/lib/courses/extract-text';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';
import { SUPPORTED_MIME_TYPES, LEGACY_OFFICE_MIME_TYPES } from '@/lib/courses/material-extractor';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { putLocal, safeFilename } from '@/lib/storage/local-storage';

export const maxDuration = 120;
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set<string>([...SUPPORTED_MIME_TYPES, ...LEGACY_OFFICE_MIME_TYPES, 'text/plain']);

interface RouteContext { params: Promise<{ token: string; id: string }> }

/**
 * POST /api/partners/[token]/positions/[id]/upload-doc
 * Body: multipart with field 'file'.
 *
 * Extracts text from the uploaded interview rubric/guide, stores the file
 * under ~/.local/share/gc-curriculum-tool/materials/partners/<partnerId>/<positionId>/<filename>,
 * persists interview_doc_text + a sourceFiles entry on the draft row.
 *
 * Returns: { ok: true, fileName, textLength }
 *
 * No AI spend — no daily-cap check required.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;

  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (existing.status !== 'draft') return NextResponse.json({ error: 'not editable' }, { status: 409 });

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file field required' }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `unsupported mime ${file.type}` }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'file too large (max 10 MB)' }, { status: 413 });
  }

  const bytes = Buffer.from(new Uint8Array(await file.arrayBuffer()));
  const fileName = safeFilename(file.name || 'interview-doc');

  // Extract text — 'low_text' is acceptable, only 'failed' is an error
  let docText = '';
  if (file.type === 'text/plain') {
    docText = bytes.toString('utf8');
  } else {
    const ext = await extractText({
      fileBytes: bytes,
      mimeType: file.type as ExtractedMimeType,
      fileName: file.name,
    });
    if (ext.status === 'failed') {
      return NextResponse.json({ error: 'text extraction failed' }, { status: 422 });
    }
    docText = ext.text ?? '';
  }

  // Persist file to local storage
  const storageKey = `partners/${partner.id}/${id}/${Date.now()}-${fileName}`;
  let storageUrl = '';
  try {
    const stored = await putLocal({ key: storageKey, bytes });
    storageUrl = stored.url;
  } catch (err) {
    // Non-fatal: we still have the extracted text; log and continue
    console.warn('[upload-doc] putLocal failed, continuing text-only:', err instanceof Error ? err.message : err);
  }

  // Build the updated sourceFiles array (append, don't overwrite existing entries)
  const existingFiles = Array.isArray(existing.sourceFiles) ? existing.sourceFiles : [];
  const newEntry = {
    kind: 'interview-doc' as const,
    fileName,
    key: storageUrl ? storageKey : '',
    extractedText: docText,
  };
  const updatedSourceFiles = [...existingFiles, newEntry];

  // Write interview_doc_text + sourceFiles to the draft
  const currentInputs = (existing.structuredInputs as Record<string, unknown>) ?? {};
  await updatePositionDraft({
    id,
    partnerId: partner.id,
    structuredInputs: { ...currentInputs, interview_doc_text: docText },
    sourceFiles: updatedSourceFiles,
  });

  return NextResponse.json({ ok: true, fileName, textLength: docText.length });
}
