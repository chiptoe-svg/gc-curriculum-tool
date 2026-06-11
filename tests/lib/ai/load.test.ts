import { describe, it, expect } from 'vitest';
import { loadPrompt } from '@/lib/ai/prompts/load';

describe('prompt loader', () => {
  // (draft-outcomes + score-coverage prompts were removed 2026-06-11 with their
  //  dead scorer chains — kud-draft.ts / coverage-score.ts had no live callers.)

  it('composes shared rubric into analyze-prerequisite-gaps', async () => {
    const composed = await loadPrompt('analyze-prerequisite-gaps');
    expect(composed).toContain('KUD Scoring Rubric');
    expect(composed).toContain('met, underdeveloped, or missing');
  });
});
