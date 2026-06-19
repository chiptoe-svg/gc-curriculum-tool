import { describe, it, expect } from 'vitest';
import { CurriculumChatResponseSchema, CurriculumChatResponseJsonSchema } from '@/lib/ai/wiki/response-schema';

describe('citation schema', () => {
  it('accepts a wiki-path citation', () => {
    const r = CurriculumChatResponseSchema.parse({ response: 'x', citations: [{ path: 'courses/gc-4800.md', excerpt: 'e', courseCode: null, materialId: null, fileName: null, chunkId: null }] });
    expect(r.citations[0]!.path).toBe('courses/gc-4800.md');
  });
  it('accepts a material-chunk citation', () => {
    const r = CurriculumChatResponseSchema.parse({ response: 'x', citations: [{ path: null, excerpt: 'e', courseCode: 'GC 1000', materialId: 'm', fileName: 'f.pdf', chunkId: 'c' }] });
    expect(r.citations[0]!.courseCode).toBe('GC 1000');
  });
  it('strict json schema lists every property in required', () => {
    const item: any = CurriculumChatResponseJsonSchema.properties.citations.items;
    expect(new Set(item.required)).toEqual(new Set(Object.keys(item.properties)));
  });
});
