/**
 * Material file types the app can read: the single list shared by the upload
 * route's allowlist (via material-extractor) and the page's file pickers.
 * Client-safe (no extractor imports). Non-PDF/DOCX types are read by Docling
 * (PDF_PARSER=docling, as live runs).
 */
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // .xlsx
  'text/csv',
  'text/html',
  'image/png',
  'image/jpeg',
] as const;
export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

/** The file picker's `accept` value. */
export const MATERIAL_UPLOAD_ACCEPT = ['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.html', '.htm', '.png', '.jpg', '.jpeg', ...SUPPORTED_MIME_TYPES].join(',');

/** The kinds, for "only … files are accepted" messages. */
export const UPLOADABLE_KINDS = 'PDF, Word, PowerPoint, Excel, CSV, HTML, PNG or JPEG';

const SUPPORTED = new Set<string>(SUPPORTED_MIME_TYPES);

/** Whether a picked file is a type the server will read (by its MIME type, as the upload route checks). */
export function isUploadableMaterial(file: { type: string; name: string }): boolean {
  return SUPPORTED.has(file.type);
}
