import { describe, it, expect } from 'vitest';
import { generateMagicToken, generateSessionId, TOKEN_LENGTH } from '@/lib/partners/tokens';

describe('generateMagicToken', () => {
  it('returns a 32-char URL-safe string', () => {
    const t = generateMagicToken();
    expect(t).toHaveLength(TOKEN_LENGTH);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a different value each call', () => {
    const a = generateMagicToken();
    const b = generateMagicToken();
    expect(a).not.toBe(b);
  });
});

describe('generateSessionId', () => {
  it('returns a UUID-like string', () => {
    const s = generateSessionId();
    expect(s).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
