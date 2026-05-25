/**
 * Detect Google Drive file URLs in arbitrary text and extract their file IDs.
 *
 * Drive file URLs are distinct from Google Workspace (Docs/Slides/Sheets).
 * Drive serves the raw file (PDF, image, video, etc.) rather than an
 * editable Workspace document. For our purposes, only PDFs are worth
 * extracting; other types are skipped.
 *
 * Patterns:
 *   - https://drive.google.com/file/d/{ID}/view
 *   - https://drive.google.com/file/d/{ID}/preview
 *   - https://drive.google.com/open?id={ID}
 *   - https://drive.google.com/uc?id={ID}
 */

const FILE_VIEW_RE = /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/gi;
const FILE_OPEN_RE = /https?:\/\/drive\.google\.com\/(?:open|uc)\?[^"\s]*id=([a-zA-Z0-9_-]+)/gi;

export interface DriveFileReference {
  fileId: string;
  canonicalUrl: string;
}

export function extractDriveFileReferences(text: string): DriveFileReference[] {
  if (!text) return [];
  const seen = new Set<string>();
  const refs: DriveFileReference[] = [];
  for (const re of [FILE_VIEW_RE, FILE_OPEN_RE]) {
    for (const m of text.matchAll(re)) {
      const fileId = m[1];
      if (fileId && !seen.has(fileId)) {
        seen.add(fileId);
        refs.push({
          fileId,
          canonicalUrl: `https://drive.google.com/file/d/${fileId}/view`,
        });
      }
    }
  }
  return refs;
}
