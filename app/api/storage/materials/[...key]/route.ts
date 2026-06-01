import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { readLocal } from '@/lib/storage/local-storage';

interface RouteContext { params: Promise<{ key: string[] }> }

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  md: 'text/markdown',
};

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { key } = await params;
  const keyStr = (key ?? []).join('/');
  if (!keyStr) {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }

  let bytes: Buffer | null;
  try {
    bytes = await readLocal(keyStr);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'storage error' },
      { status: 400 },
    );
  }
  if (!bytes) {
    return NextResponse.json({ error: 'file not found' }, { status: 404 });
  }

  const ext = keyStr.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': contentType,
      'cache-control': 'private, max-age=3600',
    },
  });
}
