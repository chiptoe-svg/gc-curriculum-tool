import { describe, it, expect } from 'vitest';
import { isHttpUrl } from '@/lib/http/is-http-url';

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('https://catalog.clemson.edu/x')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
  });
  it('rejects non-http schemes and garbage', () => {
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});
