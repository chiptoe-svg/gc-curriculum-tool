/**
 * Detect Google Workspace URLs in arbitrary text and extract their file IDs.
 *
 * Currently handles:
 *   - Google Docs:        docs.google.com/document/d/{ID}
 *   - Google Slides:      docs.google.com/presentation/d/{ID}
 *   - Google Sheets:      docs.google.com/spreadsheets/d/{ID}
 *
 * Drive files (PDFs, videos, images) have their own export flow — see
 * lib/google-drive/.
 */

const DOC_RE = /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/gi;
const SLIDE_RE = /https?:\/\/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/gi;
const SHEET_RE = /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/gi;

export type GoogleWorkspaceKind = 'document' | 'presentation' | 'spreadsheet';

export interface GoogleWorkspaceReference {
  kind: GoogleWorkspaceKind;
  /** A canonical /edit URL for the file, suitable for storing as blobUrl. */
  canonicalUrl: string;
  /** The Google Workspace file ID. */
  fileId: string;
}

function canonicalUrlFor(kind: GoogleWorkspaceKind, fileId: string): string {
  if (kind === 'document') return `https://docs.google.com/document/d/${fileId}/edit`;
  if (kind === 'presentation') return `https://docs.google.com/presentation/d/${fileId}/edit`;
  return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
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
  for (const m of text.matchAll(SHEET_RE)) {
    const fileId = m[1];
    if (fileId) {
      const key = `spreadsheet:${fileId}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ kind: 'spreadsheet', fileId, canonicalUrl: canonicalUrlFor('spreadsheet', fileId) });
      }
    }
  }
  return refs;
}
