import { describe, it, expect } from 'vitest';
import { authorize, classify, normalizeCode, type Grant } from '@/lib/auth/authorize';
import { builtinGrant } from '@/lib/auth/grants';

const scoped: Grant = { id: 'g1', label: 'Danita — GC 3730', scope: ['GC 3730'], can: ['capture'] };
const creator: Grant = { id: 'g2', label: 'creator', scope: [], can: ['create'] };
const admin: Grant = { id: 'g3', label: 'dept', scope: ['*'], can: ['capture', 'create', 'admin'] };

describe('normalizeCode', () => {
  it.each([
    ['GC%201010', 'GC 1010'], ['GC 1010', 'GC 1010'], ['gc  4900ap', 'GC 4900AP'], [' GC 3460 ', 'GC 3460'],
  ])('%s → %s', (raw, want) => expect(normalizeCode(raw)).toBe(want));
  it('does not double-decode', () => expect(normalizeCode('GC%25201010')).toBe('GC%201010'));
});

describe('classify', () => {
  it('GET/HEAD anywhere gated is a read', () => {
    for (const p of ['/program', '/explore/GC%203730', '/courses', '/ask', '/api/ask', '/api/program/coverage', '/board/curriculum', '/capture/GC%201010', '/api/capture/GC%201010/context'])
      for (const m of ['GET', 'HEAD']) expect(classify(m, p)).toEqual({ kind: 'read' });
  });
  it.each([
    ['POST', '/api/capture/GC%203730/chat', 'GC 3730'],
    ['DELETE', '/api/capture/GC%203730/messages/abc', 'GC 3730'],
    ['PUT', '/api/courses/GC%203730/materials/1', 'GC 3730'],
    ['POST', '/api/explore/GC%203730/scenarios/9/adopt', 'GC 3730'],
    ['PATCH', '/api/admin/courses/GC%203730/prereq-edges', 'GC 3730'],
    ['POST', '/api/courses/GC%204900ap/canvas-import', 'GC 4900AP'],
    ['POST', '/api/capture/GC%201010L/chat', 'GC 1010L'],
    ['POST', '/api/capture/ACCT%202010/chat', 'ACCT 2010'],
    ['POST', '/api/capture/EXT-fe61628f/chat', 'EXT-FE61628F'],
    ['POST', '/api/capture/GC%203730/', 'GC 3730'],
  ])('%s %s is a course write on %s', (m, p, code) => expect(classify(m, p)).toEqual({ kind: 'course-write', code }));
  it('the two create paths', () => {
    expect(classify('POST', '/courses/new')).toEqual({ kind: 'create' });
    expect(classify('POST', '/api/admin/courses/roster')).toEqual({ kind: 'create' });
  });
  it('everything else non-GET is admin (default-deny)', () => {
    for (const p of ['/api/admin/courses/roster/extra', '/api/admin/synthesis', '/api/program/coverage/refresh', '/api/settings', '/api/some-future-route', '/api/courses', '/api/capture'])
      expect(classify('POST', p)).toEqual({ kind: 'admin' });
  });
});

describe('authorize', () => {
  it('reads are free for any grant', () => {
    expect(authorize(scoped, 'GET', '/capture/GC%201010')).toEqual({ ok: true });
    expect(authorize(creator, 'GET', '/program')).toEqual({ ok: true });
  });
  it('course write in scope', () => expect(authorize(scoped, 'POST', '/api/capture/GC%203730/chat')).toEqual({ ok: true }));
  it('course write out of scope', () =>
    expect(authorize(scoped, 'POST', '/api/capture/GC%201010/chat')).toEqual({ ok: false, reason: 'out-of-scope', code: 'GC 1010' }));
  it('course write needs the capture capability', () =>
    expect(authorize(creator, 'POST', '/api/capture/GC%203730/chat')).toEqual({ ok: false, reason: 'needs-capture', code: 'GC 3730' }));
  it('scope * covers every course', () => expect(authorize(admin, 'POST', '/api/courses/GC%202400/materials')).toEqual({ ok: true }));
  it('create', () => {
    expect(authorize(creator, 'POST', '/api/admin/courses/roster')).toEqual({ ok: true });
    expect(authorize(scoped, 'POST', '/api/admin/courses/roster')).toEqual({ ok: false, reason: 'needs-create' });
    expect(authorize(admin, 'POST', '/courses/new')).toEqual({ ok: true });
  });
  it('admin/unclassified writes need * and admin', () => {
    expect(authorize(admin, 'POST', '/api/admin/synthesis')).toEqual({ ok: true });
    expect(authorize(scoped, 'POST', '/api/admin/synthesis')).toEqual({ ok: false, reason: 'needs-admin' });
    expect(authorize({ ...admin, scope: ['GC 1010'] }, 'POST', '/api/admin/synthesis')).toEqual({ ok: false, reason: 'needs-admin' });
  });
  it('scope matching is normalised on both sides', () =>
    expect(authorize({ ...scoped, scope: ['gc 4900AP'] }, 'POST', '/api/capture/GC%204900ap/chat')).toEqual({ ok: true }));
  it('lower-case method is treated as its upper-case form', () =>
    expect(authorize(scoped, 'post', '/api/capture/GC%201010/chat').ok).toBe(false));
  it('scope * never substitutes for a capability', () => {
    const wide: Grant = { id: 'g4', label: 'wide, no caps', scope: ['*'], can: [] };
    expect(authorize(wide, 'POST', '/api/capture/GC%203730/chat')).toEqual({ ok: false, reason: 'needs-capture', code: 'GC 3730' });
    expect(authorize(wide, 'POST', '/courses/new')).toEqual({ ok: false, reason: 'needs-create' });
    expect(authorize({ ...wide, can: ['capture'] }, 'POST', '/courses/new')).toEqual({ ok: false, reason: 'needs-create' });
    expect(authorize({ ...wide, can: ['capture'] }, 'POST', '/api/capture/GC%209999/chat')).toEqual({ ok: true });
  });
});

describe('C1 — the admin surface is not readable by scoped grants (2026-09-30 final review)', () => {
  const faculty = builtinGrant('faculty', 'gcfaculty:pw', 'x'.repeat(32));
  const creatorB = builtinGrant('creator', 'creator:pw', 'x'.repeat(32));
  const adminReads = ['/admin', '/admin/', '/admin/partners', '/admin/synthesis', '/api/admin/sandbox-grants', '/api/admin/partners', '/api/admin/synthesis'];
  it.each(adminReads)('GET/HEAD %s is admin-kind', p => {
    for (const m of ['GET', 'HEAD']) expect(classify(m, p)).toEqual({ kind: 'admin' });
  });
  it.each(adminReads)('scoped grant GET %s → not ok; faculty ok; creator not ok', p => {
    expect(authorize(scoped, 'GET', p)).toEqual({ ok: false, reason: 'needs-admin' });
    expect(authorize(faculty, 'GET', p)).toEqual({ ok: true });
    expect(authorize(creatorB, 'GET', p)).toEqual({ ok: false, reason: 'needs-admin' });
  });
  it('GET on course data under /api/admin/courses/<code>/… stays a read', () => {
    expect(authorize(scoped, 'GET', '/api/admin/courses/GC%203730/whatever')).toEqual({ ok: true });
    expect(authorize(scoped, 'GET', '/api/admin/courses/GC 3730/whatever')).toEqual({ ok: true });
    expect(classify('GET', '/api/admin/courses/GC%201010/prereq-edges')).toEqual({ kind: 'read' });
  });
  it('GET on the roster create path keeps its read kind', () =>
    expect(classify('GET', '/api/admin/courses/roster')).toEqual({ kind: 'read' }));
  it('an encoded spelling of the admin surface is still admin-kind', () => {
    expect(classify('GET', '/%61dmin/partners')).toEqual({ kind: 'admin' });
    expect(classify('GET', '/api/%61dmin/sandbox-grants')).toEqual({ kind: 'admin' });
    expect(classify('GET', '/api/admin')).toEqual({ kind: 'admin' });
  });
  it('/administrator or /admins is not the admin surface', () =>
    expect(classify('GET', '/admins')).toEqual({ kind: 'read' }));
});

describe('I2 — only a strictly-shaped course code makes a course path (2026-09-30 final review)', () => {
  const wide: Grant = { id: 'g5', label: 'wide capture, no admin', scope: ['*'], can: ['capture'] };
  it.each([
    '/api/admin/courses/intended-skills',
    '/api/capture/GC%203730%20/chat',     // trailing space — fails closed, no trim
    '/api/capture/gc%203730/chat',        // lower-case subject
    '/api/capture/GC3730/chat',           // no space
    '/api/capture/GC%20%203730/chat',     // double space
    '/api/courses/GC%25203730/materials', // double-encoded
    '/api/explore/not-a-course/scenarios',
    '/api/courses/%E0%A4%A/x',            // malformed escape
  ])('POST %s is admin-kind', p => {
    expect(classify('POST', p)).toEqual({ kind: 'admin' });
    expect(authorize(wide, 'POST', p)).toEqual({ ok: false, reason: 'needs-admin' });
    expect(authorize(scoped, 'POST', p).ok).toBe(false);
  });
  it('GC 3730 is a course write', () => {
    expect(classify('POST', '/api/capture/GC%203730/chat')).toEqual({ kind: 'course-write', code: 'GC 3730' });
    expect(classify('POST', '/api/capture/GC 3730/chat')).toEqual({ kind: 'course-write', code: 'GC 3730' });
  });
  it('GET /api/admin/courses/intended-skills is admin-kind (not course data)', () =>
    expect(classify('GET', '/api/admin/courses/intended-skills')).toEqual({ kind: 'admin' }));
});

describe('I3a — /ask, flags, feedback are interaction endpoints readable by any live grant', () => {
  const noCaps: Grant = { id: 'g6', label: 'read-only', scope: [], can: [] };
  it.each([
    ['POST', '/api/ask/chat'], ['POST', '/api/ask'], ['POST', '/api/flags'], ['GET', '/api/flags'], ['POST', '/api/feedback'], ['POST', '/api/flags/'],
  ])('%s %s is read-kind and allowed for any grant', (m, p) => {
    expect(classify(m, p)).toEqual({ kind: 'read' });
    expect(authorize(scoped, m, p)).toEqual({ ok: true });
    expect(authorize(noCaps, m, p)).toEqual({ ok: true });
  });
  it.each([
    ['PATCH', '/api/flags/abc'],   // resolving a flag is moderation, not an annotation
    ['POST', '/api/asking'],
    ['POST', '/api/feedback/extra'],
    ['POST', '/api/flagsx'],
  ])('%s %s stays admin-kind', (m, p) => expect(classify(m, p)).toEqual({ kind: 'admin' }));
});
