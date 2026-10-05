// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { loadPrompt } from '@/lib/ai/prompts/load';

describe('privacy-scrub prompt', () => {
  it('loads and states the placeholder and the keep-list', async () => {
    const p = await loadPrompt('privacy-scrub');
    expect(p).toContain('[student]');
    expect(p).toMatch(/instructors/i);
    expect(p).toMatch(/Change nothing else/);
  });
});
