import { describe, it, expect } from 'vitest';
import { authorizedForBearer } from '@/lib/auth/bearer';

describe('authorizedForBearer', () => {
  const expected = 's3cret-token-abc123';

  it('accepts the correct token', () => {
    expect(authorizedForBearer(`Bearer ${expected}`, expected)).toBe(true);
  });

  it('accepts the scheme case-insensitively + trims trailing whitespace', () => {
    expect(authorizedForBearer(`bearer ${expected}`, expected)).toBe(true);
    expect(authorizedForBearer(`BEARER ${expected}  `, expected)).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(authorizedForBearer('Bearer wrong-token', expected)).toBe(false);
  });

  it('rejects a token of a different length (no crash on timingSafeEqual)', () => {
    expect(authorizedForBearer('Bearer short', expected)).toBe(false);
    expect(authorizedForBearer(`Bearer ${expected}extra`, expected)).toBe(false);
  });

  it('rejects a missing / empty header', () => {
    expect(authorizedForBearer(null, expected)).toBe(false);
    expect(authorizedForBearer(undefined, expected)).toBe(false);
    expect(authorizedForBearer('', expected)).toBe(false);
  });

  it('rejects a non-Bearer scheme', () => {
    expect(authorizedForBearer(`Basic ${expected}`, expected)).toBe(false);
  });

  it('rejects an empty token after the scheme', () => {
    expect(authorizedForBearer('Bearer ', expected)).toBe(false);
    expect(authorizedForBearer('Bearer    ', expected)).toBe(false);
  });

  it('FAILS CLOSED when no token is configured', () => {
    // Even a syntactically valid header must be denied if the server has no
    // expected token — the endpoint must never be open by omission.
    expect(authorizedForBearer('Bearer anything', undefined)).toBe(false);
    expect(authorizedForBearer('Bearer anything', '')).toBe(false);
    expect(authorizedForBearer('Bearer anything', null)).toBe(false);
  });
});
