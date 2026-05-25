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

  return {
    kind,
    fileId,
    text,
    title: deriveTitle(text, kind, fileId),
    status: 'ok',
  };
}
