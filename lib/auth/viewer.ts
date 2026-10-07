/**
 * Server-side "who is viewing this page" helper (F1, owner decision
 * 2026-10-07): flag resolution, program-coverage refresh, and AI model
 * settings stay admin-only, enforced server-side already — this helper
 * lets the PAGE hide those controls for a non-admin viewer instead of
 * letting the button 403 in front of them.
 *
 * Resolves the viewer EXACTLY the way lib/auth/gate.ts does for a live
 * request: (1) an `Authorization: Basic` header against the current
 * FACULTY_BASIC_AUTH/CREATE_ONLY_AUTH env values → a built-in grant, or
 * else (2) a verified `gc_session` cookie → grantFromSessionCookie/
 * findGrantById. Both are credential-bearing headers already relied on
 * everywhere else in this app (never a generic client-settable header
 * like X-Forwarded-*, which carries no auth meaning here). Any failure —
 * no credential, a dead/tampered cookie, a DB error — resolves to the
 * fully-denied `ViewerAccess`, never a thrown error and never "admin" by
 * default. Fails closed, always.
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
import type { Grant } from '@/lib/auth/authorize';
import {
  SESSION_COOKIE,
  builtinGrant as realBuiltinGrant,
  findGrantById as realFindGrantById,
  grantFromSessionCookie as realGrantFromSessionCookie,
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
 * `headersLike` is anything with a `.get(name)` — pass the result of
 * Next's `headers()` directly from a server component or route handler.
 */
export async function getViewerAccess(
  headersLike: { get(name: string): string | null },
  deps: ViewerAccessDeps = defaultDeps,
): Promise<ViewerAccess> {
  try {
    const role = resolveRole(headersLike.get('authorization'), {
      faculty: process.env.FACULTY_BASIC_AUTH,
      creator: process.env.CREATE_ONLY_AUTH,
    });
    if (role) {
      const credential = role === 'faculty' ? process.env.FACULTY_BASIC_AUTH : process.env.CREATE_ONLY_AUTH;
      if (credential) {
        return toAccess(deps.builtinGrant(role, credential, process.env.SESSION_SECRET?.trim() || undefined));
      }
    }

    const raw = sessionCookieValue(headersLike.get('cookie'));
    if (!raw) return DENIED;

    const grant = await deps.grantFromSessionCookie(raw, {
      findGrantById: deps.findGrantById,
      env: {
        sessionSecret: process.env.SESSION_SECRET?.trim() || undefined,
        faculty: process.env.FACULTY_BASIC_AUTH,
        creator: process.env.CREATE_ONLY_AUTH,
      },
    });
    if (!grant || grant === 'dead') return DENIED;
    return toAccess(grant);
  } catch {
    return DENIED;
  }
}
