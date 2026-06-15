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

/** Read gate for /view, /okf, /okf-bundle. */
export async function isCourseReadableBy(
  req: { headers: { get(name: string): string | null } },
  course: CourseVisibilityFields & { code: string },
): Promise<boolean> {
  if (isProgramVisible(course)) return true;
  const sess = await resolveScopedSession(req);
  return sess?.courseCode === course.code;
}
