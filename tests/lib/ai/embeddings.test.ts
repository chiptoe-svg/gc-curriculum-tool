import { describe, it, expect } from 'vitest';
import {
  packEmbeddingBatches,
  MAX_CHARS_PER_REQUEST,
  MAX_CHARS_PER_INPUT,
} from '@/lib/ai/embeddings';

describe('packEmbeddingBatches', () => {
  it('small set that fits in one request → single batch', () => {
    const texts = ['hello', 'world', 'foo'];
    const batches = packEmbeddingBatches(texts);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(texts);
  });

  it('empty input → empty result', () => {
    expect(packEmbeddingBatches([])).toEqual([]);
  });

  it('many inputs whose sum exceeds budget → splits correctly', () => {
    // Each input is 9_000 chars; four of them = 36_000 which exactly hits the cap,
    // five would exceed it (45_000 > 36_000).
    const chunk = 'x'.repeat(9_000);
    const texts = Array.from({ length: 5 }, () => chunk);
    const batches = packEmbeddingBatches(texts);
    // Each batch must be within budget.
    for (const batch of batches) {
      const total = batch.reduce((s, t) => s + t.length, 0);
      expect(total).toBeLessThanOrEqual(MAX_CHARS_PER_REQUEST);
    }
    // Order must be preserved: flatten === input.
    expect(batches.flat()).toEqual(texts);
  });

  it('flattening result gives identical order to input', () => {
    const texts = Array.from({ length: 20 }, (_, i) => `text-${i}-${'a'.repeat(3_000)}`);
    const flat = packEmbeddingBatches(texts).flat();
    expect(flat).toEqual(texts);
  });

  it('every batch summed length stays at or below MAX_CHARS_PER_REQUEST', () => {
    const texts = [
      'a'.repeat(10_000),
      'b'.repeat(12_000),
      'c'.repeat(8_000),
      'd'.repeat(15_000),
      'e'.repeat(20_000),
    ];
    const batches = packEmbeddingBatches(texts);
    for (const batch of batches) {
      const total = batch.reduce((s, t) => s + t.length, 0);
      expect(total).toBeLessThanOrEqual(MAX_CHARS_PER_REQUEST);
    }
    expect(batches.flat()).toEqual(texts);
  });

  it('a 200_000-char input is truncated to MAX_CHARS_PER_INPUT', () => {
    const huge = 'z'.repeat(200_000);
    const batches = packEmbeddingBatches([huge]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]![0]!.length).toBe(MAX_CHARS_PER_INPUT);
  });

  it('input exactly at MAX_CHARS_PER_INPUT is NOT truncated', () => {
    const exact = 'y'.repeat(MAX_CHARS_PER_INPUT);
    const batches = packEmbeddingBatches([exact]);
    expect(batches[0]![0]!.length).toBe(MAX_CHARS_PER_INPUT);
  });

  it('single input that alone fills the budget packs into its own batch', () => {
    const big = 'q'.repeat(MAX_CHARS_PER_REQUEST);
    const other = 'small';
    const batches = packEmbeddingBatches([big, other]);
    // big fills a batch by itself; 'small' must land in a second batch.
    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual([big]);
    expect(batches[1]).toEqual([other]);
  });
});
