import { extractText } from '@/lib/courses/extract-text';

/**
 * Fetch a Drive file by ID and, if it's a PDF, extract its text. Works
 * for publicly-shared Drive files via the /uc?export=download endpoint —
 * the same URL anyone with the link can hit.
 *
 * Limits:
 *   - Only PDFs are processed. Other content types are reported as
 *     'unsupported' (Drive serves images, videos, MP4s, DOCX etc. via
 *     the same endpoint, but our extraction pipeline only handles PDFs
 *     in this entry point).
 *   - Files over MAX_BYTES are skipped to keep memory + latency bounded.
 *   - Drive's "large-file confirm" page (shown for files >100MB) returns
 *     HTML instead of the file; we detect that and report inaccessible.
 */

const MAX_BYTES = 10 * 1024 * 1024;  // 10 MB per file

export interface FetchedDriveFile {
  fileId: string;
  status: 'ok' | 'unsupported' | 'inaccessible' | 'too_large';
  text?: string;
  title?: string;
  errorReason?: string;
  mimeType?: string;
}

function deriveTitle(text: string, fileId: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.length > 0) return t.slice(0, 100);
  }
  return `Drive PDF (${fileId.slice(0, 12)})`;
}

export async function fetchDrivePdf(fileId: string): Promise<FetchedDriveFile> {
  if (!fileId || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    return { fileId, status: 'inaccessible', errorReason: 'invalid file id' };
  }
  const url = `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}&export=download`;
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    return { fileId, status: 'inaccessible', errorReason: e instanceof Error ? e.message : 'fetch failed' };
  }
  if (!res.ok) {
    return { fileId, status: 'inaccessible', errorReason: `HTTP ${res.status}` };
  }

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();

  // Drive returns text/html when the file is private (sign-in page) or
  // when a confirm-download dialog is needed (>100MB files).
  if (contentType.startsWith('text/html')) {
    return {
      fileId,
      status: 'inaccessible',
      errorReason: "File isn't shared as link-viewable, or it's too large for direct download. Enable 'Anyone with the link' sharing in Drive.",
    };
  }

  // Only PDFs are processed at this endpoint. Other content types are
  // skipped — the audit gets a 'reference noted but not extracted' result
  // rather than nothing.
  if (!contentType.includes('pdf')) {
    return {
      fileId,
      status: 'unsupported',
      mimeType: contentType || 'unknown',
      errorReason: `Drive file is ${contentType || 'unknown type'}, not a PDF`,
    };
  }

  // Sanity-check size from header before downloading the full body.
  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BYTES) {
    return {
      fileId,
      status: 'too_large',
      mimeType: contentType,
      errorReason: `Drive PDF too large (${contentLength} > ${MAX_BYTES} bytes)`,
    };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { fileId, status: 'inaccessible', errorReason: e instanceof Error ? e.message : 'download failed' };
  }

  if (buffer.byteLength > MAX_BYTES) {
    return { fileId, status: 'too_large', mimeType: contentType, errorReason: `${buffer.byteLength} bytes` };
  }

  let extraction;
  try {
    extraction = await extractText({
      fileBytes: buffer,
      mimeType: 'application/pdf',
      fileName: `drive-${fileId}.pdf`,
    });
  } catch (e) {
    return { fileId, status: 'inaccessible', errorReason: `extraction error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (extraction.status !== 'ok' || !extraction.text) {
    return { fileId, status: 'inaccessible', errorReason: `extraction ${extraction.status}` };
  }

  return {
    fileId,
    status: 'ok',
    text: extraction.text,
    title: deriveTitle(extraction.text, fileId),
    mimeType: contentType,
  };
}
