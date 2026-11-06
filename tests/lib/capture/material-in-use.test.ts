import { describe, it, expect } from 'vitest';
import { isSentToAI } from '@/lib/capture/material-in-use';

describe('isSentToAI', () => {
  it('is true for an included, current material', () => {
    expect(isSentToAI({ ignored: false, retiredAt: null })).toBe(true);
  });

  it('is false for a material set aside from the AI', () => {
    expect(isSentToAI({ ignored: true, retiredAt: null })).toBe(false);
  });

  it('is false for a retired material even when it was never set aside', () => {
    expect(isSentToAI({ ignored: false, retiredAt: new Date('2026-10-01') })).toBe(false);
  });
});
