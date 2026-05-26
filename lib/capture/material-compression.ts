/**
 * Rules for deciding which materials get replaced by a structured digest
 * in the audit chat prompt. Pure logic — no DB or network. Used by:
 *   - `finalizeExtraction` to decide whether to digest a freshly
 *     extracted material;
 *   - the backfill endpoint to find pre-existing eligible materials;
 *   - the capture chat route to substitute digest for extracted text.
 */

export type SourceKind =
  | 'canvas_dense'       // Canvas: <Syllabus|Assignments|Modules|Pages|Discussions|Quizzes>
  | 'google_workspace'   // Google Doc | Slides | Sheet
  | 'canvas_file'        // Canvas File: ...
  | 'drive_pdf'          // Drive PDF: ...
  | 'youtube'            // YouTube: ...
  | 'uploaded';          // anything else

export interface CompressionMaterial {
  fileName: string;
  extractedText: string | null;
  digest: string | null;
  useDigest: boolean;
}

// 15k tokens ≈ 60k chars under the ~4 chars/token rule of thumb.
export const COMPRESSION_TOKEN_THRESHOLD = 15_000;
export const COMPRESSION_CHAR_THRESHOLD = COMPRESSION_TOKEN_THRESHOLD * 4;

export function classifySource(fileName: string): SourceKind {
  if (fileName.startsWith('Canvas File:')) return 'canvas_file';
  if (fileName.startsWith('Canvas:')) return 'canvas_dense';
  if (fileName.startsWith('Google Doc:')) return 'google_workspace';
  if (fileName.startsWith('Google Slides:')) return 'google_workspace';
  if (fileName.startsWith('Google Sheet:')) return 'google_workspace';
  if (fileName.startsWith('Drive PDF:')) return 'drive_pdf';
  if (fileName.startsWith('YouTube:')) return 'youtube';
  return 'uploaded';
}

const COMPRESSIBLE_KINDS: ReadonlySet<SourceKind> = new Set([
  'canvas_file', 'drive_pdf', 'youtube', 'uploaded',
]);

export function isCompressionCandidate(m: CompressionMaterial): boolean {
  if (!m.extractedText) return false;
  if (m.extractedText.length < COMPRESSION_CHAR_THRESHOLD) return false;
  return COMPRESSIBLE_KINDS.has(classifySource(m.fileName));
}

export function effectiveAuditText(m: CompressionMaterial): string | null {
  if (m.useDigest && m.digest) return m.digest;
  return m.extractedText;
}
