import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { extractText } from '@/lib/courses/extract-text';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 60;

// Match the materials route's cap. The middleware ceiling
// (next.config.ts:middlewareClientMaxBodySize) was raised to 25 MB to
// allow large lab-PDF uploads on the materials route; this route doesn't
// need that headroom and shouldn't accept it.
const MAX_SIZE_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export async function POST(req: Request): Promise<Response> {
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

  const file = form.get('file') as File | null;
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'unsupported file type — upload a PDF or DOCX' },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_SIZE_BYTES})` },
      { status: 400 },
    );
  }

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const result = await extractText({ fileBytes, mimeType: file.type as ExtractedMimeType, fileName: file.name });

  if (result.status === 'failed' || !result.text) {
    return NextResponse.json({ error: 'could not extract text from this file' }, { status: 422 });
  }

  return NextResponse.json({ text: result.text });
}
