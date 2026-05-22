import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { extractText } from '@/lib/courses/extract-text';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';

export const maxDuration = 60;

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

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const result = await extractText({ fileBytes, mimeType: file.type as ExtractedMimeType, fileName: file.name });

  if (result.status === 'failed' || !result.text) {
    return NextResponse.json({ error: 'could not extract text from this file' }, { status: 422 });
  }

  return NextResponse.json({ text: result.text });
}
