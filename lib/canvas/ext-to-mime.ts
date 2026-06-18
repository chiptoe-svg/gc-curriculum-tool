/**
 * Extension-to-MIME fallback for ALL Canvas file paths — used when Canvas
 * reports an empty or generic content-type (`application/octet-stream`) and
 * we derive the type from the file extension instead.
 *
 * This is the single canonical map for every canvas path:
 *   - `canvas-import/route.ts` (runImport)
 *   - `canvas-import/list-import.ts` (runListImport)
 *   - `canvas-reextract/route.ts` (POST handler)
 *   - `scripts/reextract-canvas-files.ts`
 *   - `scripts/backfill-canvas-file-mime-types.ts`
 *
 * Superset of all previously divergent inline copies: includes legacy Office
 * (`doc`/`ppt`/`xls`) and image/text extras (`gif`/`svg`/`txt`) so no path
 * loses a mapping relative to what it had before consolidation.
 */
export const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};
