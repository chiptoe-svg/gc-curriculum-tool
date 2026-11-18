/**
 * The scope table — the single security boundary for faculty writes.
 * Pure: no I/O, no env. See docs/superpowers/specs/2026-09-30-scoped-access-links-design.md.
 */
export type Capability = 'capture' | 'create' | 'admin';
export interface Grant { id: string; label: string; scope: string[]; can: Capability[] }
export type Kind =
  | { kind: 'read' }
  | { kind: 'course-write'; code: string }
  | { kind: 'what-if-write' }
  | { kind: 'plan-write' }
  | { kind: 'create' }
  | { kind: 'admin' };
export type Decision =
  | { ok: true }
  | { ok: false; reason: 'needs-capture' | 'needs-create' | 'needs-admin' | 'out-of-scope'; code?: string };

/** URL-decode ONCE, collapse whitespace, trim, upper-case. Never double-decodes. */
export function normalizeCode(raw: string): string {
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { /* keep raw */ }
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

// Course-bound API families: the [code] is the segment right after the prefix.
const COURSE_WRITE_PREFIXES = ['/api/capture/', '/api/courses/', '/api/explore/', '/api/admin/courses/'];
// The two create paths (same list creatorAllowed enumerates today).
const CREATE_PATHS = new Set(['/courses/new', '/api/admin/courses/roster']);
const ROSTER_BULK = '/api/admin/courses/roster'; // its sub-paths are admin, not create
const ADMIN_COURSES = '/api/admin/courses/';

/**
 * A course code, checked AFTER one percent-decode and with NO normalisation
 * (no trim, no whitespace collapse, no case-fold): so `GC%203730%20`,
 * `gc 3730`, `GC3730` and non-code segments such as `intended-skills` are not
 * course codes and their paths fall through to admin (2026-09-30 final
 * review, I2). Widened from the review's `[A-Z]?` suffix to fit the live
 * `courses.code` data (2026-09-30): subjects of 2–4 capitals (GC, ACCT, PKSC),
 * suffixes of up to two letters in either case (GC 1010L, GC 4900ap,
 * GC 4990ta), plus the generated sandbox namespace `EXT-<8 hex>`.
 *
 * Exported (fix round 2, N2) so lib/curriculum/catalog-lookup.ts can
 * validate a newly-added course code against this exact shape rather than
 * duplicating the pattern.
 */
export const COURSE_CODE = /^(?:[A-Z]{2,4} \d{4}[A-Za-z]{0,2}|EXT-[0-9a-f]{8})$/;

/** The course code a course-prefixed path is bound to (upper-cased for scope
 * comparison), or null when the path is not under a course prefix or its
 * segment is not a strictly-shaped course code. */
function courseOf(path: string): string | null {
  for (const prefix of COURSE_WRITE_PREFIXES) {
    if (path.startsWith(prefix)) {
      const seg = path.slice(prefix.length).split('/')[0] ?? '';
      let decoded: string;
      try { decoded = decodeURIComponent(seg); } catch { return null; }
      return COURSE_CODE.test(decoded) ? decoded.toUpperCase() : null;
    }
  }
  return null;
}

/** The admin surface: /admin, /admin/**, /api/admin/**. Its GETs render
 * secrets (partner magic links, sandbox tokens), so it is NOT part of
 * "everything readable" (2026-09-30 final review, C1). Exported (fix round
 * 2, N1) so middleware.ts's CSRF guard can reuse this exact decode-and-test
 * logic instead of duplicating a path-prefix check of its own. */
export function isAdminSurface(path: string): boolean {
  const test = (p: string) => p === '/admin' || p.startsWith('/admin/') || p === '/api/admin' || p.startsWith('/api/admin/');
  // Defense in depth: also test the once-decoded form, so an encoded spelling
  // (`/%61dmin/partners`) can only ever be MORE restricted, never less.
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* keep raw */ }
  return test(path) || test(decoded);
}

// What-if writes (POST/PATCH/DELETE under /api/explore/<code>/what-ifs…). Matched on
// the raw path (the code segment may be percent-encoded); the segment must still be a
// strictly-shaped course code, so a non-code segment falls through to admin as before.
const WHAT_IF_WRITE = /^\/api\/explore\/[^/]+\/what-ifs(?:\/[^/]+(?:\/(?:chat|attachments|page))?)?$/;

// Curriculum-plan writes (POST /api/build/plans, PUT/DELETE /api/build/plans/<id>, POST /api/build/suggest). A plan is a
// shared working document that never writes to a real course, so it is not bound to a course scope.
// POST /api/build/links: decisions on skill -> competency links and roll-ups (spec 2026-11-15-skill-competency-links).
// They never change a capture's skills; any faculty member may make them (owner), recorded with who and when.
// POST /api/build/plans/<id>/syllabus: import a course from a syllabus onto the plan (a free campus model drafts map edits).
// Course-cluster writes (POST /api/build/clusters, PUT/DELETE /api/build/clusters/<id>, POST …/<id>/syllabus and
// …/<id>/versions): a cluster is a shared working document like a plan, under the same rule.
// Locked skill strings (POST /api/strings, PATCH /api/strings/<id>, POST /api/strings/resolve, /orphan-notes and
// /points/<id>): the department-wide string record is a shared working document too; any login that can capture a
// course may lock, extend or merge a string, recorded with who and when. (resolve is a POST that only reads.)
const PLAN_WRITE =
  /^\/api\/(?:build\/(?:plans(?:\/[0-9a-f-]{36}(?:\/syllabus)?)?|clusters(?:\/[0-9a-f-]{36}(?:\/(?:syllabus|versions))?)?|suggest|links|match)|strings(?:\/[0-9a-f-]{36})?|strings\/(?:resolve|orphan-notes)|strings\/points\/[0-9a-f-]{36})$/i;

export function classify(method: string, pathname: string): Kind {
  const m = method.toUpperCase();
  const path = pathname.replace(/\/+$/, '') || '/';
  if (m === 'GET' || m === 'HEAD') {
    if (!isAdminSurface(path)) return { kind: 'read' };
    // Carve-outs inside /api/admin/: course data under /api/admin/courses/<code>/…
    // and the roster create path keep their read kind.
    if (path === ROSTER_BULK) return { kind: 'read' };
    if (path.startsWith(ADMIN_COURSES) && courseOf(path)) return { kind: 'read' };
    return { kind: 'admin' };
  }
  // Interaction endpoints without privilege: any live grant, any method
  // (2026-09-30 final review, I3a). /api/flags/<id> (resolving a flag) is
  // NOT included — it falls through to admin.
  if (path === '/api/ask' || path.startsWith('/api/ask/') || path === '/api/flags' || path === '/api/feedback') {
    return { kind: 'read' };
  }
  if (CREATE_PATHS.has(path)) return { kind: 'create' };
  if (path.startsWith(ROSTER_BULK + '/')) return { kind: 'admin' };
  if (WHAT_IF_WRITE.test(path) && courseOf(path)) return { kind: 'what-if-write' };
  if (PLAN_WRITE.test(path)) return { kind: 'plan-write' };
  const code = courseOf(path);
  if (code) return { kind: 'course-write', code };
  return { kind: 'admin' };
}

function inScope(grant: Grant, code: string): boolean {
  return grant.scope.some(s => s === '*' || normalizeCode(s) === code);
}

export function authorize(grant: Grant, method: string, pathname: string): Decision {
  const k = classify(method, pathname);
  switch (k.kind) {
    case 'read': return { ok: true };
    case 'course-write':
      if (!grant.can.includes('capture')) return { ok: false, reason: 'needs-capture', code: k.code };
      return inScope(grant, k.code) ? { ok: true } : { ok: false, reason: 'out-of-scope', code: k.code };
    case 'what-if-write':
      // Anyone who can capture at least one course may start a what-if on any course:
      // a what-if never writes to the real course, so the course is not checked against scope.
      return grant.can.includes('capture') && grant.scope.length > 0 ? { ok: true } : { ok: false, reason: 'needs-capture' };
    case 'plan-write':
      // Same rule as a what-if: anyone who can capture at least one course may build plans.
      return grant.can.includes('capture') && grant.scope.length > 0 ? { ok: true } : { ok: false, reason: 'needs-capture' };
    case 'create':
      return grant.can.includes('create') ? { ok: true } : { ok: false, reason: 'needs-create' };
    case 'admin':
      return grant.scope.includes('*') && grant.can.includes('admin') ? { ok: true } : { ok: false, reason: 'needs-admin' };
  }
}
