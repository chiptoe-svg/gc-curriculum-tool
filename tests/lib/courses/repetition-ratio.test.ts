import { describe, it, expect } from 'vitest';
import { repetitionRatio } from '@/lib/courses/repetition-ratio';

describe('repetitionRatio', () => {
  it('is ~0 for clean varied prose', () => {
    const md = '# Title\n\nFirst paragraph about products.\n\nSecond distinct paragraph.\n\n- bullet one\n- bullet two';
    expect(repetitionRatio(md)).toBeLessThan(0.1);
  });
  it('is high for the repetition trap (repeated lines + junk tokens)', () => {
    const md = ['·','·','·','·','the left lane,','the left lane,','the left lane,','the left lane,','the left lane,'].join('\n');
    expect(repetitionRatio(md)).toBeGreaterThan(0.7);
  });
  it('counts a line identical to its predecessor as a repeat', () => {
    const md = 'Name\nresults\nresults\nresults\nresults';
    expect(repetitionRatio(md)).toBeGreaterThan(0.5);
  });
  it('returns 0 for empty / whitespace-only input', () => {
    expect(repetitionRatio('')).toBe(0);
    expect(repetitionRatio('   \n\n  ')).toBe(0);
  });
  it('a mostly-clean doc with a couple repeats stays under 0.3', () => {
    const lines = ['# Heading','para a','para b','para c','para d','para e','para f','x','x'];
    expect(repetitionRatio(lines.join('\n'))).toBeLessThan(0.3);
  });
});
