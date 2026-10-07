// Owner, 2026-10-07: moving an already-read file to another level re-reads it.
import { describe, it, expect } from 'vitest';
import { tierChangeNeedsReread } from '@/lib/capture/ingest-selection';

const read = { tier: 'high', indexingStatus: 'ready', extractedText: 'some text', blobUrl: '' };

describe('tierChangeNeedsReread', () => {
  it('a read file moved to a new level is re-read', () => {
    expect(tierChangeNeedsReread(read, 'middle')).toBe(true);
  });
  it('the same level (null counts as high) is not re-read', () => {
    expect(tierChangeNeedsReread(read, 'high')).toBe(false);
    expect(tierChangeNeedsReread({ ...read, tier: null }, 'high')).toBe(false);
  });
  it('a file not yet read is left alone (it will be read at its new level anyway)', () => {
    expect(tierChangeNeedsReread({ ...read, indexingStatus: 'pending' }, 'middle')).toBe(false);
  });
  it('a file with nothing to re-read from (no text, no local file) is left alone', () => {
    expect(tierChangeNeedsReread({ ...read, extractedText: null, blobUrl: 'https://example.com/x.pdf' }, 'middle')).toBe(false);
  });
});
