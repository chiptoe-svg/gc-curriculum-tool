// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { hasJsonContentType } from '../require-json';

function req(contentType?: string) {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) headers['content-type'] = contentType;
  return new Request('http://h/x', { method: 'POST', headers });
}

describe('hasJsonContentType', () => {
  it('accepts application/json, case-insensitively and with a charset param', () => {
    expect(hasJsonContentType(req('application/json'))).toBe(true);
    expect(hasJsonContentType(req('Application/JSON'))).toBe(true);
    expect(hasJsonContentType(req('application/json; charset=utf-8'))).toBe(true);
  });
  it('rejects a missing header, text/plain (the CSRF form vector), and multipart', () => {
    expect(hasJsonContentType(req())).toBe(false);
    expect(hasJsonContentType(req('text/plain'))).toBe(false);
    expect(hasJsonContentType(req('multipart/form-data; boundary=x'))).toBe(false);
    expect(hasJsonContentType(req('application/x-www-form-urlencoded'))).toBe(false);
  });
});
