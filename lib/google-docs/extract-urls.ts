/**
 * Detect Google Docs URLs in arbitrary text and extract their document IDs.
 *
 * We deliberately scope to `docs.google.com/document/d/{ID}` only — Sheets
 * and Slides have different export endpoints and Drive files (PDFs, videos,
 * images) need different handling. Those can be added later.
 */

const GOOGLE_DOC_URL_RE = /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/gi;

export interface GoogleDocReference {
  /** A canonical /edit URL for the doc, suitable for storing as blobUrl. */
  canonicalUrl: string;
  /** The Google Docs document ID. */
  docId: string;
}

export function extractGoogleDocReferences(text: string): GoogleDocReference[] {
  if (!text) return [];
  const seen = new Set<string>();
  const refs: GoogleDocReference[] = [];
  for (const m of text.matchAll(GOOGLE_DOC_URL_RE)) {
    const docId = m[1];
    if (docId && !seen.has(docId)) {
      seen.add(docId);
      refs.push({
        canonicalUrl: `https://docs.google.com/document/d/${docId}/edit`,
        docId,
      });
    }
  }
  return refs;
}
