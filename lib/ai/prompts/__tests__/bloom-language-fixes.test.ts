import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(process.cwd(), 'lib/ai/prompts', f), 'utf8').replace(/\s+/g, ' ');

describe('Bloom module fixes from the final review', () => {
  it('limits the level-code ban to sentences, keeping structured depth chips (wiki pages need them)', () => {
    const m = read('shared/bloom-language.md');
    expect(m).toMatch(/Never put level codes[^.]*in sentences/);
    expect(m).toMatch(/depth chips[^.]*keep them/i);
    expect(read('wiki-update.md')).toMatch(/K\d\/U\d\/D\d/); // the wiki format still calls for chips
  });
  it('course-profile objectives use the process the evidence shows, not a push toward higher-order verbs', () => {
    const p = read('synthesize-course-profile.md');
    expect(p).not.toContain('Use Wiggins/McTighe action verbs (analyze, evaluate, create, operate, prepare)');
    expect(p).toMatch(/process the evidence shows/);
  });
});
