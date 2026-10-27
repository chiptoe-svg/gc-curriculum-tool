// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MATERIAL_LIST_BULLET, SEARCH_FIRST_SECTION, evenlySpaced, userTurnsBefore, withMaterialList, withSearchFirstSection } from '@/scripts/capture/replay-interview';

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

describe('withMaterialList', () => {
  const prompt = readFileSync('lib/ai/prompts/capture-chat-agent.md', 'utf8');
  it('swaps the digest bullet for the material-list bullet and adds the search-first section', () => {
    const out = withMaterialList(prompt);
    expect(out).toContain(MATERIAL_LIST_BULLET);
    expect(out).not.toContain('- **Per-material digests**');
    expect(out).toContain(SEARCH_FIRST_SECTION);
    expect(out).toContain("- **Prerequisite courses' captured profiles**");
  });
});

describe('userTurnsBefore', () => {
  const session = [
    { role: 'assistant', turnIndex: 104, content: 'q' },
    { role: 'user', turnIndex: 105, content: 'answer' },
    { role: 'assistant', turnIndex: 106, content: 'q2' },
  ];
  it('returns the instructor turn just before each interviewer turn', () => {
    expect(userTurnsBefore(session, [106])).toEqual([session[1]]);
  });
  it('rejects a turn that does not follow an instructor turn', () => {
    expect(() => userTurnsBefore(session, [105])).toThrow(/not an instructor turn/);
  });
});
