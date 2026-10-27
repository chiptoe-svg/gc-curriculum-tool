// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SEARCH_FIRST_SECTION, evenlySpaced, withSearchFirstSection } from '@/scripts/capture/replay-interview';

describe('withSearchFirstSection', () => {
  const prompt = readFileSync('lib/ai/prompts/capture-chat-agent.md', 'utf8');

  it('replaces only the "When to retrieve" section of the real interviewer prompt', () => {
    const out = withSearchFirstSection(prompt);
    expect(out).toContain(SEARCH_FIRST_SECTION);
    expect(out).not.toContain('The digest already answers the question precisely.');
    const start = prompt.indexOf('## When to retrieve');
    const end = prompt.indexOf('## Program memory (cross-instructor');
    expect(out.slice(0, start)).toBe(prompt.slice(0, start));
    expect(out.slice(start + SEARCH_FIRST_SECTION.length)).toBe(prompt.slice(end));
  });

  it('fails loudly when the section is missing', () => {
    expect(() => withSearchFirstSection('no such section')).toThrow(/not found/);
  });
});

describe('evenlySpaced', () => {
  it('keeps the first and last and spaces the rest', () => {
    expect(evenlySpaced([0, 1, 2, 3, 4, 5, 6, 7, 8], 3)).toEqual([0, 4, 8]);
    expect(evenlySpaced([1, 2], 5)).toEqual([1, 2]);
  });
});
