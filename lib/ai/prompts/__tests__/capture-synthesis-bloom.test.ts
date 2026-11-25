import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const md = readFileSync(join(process.cwd(), 'lib/ai/prompts/capture-synthesis.md'), 'utf8');
const norm = md.replace(/\s+/g, ' ');
const fixture = readFileSync(join(process.cwd(), 'lib/ai/prompts/__tests__/fixtures/capture-synthesis-schema.txt'), 'utf8');

describe('capture-synthesis prompt — Bloom wording never stands in for evidence', () => {
  it('states that Bloom wording is not evidence', () => {
    expect(norm).toContain('A verb in course materials or in a written statement is not evidence of a level.');
  });
  it('asks statements to name the process the evidence shows', () => {
    expect(norm).toMatch(/statement[^.]*process the evidence shows/i);
  });
  it('leaves the output schema text unchanged', () => {
    const i = md.indexOf('```jsonc');
    const j = md.indexOf('\n```', i + 8) + 4;
    expect(md.slice(i, j)).toBe(fixture);
  });
});
