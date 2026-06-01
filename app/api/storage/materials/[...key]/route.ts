import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { readLocal } from '@/lib/storage/local-storage';

interface RouteContext { params: Promise<{ key: string[] }> }

// Content type by extension for any file we'd serve "as itself."
// Note: dangerous extensions (DANGEROUS_EXTS below) are coerced to
// application/octet-stream regardless of what's mapped here.
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
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  md: 'text/markdown',
};

// Extensions that can carry executable script in the browser if rendered on
// the app's origin. The upload allowlist permits text/html (and the
// material-extractor handles it), but allowing the SAME origin to RENDER
// uploaded HTML would be stored-XSS on the auth origin (slug-gated + Basic
// Auth means an attacker with upload access could exfiltrate sessions).
// We coerce these to application/octet-stream and force download instead
// of rendering.
const DANGEROUS_EXTS = new Set(['html', 'htm', 'svg', 'xml', 'xhtml', 'js', 'mjs', 'jsx', 'tsx']);

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
  const isDangerous = DANGEROUS_EXTS.has(ext);
  const contentType = isDangerous
    ? 'application/octet-stream'
    : (CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream');

  // Sanitize the filename for Content-Disposition (last path segment, with
  // quote and CR/LF escaping). Used only for the browser's "save as" hint.
  const lastSeg = keyStr.split('/').pop() ?? 'download';
  const dispositionName = lastSeg.replace(/[\r\n"\\]/g, '_');

  // Defense in depth — every response gets all four:
  //   - Content-Disposition: attachment — browser downloads, never renders
  //   - Content-Type: application/octet-stream for dangerous exts
  //   - X-Content-Type-Options: nosniff — browser respects declared type
  //   - Content-Security-Policy: sandbox — if rendered anyway, opaque origin
  //     with no script/network capabilities
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${dispositionName}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': 'private, max-age=3600',
    },
  });
}
