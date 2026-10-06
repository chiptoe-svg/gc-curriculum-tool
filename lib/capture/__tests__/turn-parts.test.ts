import { describe, it, expect } from 'vitest';
import { splitTurnText, turnParts } from '../merge-turn-text';

describe('splitTurnText (new turns: finding + question fields)', () => {
  it('keeps the question as its own part on the normal path', () => {
    expect(splitTurnText('We found a gap in assessment.', 'How do you grade it?')).toEqual({
      body: 'We found a gap in assessment.',
      question: 'How do you grade it?',
    });
  });

  it('removes an exact copy of the question from the finding so it is shown once', () => {
    expect(splitTurnText('We found a gap.\n\nHow do you grade it?', 'How do you grade it?')).toEqual({
      body: 'We found a gap.',
      question: 'How do you grade it?',
    });
  });

  it('a finding that already ends with a REWORDED question: that paragraph is the question, field not repeated', () => {
    const finding =
      'The digests show GC 1010.\n\nThe gap is the Internship Fair.\n\nWhen you grade it, are you assessing interaction or accuracy?';
    const question = 'Are students graded on professional interaction, or on what they learned?';
    const parts = splitTurnText(finding, question);
    expect(parts).toEqual({
      body: 'The digests show GC 1010.\n\nThe gap is the Internship Fair.',
      question: 'When you grade it, are you assessing interaction or accuracy?',
    });
    expect(`${parts.body}\n${parts.question}`).not.toContain(question);
  });

  it('empty question → falls back to a trailing "?" paragraph in the finding, else none', () => {
    expect(splitTurnText('A finding.\n\nWhat next?', '')).toEqual({ body: 'A finding.', question: 'What next?' });
    expect(splitTurnText('finding only', '')).toEqual({ body: 'finding only', question: null });
  });

  it('empty finding → the whole turn is the question', () => {
    expect(splitTurnText('', 'question only?')).toEqual({ body: '', question: 'question only?' });
  });
});

describe('turnParts (rendering a stored message)', () => {
  it('uses the stored question field and strips it from the merged content', () => {
    expect(turnParts({ content: 'Finding.\n\nWhat do students do?', question: 'What do students do?' })).toEqual({
      body: 'Finding.',
      question: 'What do students do?',
    });
  });

  it('rehydrated (no field): final paragraph ending with "?" is the question', () => {
    expect(turnParts({ content: 'Para one.\n\nPara two.\n\nHow independent are they?' })).toEqual({
      body: 'Para one.\n\nPara two.',
      question: 'How independent are they?',
    });
  });

  it('rehydrated: tolerates trailing whitespace and blank lines with spaces', () => {
    expect(turnParts({ content: 'Para one.\n  \nHow independent are they?  \n' })).toEqual({
      body: 'Para one.',
      question: 'How independent are they?',
    });
  });

  it('rehydrated: a final paragraph that is not a question → no question block', () => {
    expect(turnParts({ content: 'Is this a question? No.\n\nThanks, noted.' })).toEqual({
      body: 'Is this a question? No.\n\nThanks, noted.',
      question: null,
    });
  });

  it('never returns the question text inside the body', () => {
    const p = turnParts({ content: 'A.\n\nB?' , question: 'B?' });
    expect(p.body).not.toContain('B?');
  });
});
