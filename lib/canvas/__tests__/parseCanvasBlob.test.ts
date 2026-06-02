import { describe, it, expect } from 'vitest';
import { parseCanvasBlob, filterCanvasBlob, isCanvasListMaterial } from '../parseCanvasBlob';

describe('parseCanvasBlob', () => {
  it('returns [] for empty input', () => {
    expect(parseCanvasBlob('')).toEqual([]);
    expect(parseCanvasBlob('   \n  ')).toEqual([]);
  });

  it('returns [] when no h2 headers are present', () => {
    expect(parseCanvasBlob('plain text\nwith no headers')).toEqual([]);
  });

  it('splits on ## headers', () => {
    const text = '## First\nbody one\n\n## Second\nbody two';
    expect(parseCanvasBlob(text)).toEqual([
      { title: 'First', body: 'body one', ordinalIndex: 0 },
      { title: 'Second', body: 'body two', ordinalIndex: 1 },
    ]);
  });

  it('preserves inline tags in title', () => {
    const text = '## Quiz 4 (10 pts) [classic quiz, unpublished]\nquestion text';
    expect(parseCanvasBlob(text)).toEqual([
      { title: 'Quiz 4 (10 pts) [classic quiz, unpublished]', body: 'question text', ordinalIndex: 0 },
    ]);
  });

  it('handles --- separators in the body without splitting on them', () => {
    const text = '## Page A\nbody A\n\n---\n\n## Page B\nbody B';
    const items = parseCanvasBlob(text);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe('Page A');
    expect(items[0]!.body).toContain('body A');
    expect(items[1]!.title).toBe('Page B');
  });

  it('does NOT match h3+ as items', () => {
    const text = '## Real item\n### sub-header that is not an item\nbody';
    expect(parseCanvasBlob(text)).toEqual([
      { title: 'Real item', body: '### sub-header that is not an item\nbody', ordinalIndex: 0 },
    ]);
  });
});

describe('filterCanvasBlob', () => {
  it('returns input unchanged when ignoredTitles is empty', () => {
    const text = '## A\nbody';
    expect(filterCanvasBlob(text, [])).toBe(text);
  });

  it('returns input unchanged when no items match', () => {
    const text = '## A\nbody';
    expect(filterCanvasBlob(text, ['Z'])).toBe(text);
  });

  it('drops matching items and re-concatenates', () => {
    const text = '## Keep\nkept body\n\n## Drop\ndropped body\n\n## Also keep\nalso kept';
    const result = filterCanvasBlob(text, ['Drop']);
    expect(result).toContain('Keep');
    expect(result).toContain('Also keep');
    expect(result).not.toContain('Drop');
    expect(result).not.toContain('dropped body');
  });

  it('matches titles exactly (including tags)', () => {
    const text = '## Quiz 4 (10 pts) [classic quiz]\nbody';
    expect(filterCanvasBlob(text, ['Quiz 4'])).toContain('Quiz 4'); // partial title doesn't match
    expect(filterCanvasBlob(text, ['Quiz 4 (10 pts) [classic quiz]'])).not.toContain('body');
  });
});

describe('isCanvasListMaterial', () => {
  it.each([
    ['Canvas: Assignments', true],
    ['Canvas: Discussions', true],
    ['Canvas: Quizzes', true],
    ['Canvas: Pages', true],
    ['Canvas: Module List', true],
    ['Canvas: Syllabus', true],  // single-doc but still in the namespace
    ['Canvas File: report.pdf', false],
    ['lab1.pdf', false],
    ['', false],
  ])('isCanvasListMaterial(%j) = %s', (fileName, expected) => {
    expect(isCanvasListMaterial(fileName)).toBe(expected);
  });
});
