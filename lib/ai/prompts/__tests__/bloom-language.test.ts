import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raw = readFileSync(join(process.cwd(), 'lib/ai/prompts/shared/bloom-language.md'), 'utf8');
const norm = raw.replace(/\s+/g, ' ');

// Krathwohl (2002), Table 3: the revised taxonomy's 19 cognitive processes.
const PROCESSES = [
  'recognizing', 'recalling',
  'interpreting', 'exemplifying', 'classifying', 'summarizing', 'inferring', 'comparing', 'explaining',
  'executing', 'implementing',
  'differentiating', 'organizing', 'attributing',
  'checking', 'critiquing',
  'generating', 'planning', 'producing',
];

describe('shared/bloom-language.md', () => {
  it('lists all 19 revised-Bloom processes', () => {
    const lower = norm.toLowerCase();
    for (const p of PROCESSES) expect(lower, p).toContain(p);
  });
  it('starts its body with the marker heading', () => {
    expect(raw).toMatch(/^# Bloom language/m);
  });
  it('forbids raising a level', () => {
    expect(norm).toMatch(/never[^.]{0,80}higher/i);
    expect(norm).toContain('A verb in course materials or in a written statement is not evidence of a level.');
  });
  it('sets the name-clash convention', () => {
    expect(norm).toMatch(/understand/i);
    expect(norm).toMatch(/explaining|inferring|comparing/);
  });
  it('forbids level codes in faculty-facing wording', () => {
    expect(norm).toMatch(/level codes/i);
  });
  it('gives Do wording with conditions and its gaps', () => {
    for (const s of ['executing', 'implementing', 'independently', 'with a reference', 'guides others']) {
      expect(norm.toLowerCase(), s).toContain(s);
    }
  });
  it('covers foundational competencies', () => {
    expect(norm).toMatch(/foundational/i);
  });
  it('stays short', () => {
    expect(norm.split(' ').filter(Boolean).length).toBeLessThanOrEqual(900);
  });
});
