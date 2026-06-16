import { readLocal, keyFromLocalUrl } from '@/lib/storage/local-storage';
import { extractText, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';
import {
  updateIndexingStatus,
  type CourseMaterialRow,
  type ExtractionStatus,
  type ExtractionMethod,
} from '@/lib/db/course-materials-queries';

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
