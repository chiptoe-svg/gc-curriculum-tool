/**
 * Server-side "who is viewing this page" helper (F1, owner decision
 * 2026-10-07): flag resolution, program-coverage refresh, and AI model
 * settings stay admin-only, enforced server-side already — this helper
 * lets the PAGE hide those controls for a non-admin viewer instead of
 * letting the button 403 in front of them.
 *
 * Resolves the viewer EXACTLY the way lib/auth/gate.ts does for a live
 * request: a live `gc_session` cookie wins (via `grantFromSessionCookie`/
 * `findGrantById`); `Authorization: Basic` against the current
 * FACULTY_BASIC_AUTH/CREATE_ONLY_AUTH env values is consulted only when
 * there is no live cookie. Both are credential-bearing headers already
 * relied on everywhere else in this app (never a generic client-settable
 * header like X-Forwarded-*, which carries no auth meaning here). Any
 * failure — no credential, a dead/tampered cookie, a DB error — resolves
 * to the fully-denied `ViewerAccess`, never a thrown error and never
 * "admin" by default. Fails closed, always.
 *
 * The cookie-before-Basic ORDER is the shared `pickActiveGrant`
 * (lib/auth/grants.ts), the same function `gate()` uses for its own
 * cookie-vs-Basic decision (security re-review G1, 2026-10-07 — this file
 * previously checked Basic first, the reverse of `gate()`, which hid the
 * admin controls from the owner whenever their browser also held the
 * cached department Basic password alongside their personal admin
 * cookie). Centralizing the order in one function means the two call
 * sites can't drift apart again.
 *
 * `deps` is injectable (defaults to the real lib/auth/grants functions) so
 * tests can exercise failure paths — e.g. the DB throwing while resolving
 * the session cookie — the same way tests/auth/gate.test.ts does for
 * gate(), via a fake dependency rather than module-mocking lib/auth/grants
 * (module-mocking a function re-exported unchanged via `{...actual}` and
 * then rejecting it tripped an unrelated Vitest/importActual artifact that
 * reported the rejection as unhandled even though it was caught — DI
 * sidesteps that entirely and matches the existing gate() test style).
 */
import { resolveRole } from '@/lib/auth/basic-auth';
import { authEnv } from '@/lib/auth/auth-env';
import type { Grant } from '@/lib/auth/authorize';
import {
  SESSION_COOKIE,
  builtinGrant as realBuiltinGrant,
  findGrantById as realFindGrantById,
  grantFromSessionCookie as realGrantFromSessionCookie,
  pickActiveGrant,
  type BuiltinRole,
} from '@/lib/auth/grants';

export interface ViewerAccess {
  isAdmin: boolean;
  scope: string[];
  can: Grant['can'];
}

export interface ViewerAccessDeps {
  findGrantById: typeof realFindGrantById;
  grantFromSessionCookie: typeof realGrantFromSessionCookie;
  builtinGrant: (role: BuiltinRole, credential: string, secret: string | undefined) => Grant;
}

const defaultDeps: ViewerAccessDeps = {
  findGrantById: realFindGrantById,
  grantFromSessionCookie: realGrantFromSessionCookie,
  builtinGrant: realBuiltinGrant,
};

const DENIED: ViewerAccess = { isAdmin: false, scope: [], can: [] };

function toAccess(grant: Grant): ViewerAccess {
  return {
    isAdmin: grant.scope.includes('*') && grant.can.includes('admin'),
    scope: grant.scope,
    can: grant.can,
  };
}

/** Extracts `gc_session=<value>` from a raw `Cookie` header, matching the
 * same parse lib/sandbox/access.ts's resolveGrantSession uses (decode once;
 * undecodable → absent, not a crash). */
function sessionCookieValue(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const m = cookieHeader.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
  if (!m?.[1]) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}

/**
 * The grant a request carries, resolved exactly as gate() resolves it: a live
 * `gc_session` cookie wins; `Authorization: Basic` (the shared department
 * credential) is consulted only when there is no live cookie AND
 * DEPARTMENT_LOGIN is on. With DEPARTMENT_LOGIN=off a built-in cookie is dead
 * and Basic is ignored (spec 2026-10-08). null on no credential or ANY
 * failure — never throws, never a default grant. Used by the routes that sit
 * outside the middleware matcher (or that need the caller's capabilities) so
 * they authorize with the same grant + authorize() rules as the gate and
 * fail closed when no credential env is set.
 */
export async function getRequestGrant(
  headersLike: { get(name: string): string | null },
  deps: ViewerAccessDeps = defaultDeps,
): Promise<Grant | null> {
  try {
    const env = authEnv();
    const raw = sessionCookieValue(headersLike.get('cookie'));
    const cookieGrant = raw
      ? await deps.grantFromSessionCookie(raw, { findGrantById: deps.findGrantById, env })
      : null;

    let basicGrant: Grant | null = null;
    if (env.departmentLogin) {
      const role = resolveRole(headersLike.get('authorization'), { faculty: env.faculty, creator: env.creator });
      const credential = role === 'faculty' ? env.faculty : role === 'creator' ? env.creator : undefined;
      if (role && credential) basicGrant = deps.builtinGrant(role, credential, env.sessionSecret);
    }

    return pickActiveGrant(cookieGrant, basicGrant).grant;
  } catch {
    return null;
  }
}

/**
 * `headersLike` is anything with a `.get(name)` — pass the result of
 * Next's `headers()` directly from a server component or route handler.
 */
export async function getViewerAccess(
  headersLike: { get(name: string): string | null },
  deps: ViewerAccessDeps = defaultDeps,
): Promise<ViewerAccess> {
  const grant = await getRequestGrant(headersLike, deps);
  return grant ? toAccess(grant) : DENIED;
}
