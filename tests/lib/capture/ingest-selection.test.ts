import { describe, it, expect } from 'vitest';
import { ingestAction, type IngestCandidate } from '@/lib/capture/ingest-selection';

function candidate(overrides: Partial<IngestCandidate> = {}): IngestCandidate {
  return {
    extractedText: null,
    blobUrl: '/api/storage/materials/gc-1010/123-deck.pdf',
    indexingStatus: 'pending',
    ...overrides,
  };
}

describe('ingestAction', () => {
  it('queues a freshly-uploaded slide deck (pending, no text, local blob)', () => {
    // The triage-mode regression: uploads arrive un-extracted with only a blob.
    // The worker extracts them (incl. vision OCR), so they MUST be queued.
    expect(
      ingestAction(candidate({ extractedText: null, indexingStatus: 'pending' })),
    ).toBe('queue');
  });

  it('queues a text-backed material that is not yet indexed', () => {
    expect(
      ingestAction(candidate({ extractedText: 'lecture notes…', indexingStatus: 'pending' })),
    ).toBe('queue');
  });

  it('skips a material with neither extracted text nor a readable local blob', () => {
    // e.g. a Canvas-referenced row whose blob is an external URL the worker
    // cannot read from disk — nothing to process.
    expect(
      ingestAction(candidate({ extractedText: null, blobUrl: 'https://canvas.example/files/9' })),
    ).toBe('skip');
  });

  it('skips a material already indexed (ready) to avoid re-running costly vision OCR', () => {
    expect(
      ingestAction(candidate({ extractedText: 'done', indexingStatus: 'ready' })),
    ).toBe('skip');
  });

  it('re-queues a previously skipped/failed file-backed material', () => {
    expect(ingestAction(candidate({ indexingStatus: 'skipped' }))).toBe('queue');
    expect(ingestAction(candidate({ indexingStatus: 'failed' }))).toBe('queue');
  });

  it('treats empty-string extracted text as "no text" (falls back to blob)', () => {
    expect(
      ingestAction(candidate({ extractedText: '', blobUrl: 'https://x/y' })),
    ).toBe('skip');
  });
});
