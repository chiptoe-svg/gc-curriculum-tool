import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseQtiAssessment } from '@/lib/canvas/parseQti';
const xml = readFileSync('tests/fixtures/imscc-src/quiz1/assessment.xml', 'utf8');
describe('parseQtiAssessment', () => {
  it('maps a QTI 1.2 assessment to a CanvasQuiz', () => {
    const quiz = parseQtiAssessment(xml, 'r_quiz');
    expect(quiz.title).toBe('Quiz 1');
    expect(quiz.source).toBe('classic');
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.questions[0]!.textHtml).toContain('color management');
    expect(quiz.questions[0]!.answers.map(a => a.text)).toContain('ICC profiles');
    expect(quiz.questions[0]!.answers.find(a => a.text === 'ICC profiles')?.correct).toBe(true);
    expect(quiz.questions[1]!.name).toBe('Q2');
  });
});
