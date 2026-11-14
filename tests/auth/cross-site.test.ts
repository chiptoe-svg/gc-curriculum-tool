import { describe, it, expect, afterEach } from 'vitest';
import { isCrossSiteRequest } from '@/lib/auth/cross-site';

const mk = (headers: Record<string, string>) => new Request('http://app.test/api/x', { method: 'POST', headers });
const saved = process.env.PUBLIC_HTTPS_ORIGIN;
afterEach(() => { if (saved === undefined) delete process.env.PUBLIC_HTTPS_ORIGIN; else process.env.PUBLIC_HTTPS_ORIGIN = saved; });

describe('isCrossSiteRequest', () => {
  it.each(['cross-site', 'same-site'])('sec-fetch-site %s is cross-site', v =>
    expect(isCrossSiteRequest(mk({ 'sec-fetch-site': v }))).toBe(true));
  it('same-origin with a matching origin is not', () =>
    expect(isCrossSiteRequest(mk({ 'sec-fetch-site': 'same-origin', origin: 'http://app.test', host: 'app.test' }))).toBe(false));
  it('none with no origin is not', () =>
    expect(isCrossSiteRequest(mk({ 'sec-fetch-site': 'none' }))).toBe(false));
  it('no headers at all is not', () => expect(isCrossSiteRequest(mk({}))).toBe(false));
  it('a different origin is', () =>
    expect(isCrossSiteRequest(mk({ origin: 'https://evil.test', host: 'app.test' }))).toBe(true));
  it('an unparseable origin is', () =>
    expect(isCrossSiteRequest(mk({ origin: 'not a url', host: 'app.test' }))).toBe(true));
  it('falls back to the request URL host when there is no host header', () =>
    expect(isCrossSiteRequest(new Request('http://app.test/x', { method: 'POST', headers: { origin: 'http://app.test' } }))).toBe(false));
  it('PUBLIC_HTTPS_ORIGIN host is accepted', () => {
    process.env.PUBLIC_HTTPS_ORIGIN = 'https://pub.test:8443';
    expect(isCrossSiteRequest(mk({ origin: 'https://pub.test:8443', host: '127.0.0.1:3000' }))).toBe(false);
    expect(isCrossSiteRequest(mk({ origin: 'https://evil.test', host: '127.0.0.1:3000' }))).toBe(true);
  });
});
