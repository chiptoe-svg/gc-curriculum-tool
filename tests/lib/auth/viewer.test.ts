import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { getViewerAccess, type ViewerAccessDeps } from '@/lib/auth/viewer';
import { signSession, builtinGrant, grantFromSessionCookie, type StoredGrant } from '@/lib/auth/grants';

/**
 * F1 (owner decision, 2026-10-07): flag resolution, program-coverage
 * refresh, and AI model settings stay admin-only. getViewerAccess resolves
 * the viewer the same way gate() does, server-side, so /program and
 * /settings can hide the controls for non-admins instead of letting the
 * buttons 403 in front of them.
 *
 * Uses the REAL grantFromSessionCookie/builtinGrant but a FAKE
 * findGrantById (dependency-injected, same style tests/auth/gate.test.ts
 * uses for gate()) — not module-mocking, which for this module tripped an
 * unrelated Vitest/importActual artifact around rejected promises.
 */

const SECRET = 's'.repeat(32);
const FACULTY = 'gcfaculty:pw';
const CREATOR = 'creator:pw';

function headersWith(opts: { authorization?: string; cookie?: string }): { get(name: string): string | null } {
  return {
    get(name: string) {
      const n = name.toLowerCase();
      if (n === 'authorization') return opts.authorization ?? null;
      if (n === 'cookie') return opts.cookie ?? null;
      return null;
    },
  };
}
function basic(cred: string): string {
  return 'Basic ' + Buffer.from(cred).toString('base64');
}
function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k]; }
  return fn().finally(() => { for (const k of Object.keys(env)) process.env[k] = prev[k]; });
}

const adminGrant: StoredGrant = {
  id: '33333333-3333-4333-8333-333333333333', label: 'Owner — admin', scope: ['*'], can: ['capture', 'create', 'admin'],
  expiresAt: null, revokedAt: null, lastUsedAt: null,
};
const scopedGrant: StoredGrant = {
  id: '11111111-1111-4111-8111-111111111111', label: 'Danita', scope: ['GC 3730'], can: ['capture'],
  expiresAt: null, revokedAt: null, lastUsedAt: null,
};

function depsWith(findGrantById: ViewerAccessDeps['findGrantById']): ViewerAccessDeps {
  return { findGrantById, grantFromSessionCookie, builtinGrant };
}
const neverCalled: ViewerAccessDeps['findGrantById'] = async () => {
  throw new Error('findGrantById should not have been called');
};

describe('getViewerAccess', () => {
  it('denies with no credential at all', async () => {
    const out = await getViewerAccess(headersWith({}), depsWith(neverCalled));
    expect(out).toEqual({ isAdmin: false, scope: [], can: [] });
  });

  it('Basic faculty → capture+create, not admin (department login lost admin, 2026-10-07)', async () => {
    const out = await withEnv({ FACULTY_BASIC_AUTH: FACULTY, CREATE_ONLY_AUTH: CREATOR, SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ authorization: basic(FACULTY) }), depsWith(neverCalled)));
    expect(out).toEqual({ isAdmin: false, scope: ['*'], can: ['capture', 'create'] });
  });

  it('Basic creator → create only, not admin', async () => {
    const out = await withEnv({ FACULTY_BASIC_AUTH: FACULTY, CREATE_ONLY_AUTH: CREATOR, SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ authorization: basic(CREATOR) }), depsWith(neverCalled)));
    expect(out).toEqual({ isAdmin: false, scope: [], can: ['create'] });
  });

  it('a wrong Basic credential is not authorization — falls through to denied (no cookie present)', async () => {
    const out = await withEnv({ FACULTY_BASIC_AUTH: FACULTY, CREATE_ONLY_AUTH: CREATOR, SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ authorization: basic('wrong:wrong') }), depsWith(neverCalled)));
    expect(out).toEqual({ isAdmin: false, scope: [], can: [] });
  });

  it('a verified gc_session cookie for an admin-capable DB grant → isAdmin true', async () => {
    const cookie = `gc_session=${signSession(adminGrant.id, SECRET)}`;
    const out = await withEnv({ SESSION_SECRET: SECRET, FACULTY_BASIC_AUTH: FACULTY, CREATE_ONLY_AUTH: CREATOR }, () =>
      getViewerAccess(headersWith({ cookie }), depsWith(async (id) => (id === adminGrant.id ? adminGrant : null))));
    expect(out).toEqual({ isAdmin: true, scope: ['*'], can: ['capture', 'create', 'admin'] });
  });

  it('a verified gc_session cookie for a scoped (non-admin) grant → isAdmin false', async () => {
    const cookie = `gc_session=${signSession(scopedGrant.id, SECRET)}`;
    const out = await withEnv({ SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ cookie }), depsWith(async (id) => (id === scopedGrant.id ? scopedGrant : null))));
    expect(out).toEqual({ isAdmin: false, scope: ['GC 3730'], can: ['capture'] });
  });

  it('a tampered cookie is treated as absent → denied (never reaches findGrantById)', async () => {
    const cookie = `gc_session=${adminGrant.id}.bad`;
    const out = await withEnv({ SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ cookie }), depsWith(neverCalled)));
    expect(out).toEqual({ isAdmin: false, scope: [], can: [] });
  });

  it('a revoked grant behind a valid cookie → denied', async () => {
    const cookie = `gc_session=${signSession(adminGrant.id, SECRET)}`;
    const out = await withEnv({ SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ cookie }), depsWith(async () => ({ ...adminGrant, revokedAt: new Date('2020-01-01') }))));
    expect(out).toEqual({ isAdmin: false, scope: [], can: [] });
  });

  it('a built-in cookie (builtin:faculty:<fp>) resolves via current env, not admin', async () => {
    const fp = createHmac('sha256', SECRET).update(FACULTY).digest('hex').slice(0, 16);
    const cookie = `gc_session=${signSession(`builtin:faculty:${fp}`, SECRET)}`;
    const out = await withEnv({ SESSION_SECRET: SECRET, FACULTY_BASIC_AUTH: FACULTY, CREATE_ONLY_AUTH: CREATOR }, () =>
      getViewerAccess(headersWith({ cookie }), depsWith(neverCalled)));
    expect(out).toEqual({ isAdmin: false, scope: ['*'], can: ['capture', 'create'] });
  });

  it('DB failure resolving the cookie fails CLOSED (isAdmin false), never throws', async () => {
    const cookie = `gc_session=${signSession(adminGrant.id, SECRET)}`;
    const out = await withEnv({ SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ cookie }), depsWith(async () => { throw new Error('db down'); })));
    expect(out).toEqual({ isAdmin: false, scope: [], can: [] });
  });

  it('a malformed cookie header never throws', async () => {
    const out = await withEnv({ SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ cookie: 'gc_session=%ZZ' }), depsWith(neverCalled)));
    expect(out).toEqual({ isAdmin: false, scope: [], can: [] });
  });

  it('Basic auth is used when the cookie present is not a gc_session cookie at all', async () => {
    const out = await withEnv({ FACULTY_BASIC_AUTH: FACULTY, SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ authorization: basic(FACULTY), cookie: 'some_other_cookie=x' }), depsWith(neverCalled)));
    expect(out.can).toEqual(['capture', 'create']);
  });

  // G1 (security re-review, 2026-10-07): getViewerAccess must resolve in
  // the SAME order as gate() — a live gc_session cookie wins; Basic is
  // used only when there is no live cookie. Scenario: the owner signs in
  // via their personal admin link (sets the cookie) in a browser that also
  // has the department Basic password cached, so BOTH headers arrive on
  // every gated request. gate() already resolves this to the owner's
  // admin grant (cookie first); getViewerAccess must match, or it hides
  // the admin controls from the one person who should see them.
  it('owner admin cookie + department Basic header together → isAdmin true (cookie wins)', async () => {
    const cookie = `gc_session=${signSession(adminGrant.id, SECRET)}`;
    const out = await withEnv({ FACULTY_BASIC_AUTH: FACULTY, CREATE_ONLY_AUTH: CREATOR, SESSION_SECRET: SECRET }, () =>
      getViewerAccess(
        headersWith({ authorization: basic(FACULTY), cookie }),
        depsWith(async (id) => (id === adminGrant.id ? adminGrant : null)),
      ));
    expect(out).toEqual({ isAdmin: true, scope: ['*'], can: ['capture', 'create', 'admin'] });
  });

  it('a DEAD cookie (tampered) plus department Basic together still falls through to Basic (not admin)', async () => {
    const cookie = `gc_session=${adminGrant.id}.bad`;
    const out = await withEnv({ FACULTY_BASIC_AUTH: FACULTY, CREATE_ONLY_AUTH: CREATOR, SESSION_SECRET: SECRET }, () =>
      getViewerAccess(headersWith({ authorization: basic(FACULTY), cookie }), depsWith(neverCalled)));
    expect(out).toEqual({ isAdmin: false, scope: ['*'], can: ['capture', 'create'] });
  });

  it('calling with no deps override uses the real functions (defaults wired correctly) and still denies with no credential', async () => {
    const out = await getViewerAccess(headersWith({}));
    expect(out).toEqual({ isAdmin: false, scope: [], can: [] });
  });

  it('sanity: builtinGrant itself never includes admin for faculty (regression pin)', () => {
    expect(builtinGrant('faculty', FACULTY, SECRET).can).not.toContain('admin');
  });
});
