import { describe, it, expect } from 'vitest';
import { courseKudResultSchema } from '@/lib/ai/schemas';

const valid = {
  thresholdConcept: 'Color is a physical interaction, not a file property.',
  know: ['CMYK model', 'Halftone mechanics', 'Substrate compatibility'],
  understand: ['Why dot gain propagates', 'How ink adhesion works', 'Why process choice affects cost'],
  do: ['Select and justify a Pantone standard', 'Conduct ink-substrate testing', 'Interpret results against tolerance'],
  confidenceNotes: 'Do bullets grounded in Brand Color Report and Ink Lab. Know/Understand inferred from lecture outcomes.',
};

describe('courseKudResultSchema', () => {
  it('accepts a valid result', () => {
    expect(() => courseKudResultSchema.parse(valid)).not.toThrow();
  });

  it('rejects missing thresholdConcept', () => {
    const { thresholdConcept: _, ...rest } = valid;
    expect(() => courseKudResultSchema.parse(rest)).toThrow();
  });

  it('rejects fewer than 3 know bullets', () => {
    expect(() => courseKudResultSchema.parse({ ...valid, know: ['one', 'two'] })).toThrow();
  });

  it('rejects more than 5 do bullets', () => {
    expect(() => courseKudResultSchema.parse({ ...valid, do: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow();
  });
});
