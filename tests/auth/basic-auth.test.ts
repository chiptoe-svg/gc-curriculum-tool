import { describe, it, expect } from 'vitest';
import { requiresBasicAuth, authorizedForBasicAuth } from '@/lib/auth/basic-auth';

describe('requiresBasicAuth', () => {
  it.each([
    '/capture',
    '/capture/GC-4800',
    '/explore',
    '/explore/something',
    '/program',
    '/program/coverage',
    '/admin',
    '/admin/courses',
    '/settings',
    '/api/courses/GC-4800/materials',
    '/api/admin/resync',
    '/api/explore/foo',
  ])('gates faculty path %s', (path) => {
    expect(requiresBasicAuth(path)).toBe(true);
  });

  it.each([
    // '/' became public 2026-06-03 (hybrid HTTP/HTTPS landing).
    '/',
    // /view/* is the public read-only profile surface (2026-06-03).
    '/view',
    '/view/GC%204800',
    '/partners',
    '/partners/some-token',
    '/partners/some-token/survey',
    '/api/partners/foo',
    '/api/partners',
    // /api/mcp is self-authenticating via a bearer token (WIKI_MCP_TOKEN),
    // so the faculty Basic Auth middleware skips it.
    '/api/mcp',
    '/api/mcp/anything',
  ])('does NOT gate public path %s', (path) => {
    expect(requiresBasicAuth(path)).toBe(false);
  });

  it('treats /partnerships as faculty (does not match /partners prefix exactly)', () => {
    // Guard against accidental prefix bleed: /partnerships is not /partners
    expect(requiresBasicAuth('/partnerships')).toBe(true);
    expect(requiresBasicAuth('/previewer')).toBe(true);
  });

  it('gates the removed /preview surface (no longer in PUBLIC_PREFIXES)', () => {
    // The /preview M-trial surface was removed 2026-06-02. Its allowlist
    // entries were dropped so a future re-add can't be silently public.
    expect(requiresBasicAuth('/preview')).toBe(true);
    expect(requiresBasicAuth('/preview/abc')).toBe(true);
    expect(requiresBasicAuth('/api/preview')).toBe(true);
    expect(requiresBasicAuth('/api/preview/bar')).toBe(true);
  });
});

describe('authorizedForBasicAuth', () => {
  const expected = 'faculty:hunter2';

  it('accepts a correctly-encoded credential', () => {
    const b64 = btoa(expected);
    expect(authorizedForBasicAuth(`Basic ${b64}`, expected)).toBe(true);
  });

  it('accepts a credential with leading/trailing whitespace in the header value', () => {
    const b64 = btoa(expected);
    expect(authorizedForBasicAuth(`Basic ${b64}  `, expected)).toBe(true);
  });

  it('accepts case-insensitively on the scheme name', () => {
    const b64 = btoa(expected);
    expect(authorizedForBasicAuth(`basic ${b64}`, expected)).toBe(true);
    expect(authorizedForBasicAuth(`BASIC ${b64}`, expected)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const b64 = btoa('faculty:wrong');
    expect(authorizedForBasicAuth(`Basic ${b64}`, expected)).toBe(false);
  });

  it('rejects a wrong username', () => {
    const b64 = btoa('admin:hunter2');
    expect(authorizedForBasicAuth(`Basic ${b64}`, expected)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(authorizedForBasicAuth(null, expected)).toBe(false);
    expect(authorizedForBasicAuth(undefined, expected)).toBe(false);
    expect(authorizedForBasicAuth('', expected)).toBe(false);
  });

  it('rejects a non-Basic scheme', () => {
    const b64 = btoa(expected);
    expect(authorizedForBasicAuth(`Bearer ${b64}`, expected)).toBe(false);
  });

  it('rejects a malformed base64 payload', () => {
    expect(authorizedForBasicAuth('Basic !!!not-base64!!!', expected)).toBe(false);
  });

  it('rejects an empty payload after the scheme', () => {
    expect(authorizedForBasicAuth('Basic ', expected)).toBe(false);
    expect(authorizedForBasicAuth('Basic    ', expected)).toBe(false);
  });
});
