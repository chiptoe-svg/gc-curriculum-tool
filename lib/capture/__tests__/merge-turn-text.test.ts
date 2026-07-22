import { describe, it, expect } from 'vitest';
import { mergeTurnText } from '../merge-turn-text';

describe('mergeTurnText', () => {
  it('appends the question below the finding on the normal path', () => {
    expect(mergeTurnText('We found a gap in assessment.', 'How do you grade it?')).toBe(
      'We found a gap in assessment.\n\nHow do you grade it?',
    );
  });

  it('does not repeat an exact-copy question already in the finding', () => {
    const finding = 'We found a gap.\n\nHow do you grade it?';
    expect(mergeTurnText(finding, 'How do you grade it?')).toBe(finding);
  });

  it('does not append when the finding already ends with a REWORDED question (the real bug)', () => {
    const finding =
      'The digests show GC 1010.\n\nThe gap is the Internship Fair.\n\nWhen you grade it, are you assessing interaction or accuracy?';
    // Different wording than the question field — substring match would miss it.
    const question = 'Are students graded on professional interaction, or on what they learned?';
    expect(mergeTurnText(finding, question)).toBe(finding);
  });

  it('handles empty question / empty finding', () => {
    expect(mergeTurnText('finding only', '')).toBe('finding only');
    expect(mergeTurnText('', 'question only')).toBe('question only');
  });
});
