import { describe, it, expect } from 'vitest';
import { formatIncomingRequirements, SYLLABUS_PHRASES } from '@/lib/capture/incoming-requirements';
import type { CaptureIncomingExpectation } from '@/lib/ai/capture/schema';

function exp(statement: string, k: number | null, u: number | null, d: number): CaptureIncomingExpectation {
  return {
    statement,
    expected_depth: { k, u, d },
    evidenced_by: ['assignment'],
    confidence: 'high',
  };
}

describe('formatIncomingRequirements', () => {
  it('composes all non-zero dimensions into one prose line', () => {
    const [line] = formatIncomingRequirements([exp('Spreadsheet formulas', 2, 2, 3)]);
    expect(line).toBe(
      'Spreadsheet formulas — recognize the terminology, explain the why in your own words, and work independently.',
    );
  });

  it('omits zero/null dimensions (foundational-style: D only)', () => {
    const [line] = formatIncomingRequirements([exp('File handling', null, null, 2)]);
    expect(line).toBe('File handling — do it with a reference at hand.');
  });

  it('emits the bare statement when all depths are 0/null', () => {
    const [line] = formatIncomingRequirements([exp('General curiosity', null, null, 0)]);
    expect(line).toBe('General curiosity');
  });

  it('the phrase table is bijective — the encoding is reversible', () => {
    const all = Object.values(SYLLABUS_PHRASES).flatMap(byLevel => Object.values(byLevel));
    expect(new Set(all).size).toBe(all.length); // no two (dim, level) cells share a phrase
  });
});
