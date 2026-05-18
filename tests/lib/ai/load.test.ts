import { describe, it, expect } from 'vitest';
import { loadPrompt } from '@/lib/ai/prompts/load';

describe('prompt loader', () => {
  it('composes shared rubric into draft-outcomes', async () => {
    const composed = await loadPrompt('draft-outcomes');
    expect(composed).toContain('KUD Scoring Rubric');
    expect(composed).toContain('Reasoning Frame for Career Targets');
    expect(composed).toContain('drafting course-level KUD outcomes');
  });

  it('composes shared rubric into score-coverage', async () => {
    const composed = await loadPrompt('score-coverage');
    expect(composed).toContain('KUD Scoring Rubric');
    expect(composed).toContain('scoring a single course');
  });

  it('composes shared rubric into analyze-prerequisite-gaps', async () => {
    const composed = await loadPrompt('analyze-prerequisite-gaps');
    expect(composed).toContain('KUD Scoring Rubric');
    expect(composed).toContain('met, underdeveloped, or missing');
  });
});
