/**
 * Extension-to-MIME fallback for Canvas file imports — used when Canvas reports
 * an empty or generic content-type (`application/octet-stream`) and we derive the
 * type from the file extension instead.
 *
 * Canonical map for the canvas-import paths (`canvas-import/route.ts` runImport +
 * `canvas-import/list-import.ts` runListImport), which previously kept byte-identical
 * inline copies. NOTE: `canvas-reextract` and the `scripts/*reextract*`/`*backfill*`
 * helpers carry their own DIVERGENT copies (the reextract paths omit legacy
 * `doc`/`ppt`/`xls`; the backfill script adds `gif`/`svg`/`txt`). Consolidating those
 * is deliberately out of scope here — merging them would change behavior (e.g. the
 * reextract paths would newly recognize legacy Office). See STATE.md Deferred/debt.
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
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
