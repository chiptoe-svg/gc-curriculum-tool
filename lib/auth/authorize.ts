/**
 * The scope table — the single security boundary for faculty writes.
 * Pure: no I/O, no env. See docs/superpowers/specs/2026-09-30-scoped-access-links-design.md.
 */
export type Capability = 'capture' | 'create' | 'admin';
export interface Grant { id: string; label: string; scope: string[]; can: Capability[] }
export type Kind =
  | { kind: 'read' }
  | { kind: 'course-write'; code: string }
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

export function classify(method: string, pathname: string): Kind {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return { kind: 'read' };
  const path = pathname.replace(/\/+$/, '') || '/';
  if (CREATE_PATHS.has(path)) return { kind: 'create' };
  if (path.startsWith(ROSTER_BULK + '/')) return { kind: 'admin' };
  for (const prefix of COURSE_WRITE_PREFIXES) {
    if (path.startsWith(prefix)) {
      const seg = path.slice(prefix.length).split('/')[0] ?? '';
      if (seg) return { kind: 'course-write', code: normalizeCode(seg) };
    }
  }
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
      if (grant.scope.includes('*')) return { ok: true };
      if (!grant.can.includes('capture')) return { ok: false, reason: 'needs-capture', code: k.code };
      return inScope(grant, k.code) ? { ok: true } : { ok: false, reason: 'out-of-scope', code: k.code };
    case 'create':
      return grant.scope.includes('*') || grant.can.includes('create') ? { ok: true } : { ok: false, reason: 'needs-create' };
    case 'admin':
      return grant.scope.includes('*') && grant.can.includes('admin') ? { ok: true } : { ok: false, reason: 'needs-admin' };
  }
}
