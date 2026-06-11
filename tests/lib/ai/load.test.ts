import { describe, it, expect } from 'vitest';
import { loadPrompt } from '@/lib/ai/prompts/load';

describe('prompt loader', () => {
  // Several M-trial prompts (draft-outcomes, score-coverage, analyze-prerequisite-gaps,
  // etc.) were removed 2026-06-11 with their dead scorer chains. This exercises
  // the shared-partial composition against a still-live prompt.
  it('composes the shared KUD rubric into a live prompt (extract-course-kud)', async () => {
    const composed = await loadPrompt('extract-course-kud');
    expect(composed).toContain('KUD Scoring Rubric');
  });
});
