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
  /**
   * Per-item ignore list for Canvas-list materials. When non-empty AND the
   * material is a Canvas-list (Assignments, Discussions, Quizzes, Pages,
   * Module List), `effectiveAuditText` parses the blob and drops items
   * whose `## Title` matches an entry. Has no effect on non-Canvas
   * materials. Optional for older call sites that don't track this yet —
   * those default to "no items ignored" (full text).
   */
  ignoredItems?: readonly string[];
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
  const hasItemIgnores = (m.ignoredItems?.length ?? 0) > 0;
  const isCanvasList = m.fileName.startsWith('Canvas:') && !m.fileName.startsWith('Canvas File:');

  // When the user has dropped specific items from a Canvas-list material,
  // override useDigest. The digest is a paragraph-form summary that doesn't
  // preserve per-item structure, so honoring useDigest would silently
  // re-include the dropped items in summarized form. Use the parsed +
  // filtered raw text instead.
  if (isCanvasList && hasItemIgnores && m.extractedText) {
    // Lazy import to avoid loading the parser when not needed and to keep
    // the compression module free of canvas-specific dependencies.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { filterCanvasBlob } = require('@/lib/canvas/parseCanvasBlob') as typeof import('@/lib/canvas/parseCanvasBlob');
    return filterCanvasBlob(m.extractedText, m.ignoredItems ?? []);
  }

  if (m.useDigest && m.digest) return m.digest;
  return m.extractedText;
}
