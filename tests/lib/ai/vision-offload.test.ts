import { describe, it, expect } from 'vitest';
import { shouldOffload, type VisionOffload } from '@/lib/ai/vision-offload';

const off: VisionOffload = { baseURL: 'http://spark/v1', model: 'qwen3.6-35b-a3b', apiKey: 'k', concurrency: 12, minItems: 4 };

describe('shouldOffload', () => {
  it('honors the size tier by default (below minItems stays local)', () => {
    expect(shouldOffload(off, 1)).toBe(false);
    expect(shouldOffload(off, 4)).toBe(true);
  });
  it('force=true offloads even a single page (bypasses the size tier)', () => {
    expect(shouldOffload(off, 1, true)).toBe(true);
  });
  it('force=true still returns false when there is no offload config', () => {
    expect(shouldOffload(null, 1, true)).toBe(false);
  });
});
