import { describe, it, expect } from 'vitest';
import { grounded, normText, excerptFragments } from '@/scripts/reliability/grounding';

const source = normText('Students "Measure a control wedge on a print sample" and then "Compare the proof to the press sheet using Delta E 2000" in Lab 6. Grading is mainly tied to completing the required workflow.');
describe('grounded', () => {
  it('accepts stitched quotes with ellipses and curly quotes', () => {
    expect(grounded('“Measure a control wedge on a print sample ... Compare the proof to the press sheet using Delta E 2000”', source)).toBe(true);
  });
  it('accepts a plain quote', () => {
    expect(grounded('"Grading is mainly tied to completing the required workflow."', source)).toBe(true);
  });
  it('rejects a fragment that is not in the source', () => {
    expect(grounded('“Measure a control wedge on a print sample”; “Students design their own spectral targets”', source)).toBe(false);
  });
  it('splits on the joiners models use', () => {
    expect(excerptFragments('“aaaaaaaaaaaaaaaaaaaaaa”; “bbbbbbbbbbbbbbbbbbbbbbbb”').length).toBe(2);
  });
});
