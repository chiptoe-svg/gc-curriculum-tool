/**
 * Fetch plain-text content from a Google Workspace file (Docs or Slides) via
 * its public-export endpoint.
 *
 * Works when the file has link-sharing enabled ("Anyone with the link can
 * view"). When the file is restricted, Google returns a sign-in HTML page;
 * we detect that and report inaccessible so faculty know the content is
 * gated.
 *
 * No Google OAuth flow involved — this is the same export URL anyone with
 * the link can hit in a browser.
 */

import type { GoogleWorkspaceKind, GoogleWorkspaceReference } from './extract-urls';

export interface FetchedGoogleFile {
  kind: GoogleWorkspaceKind;
  fileId: string;
  text: string;
  title: string;
  status: 'ok' | 'inaccessible';
  errorReason?: string;
}

function exportUrlFor(kind: GoogleWorkspaceKind, fileId: string): string {
  // Docs supports `export?format=txt`. Slides uses `/export/txt` (different
  // path shape). Sheets uses `export?format=csv` and dumps the first tab.
  // All three work without auth for link-shared files.
  if (kind === 'document') return `https://docs.google.com/document/d/${fileId}/export?format=txt`;
  if (kind === 'presentation') return `https://docs.google.com/presentation/d/${fileId}/export/txt`;
  return `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`;
}

function kindLabel(kind: GoogleWorkspaceKind): string {
  if (kind === 'document') return 'Google Doc';
  if (kind === 'presentation') return 'Google Slides';
  return 'Google Sheet';
}

function deriveTitle(text: string, kind: GoogleWorkspaceKind, fileId: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.length > 0) return t.slice(0, 100);
  }
  return `${kindLabel(kind)} (${fileId.slice(0, 12)})`;
}

/**
 * Pull the file's REAL Google Workspace title out of the export response's
 * `Content-Disposition` header, which Google sets to the document's name, e.g.
 * `attachment; filename="My Syllabus.txt"; filename*=UTF-8''My%20Syllabus.txt`.
 *
 * This is the actual title (not the first body line), and it costs nothing
 * extra — it's already on the export response we fetch, no Drive API / OAuth.
 * Prefers the RFC 5987 `filename*` form (handles non-ASCII) over the plain
 * `filename="..."`. Strips the export extension (.txt / .csv). Returns null
 * when the header is absent/unparseable so the caller can fall back to the
 * first-line derivation.
 */
export function titleFromContentDisposition(headerValue: string | null): string | null {
  if (!headerValue) return null;
  let name: string | null = null;

  // RFC 5987: filename*=UTF-8''percent%20encoded
  const ext = headerValue.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
  if (ext?.[1]) {
    const raw = ext[1].trim();
    try {
      name = decodeURIComponent(raw);
    } catch {
      name = raw;
    }
  } else {
    // Plain: filename="..."  (or unquoted filename=...)
    const quoted = headerValue.match(/filename\s*=\s*"([^"]*)"/i);
    const bare = headerValue.match(/filename\s*=\s*([^;]+)/i);
    name = (quoted?.[1] ?? bare?.[1])?.trim() ?? null;
  }

  if (!name) return null;
  name = name.replace(/\.(txt|csv)$/i, '').trim();
  return name.length > 0 ? name.slice(0, 100) : null;
}

export async function fetchGoogleFileText(ref: GoogleWorkspaceReference): Promise<FetchedGoogleFile> {
  const { kind, fileId } = ref;
  if (!fileId || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    return { kind, fileId, text: '', title: '', status: 'inaccessible', errorReason: 'invalid file id' };
  }
  const url = exportUrlFor(kind, fileId);
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    return { kind, fileId, text: '', title: '', status: 'inaccessible', errorReason: e instanceof Error ? e.message : 'fetch failed' };
  }
  if (!res.ok) {
    return { kind, fileId, text: '', title: '', status: 'inaccessible', errorReason: `HTTP ${res.status}` };
  }

  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();

  // Google returns an HTML sign-in page when the file isn't publicly accessible.
  // Plain-text export always has content-type starting with text/plain.
  const looksLikeHtml = body.trim().startsWith('<') || contentType.startsWith('text/html');
  if (looksLikeHtml) {
    return {
      kind,
      fileId,
      text: '',
      title: '',
      status: 'inaccessible',
      errorReason: kind === 'document'
        ? "Doc isn't shared as link-viewable. Enable 'Anyone with the link can view' in Google Docs sharing."
        : kind === 'presentation'
        ? "Slides deck isn't shared as link-viewable. Enable 'Anyone with the link can view' in Google Slides sharing."
        : "Sheet isn't shared as link-viewable. Enable 'Anyone with the link can view' in Google Sheets sharing.",
    };
  }

  const text = body.replace(/^﻿/, '').trimStart();
  if (text.length === 0) {
    return { kind, fileId, text: '', title: '', status: 'inaccessible', errorReason: 'empty file' };
  }

  // Prefer the real document title from the export response's
  // Content-Disposition filename; fall back to the first content line only
  // when that header is missing (deriveTitle).
  const headerTitle = titleFromContentDisposition(res.headers.get('content-disposition'));

  return {
    kind,
    fileId,
    text,
    title: headerTitle ?? deriveTitle(text, kind, fileId),
    status: 'ok',
  };
}
