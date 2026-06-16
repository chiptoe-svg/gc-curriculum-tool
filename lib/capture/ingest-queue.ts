import { readLocal, keyFromLocalUrl } from '@/lib/storage/local-storage';
import { extractText, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';
import {
  claimNextQueued,
  resetStuckIndexing,
  updateIndexingStatus,
  type CourseMaterialRow,
  type ExtractionStatus,
  type ExtractionMethod,
} from '@/lib/db/course-materials-queries';

// ---------------------------------------------------------------------------
// In-process worker — drains the indexing queue with bounded concurrency
// ---------------------------------------------------------------------------

const MAX_CONCURRENCY = 2;
let workerRunning = false;
let recovered = false;
let inFlight = 0;
// Wake signal: set by enqueue() AFTER the row is committed 'queued'. The drain
// loop clears it before each claim and re-checks it before idling, so a row
// enqueued during the loop's final (empty) claim isn't orphaned by a
// just-about-to-exit worker. Residual: if an enqueue commits after the loop has
// already exited, the row waits for the next enqueue / "Index now" / restart to
// drain (self-healing, never lost).
let wake = false;

// Indirection so tests can swap the processor without fighting ESM live-binding.
// processMaterial is a function declaration and is hoisted, so this assignment
// is valid even though processMaterial appears later in the file.
// eslint-disable-next-line prefer-const
let _process: (row: CourseMaterialRow) => Promise<void> = (...args) => processMaterial(...args);

/** Test seam — reset module state between tests. */
export function __resetWorkerForTest(): void {
  workerRunning = false;
  recovered = false;
  inFlight = 0;
  wake = false;
  _process = processMaterial;
}

/** Test seam — override the processor used by the drain loop. */
export function __setProcessForTest(fn: (row: CourseMaterialRow) => Promise<void>): void {
  _process = fn;
}

/** Mark a material queued and ensure the worker is draining. Idempotent. */
export async function enqueue(materialId: string): Promise<void> {
  await updateIndexingStatus({ id: materialId, status: 'queued' });
  wake = true;
  ensureWorker();
}

/** Start the drain loop if it isn't already running. */
export function ensureWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  void drainLoop();
}

async function drainLoop(): Promise<void> {
  try {
    if (!recovered) {
      recovered = true;
      const n = await resetStuckIndexing();
      if (n > 0) console.log(`[ingest] boot recovery re-queued ${n} stuck material(s)`);
    }
    while (true) {
      if (inFlight >= MAX_CONCURRENCY) {
        await new Promise(r => setTimeout(r, 25));
        continue;
      }
      wake = false; // clear before claiming; an enqueue during the claim re-sets it
      const row = await claimNextQueued();
      if (!row) {
        if (inFlight > 0) { await new Promise(r => setTimeout(r, 25)); continue; }
        if (wake) continue; // a row was enqueued during the (empty) claim — re-check
        break;
      }
      inFlight++;
      void _process(row).finally(() => { inFlight--; });
    }
  } finally {
    workerRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Material processor
// ---------------------------------------------------------------------------

/**
 * Run one queued material to completion. File-backed rows (a stored blob, no
 * extracted text yet) are extracted from disk first; text-backed rows (Canvas
 * / Drive imports that already carried their text) skip straight to
 * finalizeExtraction. Marks 'failed' on any unrecoverable error so a single
 * bad material never wedges the queue.
 */
export async function processMaterial(row: CourseMaterialRow): Promise<void> {
  try {
    let extractedText = row.extractedText ?? undefined;
    let extractionStatus = row.extractionStatus as ExtractionStatus;
    let extractionMethod: ExtractionMethod | undefined;
    let pageCount: number | undefined;

    if (!extractedText) {
      const key = keyFromLocalUrl(row.blobUrl);
      const bytes = key ? await readLocal(key) : null;
      if (!bytes) {
        console.error(`[ingest] ${row.courseCode} "${row.fileName}": blob missing (${row.blobUrl})`);
        await updateIndexingStatus({ id: row.id, status: 'failed' });
        return;
      }
      const ex = await extractText({
        fileBytes: bytes,
        mimeType: row.mimeType as ExtractedMimeType,
        fileName: row.fileName,
      });
      extractedText = ex.text;
      extractionStatus = ex.status;
      extractionMethod = ex.method as ExtractionMethod | undefined;
      pageCount = ex.pageCount;
    }

    await finalizeExtraction({
      id: row.id,
      courseCode: row.courseCode,
      fileName: row.fileName,
      extractionStatus,
      ...(extractionMethod !== undefined && { extractionMethod }),
      ...(extractedText !== undefined && { extractedText }),
      ...(pageCount !== undefined && { pageCount }),
      vectorStore: createVectorStore(),
    });
  } catch (err) {
    console.error(`[ingest] ${row.courseCode} "${row.fileName}": processMaterial failed`, err);
    await updateIndexingStatus({ id: row.id, status: 'failed' });
  }
}
