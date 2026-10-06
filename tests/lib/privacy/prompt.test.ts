// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { loadPrompt } from '@/lib/ai/prompts/load';

describe('privacy-scrub prompt', () => {
  it('asks for a list of student names, states the keep-list and the empty case', async () => {
    const p = await loadPrompt('privacy-scrub');
    expect(p).toContain('"names"');
    expect(p).toMatch(/instructors/i);
    expect(p).toMatch(/teaching assistants/i);
    expect(p).toMatch(/guest speakers/i);
    expect(p).toMatch(/\[\]/);
    expect(p).not.toMatch(/WHOLE input text/);
  });
});
