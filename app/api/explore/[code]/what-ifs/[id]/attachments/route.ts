import { NextResponse } from 'next/server';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { SUPPORTED_MIME_TYPES, LEGACY_OFFICE_MIME_TYPES } from '@/lib/courses/material-extractor';
import { ingestWhatIfAttachment, WHAT_IF_ATTACHMENT_MAX_BYTES } from '@/lib/what-if/attachments';
import { guardWhatIf } from '@/lib/what-if/route-guard';

// Files are read inside the request (legacy Office conversion, vision), so allow for a slow one.
export const maxDuration = 300;

const ALLOWED_MIME_TYPES = new Set<string>([...SUPPORTED_MIME_TYPES, ...LEGACY_OFFICE_MIME_TYPES]);

interface Ctx { params: Promise<{ code: string; id: string }> }

/**
 * POST /api/explore/[code]/what-ifs/[id]/attachments  (multipart, field "file") → 201 { attachment }
 * This path is excluded from the middleware matcher (large multipart bodies, as for course materials),
 * so guardWhatIf, which also applies the cross-site test, is the whole gate.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { code: rawCode, id } = await params;
  const g = await guardWhatIf(req, decodeURIComponent(rawCode), id, 'manage');
  if (g.response) return g.response;

  const rl = await checkIpRateLimit(hashIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limit exceeded — try again in an hour' }, { status: 429 });
  }
  const cap = await checkDailyCap();
  if (!cap.ok) {
    return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }
  // Duck-type check rather than `instanceof File` (jsdom and undici expose different File constructors).
  const file = form.get('file') as File | null;
  if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported MIME type: ${file.type}. Allowed: PDF, DOCX/DOC, PPTX/PPT, XLSX/XLS, CSV, HTML, PNG, JPG.` },
      { status: 400 },
    );
  }
  if (file.size > WHAT_IF_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${WHAT_IF_ATTACHMENT_MAX_BYTES})` },
      { status: 400 },
    );
  }

  let row;
  try {
    row = await ingestWhatIfAttachment({
      whatIfId: id, fileName: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()),
    });
  } catch (err) {
    console.error('[what-if attachment] store failed', err);
    return NextResponse.json({ error: 'failed to store uploaded file on disk' }, { status: 503 });
  }
  return NextResponse.json(
    { attachment: { id: row.id, fileName: row.fileName, status: row.status, heldBackReason: row.heldBackReason } },
    { status: 201 },
  );
}
