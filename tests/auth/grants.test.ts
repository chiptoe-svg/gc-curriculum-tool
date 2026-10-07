import { createHash, createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { newToken, hashToken, signSession, verifySession, builtinGrant, builtinFromId, credentialFingerprint, isLive, cookieMaxAge, MAX_COOKIE_AGE_S } from '@/lib/auth/grants';

describe('tokens', () => {
  it('are 43-char base64url and unique', () => {
    const a = newToken(), b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b);
  });
  it('hash is sha256 hex and stable', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('session cookie', () => {
  const secret = 's'.repeat(32);
  it('round-trips', () => {
    const v = signSession('11111111-1111-1111-1111-111111111111', secret);
    expect(v).toMatch(/^11111111-1111-1111-1111-111111111111\.[A-Za-z0-9_-]+$/);
    expect(verifySession(v, secret)).toBe('11111111-1111-1111-1111-111111111111');
  });
  it('rejects tampering, wrong secret, garbage, empty', () => {
    const v = signSession('id-1', secret);
    expect(verifySession(v.replace('id-1', 'id-2'), secret)).toBeNull();
    expect(verifySession(v, 'other'.repeat(8))).toBeNull();
    expect(verifySession('nonsense', secret)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession(v, '')).toBeNull();
  });
});

describe('built-ins and liveness', () => {
  it('faculty is department-wide (capture + create, no admin — 2026-10-07 owner-approved), creator is create-only', () => {
    const S = 's'.repeat(32);
    const fp = (c: string) => createHmac('sha256', S).update(c).digest('hex').slice(0, 16);
    expect(builtinGrant('faculty', 'gcfaculty:pw', S)).toEqual({ id: `builtin:faculty:${fp('gcfaculty:pw')}`, label: 'Department login', scope: ['*'], can: ['capture', 'create'] });
    expect(builtinGrant('creator', 'creator:pw', S)).toEqual({ id: `builtin:creator:${fp('creator:pw')}`, label: 'Create-only login', scope: [], can: ['create'] });
    expect(builtinGrant('faculty', 'a:1', S).id).not.toBe(builtinGrant('faculty', 'a:2', S).id);
  });
  it('the credential fingerprint is keyed by SESSION_SECRET (not a bare hash of the password)', () => {
    const a = credentialFingerprint('gcfaculty:pw', 'a'.repeat(32));
    const b = credentialFingerprint('gcfaculty:pw', 'b'.repeat(32));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(a).not.toBe(createHash('sha256').update('gcfaculty:pw').digest('hex').slice(0, 16));
  });
  it('builtinFromId verifies against the same secret it was minted with', () => {
    const S = 's'.repeat(32), env = { faculty: 'gcfaculty:pw', sessionSecret: S };
    const g = builtinGrant('faculty', 'gcfaculty:pw', S);
    expect(builtinFromId(g.id, env)).toEqual(g);
    expect(builtinFromId(g.id, { ...env, sessionSecret: 't'.repeat(32) })).toBeNull();
    expect(builtinFromId(g.id, { ...env, sessionSecret: undefined })).toBeNull();
  });
  it('isLive', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(isLive({ expiresAt: null, revokedAt: null }, now)).toBe(true);
    expect(isLive({ expiresAt: new Date('2026-10-01T00:00:00Z'), revokedAt: null }, now)).toBe(true);
    expect(isLive({ expiresAt: new Date('2026-09-30T11:59:59Z'), revokedAt: null }, now)).toBe(false);
    expect(isLive({ expiresAt: null, revokedAt: new Date('2026-09-29T00:00:00Z') }, now)).toBe(false);
  });
  it('cookieMaxAge caps at 30 days and floors at 0', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(cookieMaxAge({ expiresAt: null }, now)).toBe(MAX_COOKIE_AGE_S);
    expect(cookieMaxAge({ expiresAt: new Date('2026-09-30T13:00:00Z') }, now)).toBe(3600);
    expect(cookieMaxAge({ expiresAt: new Date('2026-09-30T11:00:00Z') }, now)).toBe(0);
  });
});
