import { describe, it, expect } from 'vitest';
import { chunkMaterial, approxTokenCount } from '@/lib/capture/chunker';

describe('approxTokenCount', () => {
  it('approximates ~4 chars per token', () => {
    expect(approxTokenCount('x'.repeat(400))).toBe(100);
    expect(approxTokenCount('')).toBe(0);
  });
});

describe('chunkMaterial', () => {
  it('emits no chunks for empty input', () => {
    expect(chunkMaterial({ fileName: 'x.md', text: '' })).toEqual({ sections: [], details: [] });
  });

  it('emits a single section + details for short heading-less text', () => {
    const text = 'paragraph one.\n\nparagraph two.\n\nparagraph three.';
    const result = chunkMaterial({ fileName: 'x.md', text });
    expect(result.sections.length).toBe(1);
    expect(result.sections[0]!.title).toBe('');
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.details.every(d => d.parentSectionId === result.sections[0]!.id)).toBe(true);
  });

  it('splits on markdown headings (# / ## / ###)', () => {
    const text = `# Intro\nfirst body.\n\n# Chapter 1\nbody one.\n\n# Chapter 2\nbody two.`;
    const result = chunkMaterial({ fileName: 'x.md', text });
    expect(result.sections.map(s => s.title)).toEqual(['Intro', 'Chapter 1', 'Chapter 2']);
  });

  it('respects detail-chunk size ~500 tokens with overlap', () => {
    const longBody = 'word '.repeat(1500); // ~7500 chars, ~1875 tokens
    const result = chunkMaterial({ fileName: 'x.md', text: `# Section\n${longBody}` });
    expect(result.details.length).toBeGreaterThanOrEqual(3);
    for (const d of result.details) {
      expect(approxTokenCount(d.text)).toBeLessThanOrEqual(700); // 500 nominal + slack
    }
  });

  it('details under the same section share a parentSectionId', () => {
    const text = `# Long section\n${'word '.repeat(2000)}\n\n# Other\nshort.`;
    const result = chunkMaterial({ fileName: 'x.md', text });
    const [s1, s2] = result.sections;
    expect(result.details.filter(d => d.parentSectionId === s1!.id).length).toBeGreaterThan(1);
    expect(result.details.filter(d => d.parentSectionId === s2!.id).length).toBe(1);
  });

  it('detail chunks carry section context (sectionIndex, sectionTitle)', () => {
    const text = `# Section A\nbody a.\n\n# Section B\nbody b.`;
    const result = chunkMaterial({ fileName: 'x.md', text });
    const aDetail = result.details.find(d => d.text.includes('body a'));
    const bDetail = result.details.find(d => d.text.includes('body b'));
    expect(aDetail!.sectionTitle).toBe('Section A');
    expect(bDetail!.sectionTitle).toBe('Section B');
    expect(aDetail!.sectionIndex).toBe(0);
    expect(bDetail!.sectionIndex).toBe(1);
  });

  it('is deterministic and idempotent', () => {
    const text = `# A\n${'word '.repeat(800)}\n\n# B\n${'lorem '.repeat(800)}`;
    const r1 = chunkMaterial({ fileName: 'x.md', text });
    const r2 = chunkMaterial({ fileName: 'x.md', text });
    expect(r1).toEqual(r2);
  });
});
