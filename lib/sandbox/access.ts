import { isValidSlug } from '@/lib/slug';
import { authorizedForBearer } from '@/lib/auth/bearer';
import { getGrantById, isGrantValid } from '@/lib/sandbox/grants';
import { lookupScopedSession, SCOPED_SESSION_COOKIE } from '@/lib/sandbox/sessions';
import { isProgramVisible, type CourseVisibilityFields } from '@/lib/courses/program-visibility';
import { authorize, classify } from '@/lib/auth/authorize';
import { findGrantById, grantFromSessionCookie, SESSION_COOKIE as GRANT_SESSION_COOKIE } from '@/lib/auth/grants';

/**
 * Operator override credential — presented as `Authorization: Bearer <token>`
 * (ADMIN_TOKEN or the faculty slug). NEVER read from the URL query: these are
 * public routes, so a query secret would leak via access logs + the Referer
 * header. Header-only, matching lib/auth/admin-auth.ts's Bearer transition.
 */
function operatorBearerOk(req: { headers: { get(name: string): string | null } }): boolean {
  const header = req.headers.get('authorization');
  if (authorizedForBearer(header, process.env.ADMIN_TOKEN?.trim())) return true;
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return isValidSlug(header.slice(7).trim());
  }
  return false;
}

/** /api/courses/<c>/<seg> segments a scoped tester may use. Everything else
 *  under /api/courses (canvas-import, canvas-reextract, sync-from-sheet, the
 *  bare resource) is blocked. The /api/capture/<c>/* namespace is allowed whole. */
const COURSE_API_ALLOWLIST = new Set([
  'materials', 'imscc-import', 'kuds', 'scan-linked-docs', 'checkin', 'analyze-materials', 'parse-profile',
]);

/**
 * The course a scoped session must be bound to for `pathname` to be allowed,
 * or null if the path is never scoped-accessible. PURE (no DB) — the security
 * allowlist. Course codes contain spaces, URL-encoded as %20.
 *
 * SECURITY NOTE: this is the FIRST of two gates — the destination route/page
 * independently re-checks `authorizeCourseWrite(req, params.code, slug)` against
 * its OWN normalized course code, so a path-parse trick that fools this function
 * still can't grant access. That defense-in-depth holds ONLY while there is no
 * catch-all route (`[...rest]/route.ts`) under /api/courses/[code] or
 * /api/capture/[code]. If you ever add one, it MUST call `authorizeCourseWrite`
 * itself — do not rely on this allowlist alone.
 */
export function courseFromScopedPath(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean);
  const dec = (s: string) => decodeURIComponent(s);

  if (segs[0] === 'capture' && segs.length >= 2 && segs[1]) return dec(segs[1]);

  if (segs[0] === 'api') {
    if (segs[1] === 'capture' && segs.length >= 3 && segs[2]) return dec(segs[2]);
    if (segs[1] === 'courses' && segs.length >= 4 && segs[2] && segs[3] && COURSE_API_ALLOWLIST.has(segs[3])) {
      return dec(segs[2]);
    }
  }
  return null;
}

/**
 * The two upload routes EXCLUDED from the middleware matcher (see
 * middleware.ts `config.matcher`) whose inline auth consults
 * resolveScopedSession in place of Basic. Exact paths — no trailing slash, no
 * sub-paths (those still pass through middleware + gate()).
 */
const EXCLUDED_UPLOAD_ROUTE = /^\/api\/courses\/([^/]+)\/(?:materials|imscc-import)$/;

/**
 * Scoped-access-link holders on the matcher-excluded upload routes
 * (2026-09-30 final review, I3b). Those routes never see gate(), so resolve
 * the `gc_session` cookie here and run it through the SAME scope table
 * (`authorize`): only a live grant whose classification is a course write it
 * is allowed on binds, to the route's own (decoded, un-normalised) [code].
 * Any failure — no url, bad MAC, dead grant, DB error — is null (the route
 * then falls back to Basic Auth, i.e. fails closed).
 */
async function resolveGrantSession(
  req: { headers: { get(name: string): string | null }; url?: string; method?: string },
): Promise<{ courseCode: string; instructorName: string } | null> {
  if (!req.url || !req.method) return null;
  let pathname: string;
  try { pathname = new URL(req.url).pathname; } catch { return null; }
  const route = EXCLUDED_UPLOAD_ROUTE.exec(pathname);
  if (!route?.[1]) return null;
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|; )${GRANT_SESSION_COOKIE}=([^;]+)`));
  if (!m?.[1]) return null;
  try {
    const grant = await grantFromSessionCookie(m[1], {
      findGrantById,
      env: {
        sessionSecret: process.env.SESSION_SECRET?.trim() || undefined,
        faculty: process.env.FACULTY_BASIC_AUTH,
        creator: process.env.CREATE_ONLY_AUTH,
      },
    });
    if (!grant || grant === 'dead') return null;
    if (classify(req.method, pathname).kind !== 'course-write') return null;
    if (!authorize(grant, req.method, pathname).ok) return null;
    return { courseCode: decodeURIComponent(route[1]), instructorName: grant.label };
  } catch {
    return null;
  }
}

/** Read the scoped-session cookie, validate the session AND its grant, return
 * the binding. Falls back to a scoped-access-link `gc_session` cookie on the
 * matcher-excluded upload routes (resolveGrantSession). */
export async function resolveScopedSession(
  req: { headers: { get(name: string): string | null }; url?: string; method?: string },
): Promise<{ courseCode: string; instructorName: string } | null> {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|; )${SCOPED_SESSION_COOKIE}=([^;]+)`));
  if (m && m[1]) {
    const sess = await lookupScopedSession(m[1]);
    if (sess) {
      const grant = await getGrantById(sess.grantId);
      if (grant && isGrantValid(grant)) return { courseCode: sess.courseCode, instructorName: sess.instructorName };
    }
  }
  return resolveGrantSession(req);
}

/**
 * Write/capture authorization for a course-scoped route, used in place of the
 * bare `isValidSlug(slug)` check. True if the faculty slug is valid OR a scoped
 * session is bound to exactly this course. The scoped path NEVER materializes
 * the faculty slug (it's a client-exposed credential), so a bound tester
 * authorizes via their session cookie without the slug ever being injected.
 */
export async function authorizeCourseWrite(
  req: { headers: { get(name: string): string | null } },
  code: string,
  slug: string,
): Promise<boolean> {
  if (isValidSlug(slug)) return true;
  const sess = await resolveScopedSession(req);
  return sess?.courseCode === code;
}

/**
 * Read gate for /view, /okf, /okf-bundle. Readable if the course is program-
 * visible, OR the operator presents a valid `Authorization: Bearer` credential
 * (header-only — never a URL query, since these are public routes where a query
 * secret leaks via logs + Referer; lets the operator open/bundle a sandbox
 * course via a Bearer fetch), OR the requester holds a scoped session bound to
 * exactly this course (the tester reviewing their own).
 */
export async function isCourseReadableBy(
  req: { headers: { get(name: string): string | null } },
  course: CourseVisibilityFields & { code: string },
): Promise<boolean> {
  if (isProgramVisible(course)) return true;
  if (operatorBearerOk(req)) return true; // operator override, header-only
  const sess = await resolveScopedSession(req);
  return sess?.courseCode === course.code;
}
