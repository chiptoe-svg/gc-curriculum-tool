import { describe, it, expect } from 'vitest';
import { estimateIngestSeconds } from '@/lib/capture/ingest-eta';

describe('estimateIngestSeconds', () => {
  it('uses 1.25s/page ÷ 6 concurrency for image-heavy pages + per-material overhead', () => {
    const s = estimateIngestSeconds([{ pageCount: 12, imageHeavy: true }]); // 12*1.25/6=2.5 + ~15
    expect(s).toBeGreaterThan(15);
    expect(s).toBeLessThan(30);
  });
  it('text materials skip the qwen term (cheaper than image-heavy)', () => {
    expect(estimateIngestSeconds([{ pageCount: 20, imageHeavy: true }]))
      .toBeGreaterThan(estimateIngestSeconds([{ pageCount: 20, imageHeavy: false }]));
  });
  it('handles empty list', () => {
    expect(estimateIngestSeconds([])).toBe(0);
  });
});
