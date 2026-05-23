/**
 * Fetch the plain-text content of a Google Doc via its public-export endpoint.
 *
 * This works when the doc has link-sharing enabled ("Anyone with the link can
 * view"). When the doc is restricted, Google returns a sign-in HTML page; we
 * detect that and report inaccessible so faculty knows the content is gated.
 *
 * No Google OAuth flow involved — this is the same export URL anyone with
 * the link can hit in a browser.
 */

export interface FetchedGoogleDoc {
  docId: string;
  text: string;
  title: string;
  status: 'ok' | 'inaccessible';
  errorReason?: string;
}

function deriveTitle(text: string, docId: string): string {
  // The plain-text export starts with the doc's content, which usually leads
  // with the title (the first heading or first paragraph). Take the first
  // non-empty line, trimmed and capped.
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.length > 0) return t.slice(0, 100);
  }
  return `Google Doc (${docId.slice(0, 12)})`;
}

export async function fetchGoogleDocText(docId: string): Promise<FetchedGoogleDoc> {
  if (!docId || !/^[a-zA-Z0-9_-]{10,}$/.test(docId)) {
    return { docId, text: '', title: '', status: 'inaccessible', errorReason: 'invalid doc id' };
  }
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    return { docId, text: '', title: '', status: 'inaccessible', errorReason: e instanceof Error ? e.message : 'fetch failed' };
  }
  if (!res.ok) {
    return { docId, text: '', title: '', status: 'inaccessible', errorReason: `HTTP ${res.status}` };
  }

  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();

  // Google returns an HTML sign-in page when the doc isn't publicly accessible.
  // The plain-text export always has content-type starting with text/plain.
  const looksLikeHtml = body.trim().startsWith('<') || contentType.startsWith('text/html');
  if (looksLikeHtml) {
    return {
      docId,
      text: '',
      title: '',
      status: 'inaccessible',
      errorReason: "Doc isn't shared as link-viewable. Enable 'Anyone with the link can view' in Google Docs sharing.",
    };
  }

  // Google Docs export strips the BOM but sometimes leaves a leading
  // form-feed or null character. Trim aggressively.
  const text = body.replace(/^﻿/, '').trimStart();
  if (text.length === 0) {
    return { docId, text: '', title: '', status: 'inaccessible', errorReason: 'empty doc' };
  }

  return {
    docId,
    text,
    title: deriveTitle(text, docId),
    status: 'ok',
  };
}
