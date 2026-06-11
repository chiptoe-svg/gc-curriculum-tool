import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { extractText } from '@/lib/courses/extract-text';
import { parseProfileFields } from '@/lib/ai/analyze/parse-profile-fields';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 60;

interface Ctx { params: Promise<{ code: string }> }

// Match the materials route's cap. The middleware ceiling
// (next.config.ts:middlewareClientMaxBodySize) was raised to 25 MB to
// allow large lab-PDF uploads on the materials route; this route doesn't
// need that headroom and shouldn't accept it.
const MAX_SIZE_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export async function POST(req: Request, { params: _params }: Ctx): Promise<Response> {
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

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }
  const cap = await checkDailyCap();
  if (!cap.ok) {
    return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });
  }

  const file = form.get('file') as File | null;
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'unsupported file type — upload a PDF or DOCX' }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_SIZE_BYTES})` },
      { status: 400 },
    );
  }

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const extracted = await extractText({ fileBytes, mimeType: file.type as ExtractedMimeType, fileName: file.name });

  if (extracted.status === 'failed' || !extracted.text) {
    return NextResponse.json({ error: 'could not extract text from this file' }, { status: 422 });
  }

  const { fields, costUsdCents } = await parseProfileFields(extracted.text);
  await recordSpend(costUsdCents);
  return NextResponse.json(fields);
}
