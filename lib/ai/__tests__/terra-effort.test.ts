import { describe, it, expect } from 'vitest';
import { DEFAULT_REASONING_EFFORT } from '../models';
import { piReasoningSetup } from '../agent/pi/turn';

describe('Terra for the interview (owner 2026-11-19)', () => {
  it('runs at medium when set as a custom model, and Pi sends that effort', () => {
    expect(DEFAULT_REASONING_EFFORT['gpt-6.1-terra']).toBe('medium');
    const ep = { model: 'gpt-6.1-terra', reasoning: DEFAULT_REASONING_EFFORT['gpt-6.1-terra'] as 'medium' };
    expect(piReasoningSetup(ep).piReasoning).toBe(true);
  });
});
