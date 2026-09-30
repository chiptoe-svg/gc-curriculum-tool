import { describe, it, expect } from 'vitest';
import { authorize, classify, normalizeCode, type Grant } from '@/lib/auth/authorize';

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
    for (const p of ['/program', '/explore/GC%203730', '/courses', '/ask', '/api/ask', '/api/program/coverage', '/board/curriculum', '/capture/GC%201010', '/api/capture/GC%201010/context', '/admin'])
      for (const m of ['GET', 'HEAD']) expect(classify(m, p)).toEqual({ kind: 'read' });
  });
  it.each([
    ['POST', '/api/capture/GC%203730/chat', 'GC 3730'],
    ['DELETE', '/api/capture/GC%203730/messages/abc', 'GC 3730'],
    ['PUT', '/api/courses/GC%203730/materials/1', 'GC 3730'],
    ['POST', '/api/explore/GC%203730/scenarios/9/adopt', 'GC 3730'],
    ['PATCH', '/api/admin/courses/GC%203730/prereq-edges', 'GC 3730'],
    ['POST', '/api/courses/gc%204900ap/canvas-import', 'GC 4900AP'],
    ['POST', '/api/capture/GC%203730/', 'GC 3730'],
  ])('%s %s is a course write on %s', (m, p, code) => expect(classify(m, p)).toEqual({ kind: 'course-write', code }));
  it('the two create paths', () => {
    expect(classify('POST', '/courses/new')).toEqual({ kind: 'create' });
    expect(classify('POST', '/api/admin/courses/roster')).toEqual({ kind: 'create' });
  });
  it('everything else non-GET is admin (default-deny)', () => {
    for (const p of ['/api/admin/courses/roster/extra', '/api/admin/synthesis', '/api/program/coverage/refresh', '/api/settings', '/api/flags', '/api/some-future-route', '/api/courses', '/api/capture'])
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
});
