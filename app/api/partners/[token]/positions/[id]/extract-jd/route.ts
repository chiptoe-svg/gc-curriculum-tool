import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById } from '@/lib/db/position-capture-queries';
import { extractJdFields } from '@/lib/ai/position-capture/jd-extract';
import { extractText } from '@/lib/courses/extract-text';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';
import { SUPPORTED_MIME_TYPES, LEGACY_OFFICE_MIME_TYPES } from '@/lib/courses/material-extractor';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 120;
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set<string>([...SUPPORTED_MIME_TYPES, ...LEGACY_OFFICE_MIME_TYPES, 'text/plain']);

interface RouteContext { params: Promise<{ token: string; id: string }> }

/**
 * POST /api/partners/[token]/positions/[id]/extract-jd
 * Body: multipart with field 'file' OR JSON with field 'text'.
 * Returns: { fields: JdExtraction, telemetry: { ... } }
 *
 * Inline-extraction: the JD bytes themselves are not stored (faculty
 * don't need them; the partner already has the source). Extracted
 * structured fields are returned for the partner to review on Page 1
 * and the client PATCHes them onto structuredInputs.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (existing.status !== 'draft') return NextResponse.json({ error: 'not editable' }, { status: 409 });

  const contentType = req.headers.get('content-type') ?? '';
  let jdText: string;
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'file field required' }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: `unsupported mime ${file.type}` }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'file too large' }, { status: 413 });
    }
    if (file.type === 'text/plain') {
      jdText = await file.text();
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = await extractText({ fileBytes: Buffer.from(bytes), mimeType: file.type as ExtractedMimeType, fileName: file.name });
      if (ext.status !== 'ok' || !ext.text) {
        return NextResponse.json({ error: 'extraction failed' }, { status: 422 });
      }
      jdText = ext.text;
    }
  } else {
    const body = await req.json().catch(() => ({})) as { text?: unknown };
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return NextResponse.json({ error: 'text field required' }, { status: 400 });
    }
    jdText = body.text;
  }

  try {
    const result = await extractJdFields(jdText);
    await recordSpend(result.costUsdCents);
    return NextResponse.json({
      fields: result.fields,
      telemetry: { model: result.model, costUsdCents: result.costUsdCents, durationMs: result.durationMs },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'extract failed';
    console.error('[extract-jd]', msg);
    return NextResponse.json({ error: 'extract failed', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
