// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { effectiveReasoningEffort } from '@/lib/ai/openai';

// Owner decision 2026-10-06: coverage scoring and course profiles run on
// gpt-6.1-sol at LOW effort (2026-10-05 evaluation + blind evidence check).
describe('effectiveReasoningEffort', () => {
  afterEach(() => { delete process.env.OPENAI_REASONING_EFFORT; });

  it('defaults gpt-6.1-sol to low', () => {
    expect(effectiveReasoningEffort('gpt-6.1-sol', undefined)).toBe('low');
  });
  it('lets an explicit effort win', () => {
    expect(effectiveReasoningEffort('gpt-6.1-sol', 'medium')).toBe('medium');
  });
  it('sends nothing for models without a default (requests unchanged)', () => {
    expect(effectiveReasoningEffort('gpt-5.4', undefined)).toBeUndefined();
    expect(effectiveReasoningEffort('gpt-5.4-mini', undefined)).toBeUndefined();
  });
  it('keeps the evaluation env knob above the model default', () => {
    process.env.OPENAI_REASONING_EFFORT = 'high';
    expect(effectiveReasoningEffort('gpt-6.1-sol', undefined)).toBe('high');
  });
});
