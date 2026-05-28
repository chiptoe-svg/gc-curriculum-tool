import { describe, it, expect } from 'vitest';
import { deriveSourceFlag } from '@/lib/ai/synthesis/source-derivation';

describe('deriveSourceFlag', () => {
  it('returns "inferred" for empty citations', () => {
    expect(deriveSourceFlag([])).toBe('inferred');
  });

  it('returns "instructor" when all citations are type=instructor', () => {
    expect(deriveSourceFlag([
      { type: 'instructor', messageId: 'm1', excerpt: 'a' },
      { type: 'instructor', messageId: 'm2', excerpt: 'b' },
    ])).toBe('instructor');
  });

  it('returns "materials" when all citations are type=chunk', () => {
    expect(deriveSourceFlag([
      { type: 'chunk', chunkId: 'c1', excerpt: 'a' },
      { type: 'chunk', chunkId: 'c2', excerpt: 'b' },
    ])).toBe('materials');
  });

  it('returns "inferred" for mixed citations', () => {
    expect(deriveSourceFlag([
      { type: 'instructor', messageId: 'm1', excerpt: 'a' },
      { type: 'chunk', chunkId: 'c1', excerpt: 'b' },
    ])).toBe('inferred');
  });

  it('returns "instructor" for a single instructor citation', () => {
    expect(deriveSourceFlag([
      { type: 'instructor', messageId: 'm1', excerpt: 'a' },
    ])).toBe('instructor');
  });

  it('returns "materials" for a single chunk citation', () => {
    expect(deriveSourceFlag([
      { type: 'chunk', chunkId: 'c1', excerpt: 'a' },
    ])).toBe('materials');
  });
});
