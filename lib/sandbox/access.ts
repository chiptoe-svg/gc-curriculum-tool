import { isValidSlug } from '@/lib/slug';
import { getGrantById, isGrantValid } from '@/lib/sandbox/grants';
import { lookupScopedSession, SCOPED_SESSION_COOKIE } from '@/lib/sandbox/sessions';
import { isProgramVisible, type CourseVisibilityFields } from '@/lib/courses/program-visibility';

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

/** Read the scoped-session cookie, validate the session AND its grant, return the binding. */
export async function resolveScopedSession(
  req: { headers: { get(name: string): string | null } },
): Promise<{ courseCode: string; instructorName: string } | null> {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|; )${SCOPED_SESSION_COOKIE}=([^;]+)`));
  if (!m || !m[1]) return null;
  const sess = await lookupScopedSession(m[1]);
  if (!sess) return null;
  const grant = await getGrantById(sess.grantId);
  if (!grant || !isGrantValid(grant)) return null;
  return { courseCode: sess.courseCode, instructorName: sess.instructorName };
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
 * visible, OR the operator presents a valid faculty `slug` (the operator HAS it
 * and uses it on every faculty surface — this lets them open + bundle a sandbox
 * course they're reviewing; testers never have the slug), OR the requester holds
 * a scoped session bound to exactly this course.
 */
export async function isCourseReadableBy(
  req: { headers: { get(name: string): string | null } },
  course: CourseVisibilityFields & { code: string },
  slug?: string,
): Promise<boolean> {
  if (isProgramVisible(course)) return true;
  if (slug && isValidSlug(slug)) return true; // operator (faculty-slug) override
  const sess = await resolveScopedSession(req);
  return sess?.courseCode === course.code;
}
