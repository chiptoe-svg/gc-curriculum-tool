import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the slug check so the test doesn't depend on PROTOTYPE_SLUG env.
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'the-secret-slug' }));

import { checkAdminAuth } from '@/lib/auth/admin-auth';

function req(opts: { url?: string; auth?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.auth) headers.authorization = opts.auth;
  return new Request(opts.url ?? 'http://x/api/admin/thing', { headers });
}

const ORIG = process.env.ADMIN_TOKEN;
beforeEach(() => { delete process.env.ADMIN_TOKEN; vi.restoreAllMocks(); });
afterEach(() => { if (ORIG === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = ORIG; });

describe('checkAdminAuth', () => {
  it('accepts a Bearer ADMIN_TOKEN when provisioned (timing-safe)', () => {
    process.env.ADMIN_TOKEN = 'tok-abcdefgh';
    expect(checkAdminAuth(req({ auth: 'Bearer tok-abcdefgh' }))).toBe(true);
  });

  it('rejects a wrong Bearer token', () => {
    process.env.ADMIN_TOKEN = 'tok-abcdefgh';
    expect(checkAdminAuth(req({ auth: 'Bearer nope' }))).toBe(false);
  });

  it('accepts the slug carried in the Bearer header (transitional, no ADMIN_TOKEN needed)', () => {
    expect(checkAdminAuth(req({ auth: 'Bearer the-secret-slug' }))).toBe(true);
  });

  it('accepts the legacy ?slug= query fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(checkAdminAuth(req({ url: 'http://x/api/admin/thing?slug=the-secret-slug' }))).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('accepts an explicit body slug fallback (POST routes)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(checkAdminAuth(req(), { slug: 'the-secret-slug' })).toBe(true);
  });

  it('rejects when no header and no valid slug', () => {
    expect(checkAdminAuth(req())).toBe(false);
    expect(checkAdminAuth(req({ url: 'http://x/api/admin/thing?slug=wrong' }))).toBe(false);
    expect(checkAdminAuth(req(), { slug: 'wrong' })).toBe(false);
  });
});
