import { keyFromLocalUrl } from '@/lib/storage/local-storage';

/** Minimal shape needed to decide whether the Ingest step should enqueue a material. */
export interface IngestCandidate {
  /** Extracted text if the row already carried/produced it; null/absent otherwise. */
  extractedText: string | null;
  /** Blob URL — a local `/api/storage/...` URL is readable by the worker; external URLs are not. */
  blobUrl: string;
  /** Current indexing_status; 'ready' means already processed. */
  indexingStatus: string | null;
}

export type IngestAction = 'queue' | 'skip';

/**
 * Decide whether a (non-ignored) material should be enqueued by the Ingest step
 * (`POST /api/admin/v2-backfill`).
 *
 * The worker (ingest-queue `processMaterial`) handles two kinds of input:
 *   1. text-backed rows — `extractedText` already present (e.g. Canvas HTML), and
 *   2. file-backed rows — a readable local blob it extracts from disk, including
 *      the vision-OCR fallback for image-based slide decks (extract-text.ts).
 * So a material is processable if it has EITHER extracted text OR a readable
 * local blob.
 *
 * This replaces an earlier `extraction_status === 'ok'` guard that silently
 * skipped every freshly-uploaded file: with the triage flow, uploads are stored
 * un-extracted (extraction_status='pending', no text, blob on disk) and rely on
 * THIS step to extract them. The old guard made "Ingest & continue" a no-op for
 * exactly those files — the bug this fixes.
 *
 * Already-'ready' materials are left alone: re-running vision OCR / embeddings on
 * completed work is costly (metered against the daily cap) and pointless on a
 * wizard step clicked repeatedly. A material that needs reprocessing has its
 * indexing_status reset on re-upload, so it won't be 'ready' here.
 */
export function ingestAction(m: IngestCandidate): IngestAction {
  if (m.indexingStatus === 'ready') return 'skip';
  const hasText = typeof m.extractedText === 'string' && m.extractedText.length > 0;
  const hasBlob = keyFromLocalUrl(m.blobUrl) !== null;
  return hasText || hasBlob ? 'queue' : 'skip';
}
