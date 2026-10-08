// @vitest-environment node
/**
 * DEPARTMENT_LOGIN switch (spec 2026-10-08 §2) at every layer that resolves a
 * credential: the env parser, grantFromSessionCookie, getRequestGrant /
 * getViewerAccess, and the real middleware wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/partners/sessions', () => ({ SESSION_COOKIE: 'gc_partner', createSession: vi.fn() }));

import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { departmentLoginEnabled, resetDepartmentLoginWarning } from '@/lib/auth/auth-env';
import { grantFromSessionCookie, signSession } from '@/lib/auth/grants';
import { getRequestGrant, getViewerAccess } from '@/lib/auth/viewer';
import { middleware } from '@/middleware';

const SECRET = 'x'.repeat(32);
const FACULTY = 'gcfaculty:godfrey';
const fp = (cred: string) => createHmac('sha256', SECRET).update(cred).digest('hex').slice(0, 16);
const builtinId = `builtin:faculty:${fp(FACULTY)}`;
const basic = (s: string) => 'Basic ' + Buffer.from(s).toString('base64');
const hdrs = (h: Record<string, string>) => new Headers(h);

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('departmentLoginEnabled', () => {
  beforeEach(() => resetDepartmentLoginWarning());
  it('only the exact value "off" disables it', () => {
    expect(departmentLoginEnabled('off')).toBe(false);
    expect(departmentLoginEnabled(undefined)).toBe(true);
    expect(departmentLoginEnabled('')).toBe(true);
    expect(departmentLoginEnabled('on')).toBe(true);
  });
  it('any other value stays enabled and logs a warning (once)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(departmentLoginEnabled('offf')).toBe(true);
    expect(departmentLoginEnabled('maybe')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('on / unset never warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    departmentLoginEnabled('on'); departmentLoginEnabled(undefined);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('grantFromSessionCookie', () => {
  const deps = (departmentLogin?: boolean) => ({
    findGrantById: async () => null,
    env: { sessionSecret: SECRET, faculty: FACULTY, departmentLogin },
  });
  it('built-in cookie is live when on / unset', async () => {
    expect(await grantFromSessionCookie(signSession(builtinId, SECRET), deps())).toMatchObject({ id: builtinId });
    expect(await grantFromSessionCookie(signSession(builtinId, SECRET), deps(true))).toMatchObject({ id: builtinId });
  });
  it('built-in cookie is dead when off', async () => {
    expect(await grantFromSessionCookie(signSession(builtinId, SECRET), deps(false))).toBe('dead');
  });
});

describe('getRequestGrant / getViewerAccess', () => {
  beforeEach(() => { vi.stubEnv('SESSION_SECRET', SECRET); vi.stubEnv('FACULTY_BASIC_AUTH', FACULTY); });
  it('on: Basic and the built-in cookie resolve to the department grant', async () => {
    expect((await getRequestGrant(hdrs({ authorization: basic(FACULTY) })))?.label).toBe('Department login');
    expect((await getRequestGrant(hdrs({ cookie: `gc_session=${signSession(builtinId, SECRET)}` })))?.label).toBe('Department login');
  });
  it('off: Basic and the built-in cookie resolve to nothing', async () => {
    vi.stubEnv('DEPARTMENT_LOGIN', 'off');
    expect(await getRequestGrant(hdrs({ authorization: basic(FACULTY) }))).toBeNull();
    expect(await getRequestGrant(hdrs({ cookie: `gc_session=${signSession(builtinId, SECRET)}` }))).toBeNull();
    expect(await getViewerAccess(hdrs({ authorization: basic(FACULTY) }))).toEqual({ isAdmin: false, scope: [], can: [] });
  });
  it('no credential env at all: Basic is not a credential (fails closed)', async () => {
    vi.stubEnv('FACULTY_BASIC_AUTH', undefined as unknown as string);
    vi.stubEnv('SESSION_SECRET', undefined as unknown as string);
    expect(await getRequestGrant(hdrs({ authorization: basic(FACULTY) }))).toBeNull();
  });
});

describe('middleware wiring', () => {
  const reqFor = (path: string, h: Record<string, string> = {}, method = 'GET') =>
    new NextRequest(`http://localhost${path}`, { method, headers: h });
  beforeEach(() => { vi.stubEnv('SESSION_SECRET', SECRET); vi.stubEnv('FACULTY_BASIC_AUTH', FACULTY); });

  it('on (unset): Basic faculty reaches a gated page', async () => {
    expect((await middleware(reqFor('/capture/GC%201040', { authorization: basic(FACULTY) }))).status).toBe(200);
  });
  it('off: Basic faculty on a page → 401 sign-in page, no WWW-Authenticate', async () => {
    vi.stubEnv('DEPARTMENT_LOGIN', 'off');
    const res = await middleware(reqFor('/capture/GC%201040', { authorization: basic(FACULTY) }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.text()).toContain('Sign in with your link');
  });
  it('off: Basic faculty on an API → 401 JSON, no WWW-Authenticate', async () => {
    vi.stubEnv('DEPARTMENT_LOGIN', 'off');
    const res = await middleware(reqFor('/api/capture/GC%201040/context', { authorization: basic(FACULTY) }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(res.headers.get('content-type')).toContain('application/json');
  });
  it('off: a built-in cookie is cleared on the response', async () => {
    vi.stubEnv('DEPARTMENT_LOGIN', 'off');
    const res = await middleware(reqFor('/courses', { cookie: `gc_session=${signSession(builtinId, SECRET)}` }));
    expect(res.status).toBe(401);
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/gc_session=;/);
    expect(set).toMatch(/Max-Age=0/i);
  });
  it('off: SIGNIN_CONTACT reaches the sign-in page', async () => {
    vi.stubEnv('DEPARTMENT_LOGIN', 'off');
    vi.stubEnv('SIGNIN_CONTACT', 'the GC office');
    const res = await middleware(reqFor('/program'));
    expect(await res.text()).toContain('Email the GC office for a new one.');
  });
  it('a junk DEPARTMENT_LOGIN value keeps today’s behavior', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('DEPARTMENT_LOGIN', 'maybe');
    expect((await middleware(reqFor('/capture/GC%201040', { authorization: basic(FACULTY) }))).status).toBe(200);
  });
});
