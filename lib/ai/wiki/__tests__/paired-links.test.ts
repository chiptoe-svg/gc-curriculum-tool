import { describe, it, expect } from 'vitest';
import { rewritePairedLinks } from '@/lib/ai/wiki/paired-links';

const pairs = new Map([['gc-2071', 'gc-2070'], ['gc-1041', 'gc-1040']]);

describe('rewritePairedLinks', () => {
  it('points a link to a paired lab code at its course page, keeping the label', () => {
    expect(rewritePairedLinks('See [[gc-2071|GC 2071 lab]] and [[gc-1041]].', pairs))
      .toBe('See [[gc-2070|GC 2071 lab]] and [[gc-1040|GC 1041]].');
  });
  it('leaves other links, longer slugs and plain text alone', () => {
    const s = 'Course [[gc-2070|GC 2070]], [[gc-20710]], text gc-2071, [[color-management|Color]].';
    expect(rewritePairedLinks(s, pairs)).toBe(s);
  });
});
