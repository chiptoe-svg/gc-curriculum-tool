/**
 * Detect Google Workspace URLs in arbitrary text and extract their file IDs.
 *
 * Currently handles:
 *   - Google Docs:     docs.google.com/document/d/{ID}
 *   - Google Slides:   docs.google.com/presentation/d/{ID}
 *
 * Sheets and Drive files (PDFs, videos, images) have different export
 * flows and aren't covered yet.
 */

const DOC_RE = /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/gi;
const SLIDE_RE = /https?:\/\/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/gi;

export type GoogleWorkspaceKind = 'document' | 'presentation';

export interface GoogleWorkspaceReference {
  kind: GoogleWorkspaceKind;
  /** A canonical /edit URL for the file, suitable for storing as blobUrl. */
  canonicalUrl: string;
  /** The Google Workspace file ID. */
  fileId: string;
}

function canonicalUrlFor(kind: GoogleWorkspaceKind, fileId: string): string {
  return kind === 'document'
    ? `https://docs.google.com/document/d/${fileId}/edit`
    : `https://docs.google.com/presentation/d/${fileId}/edit`;
}

export function extractGoogleWorkspaceReferences(text: string): GoogleWorkspaceReference[] {
  if (!text) return [];
  const seen = new Set<string>(); // dedupe across kinds by `${kind}:${id}`
  const refs: GoogleWorkspaceReference[] = [];

  for (const m of text.matchAll(DOC_RE)) {
    const fileId = m[1];
    if (fileId) {
      const key = `document:${fileId}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ kind: 'document', fileId, canonicalUrl: canonicalUrlFor('document', fileId) });
      }
    }
  }
  for (const m of text.matchAll(SLIDE_RE)) {
    const fileId = m[1];
    if (fileId) {
      const key = `presentation:${fileId}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ kind: 'presentation', fileId, canonicalUrl: canonicalUrlFor('presentation', fileId) });
      }
    }
  }
  return refs;
}
