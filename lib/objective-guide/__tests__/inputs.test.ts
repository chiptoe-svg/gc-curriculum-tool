import { describe, it, expect } from 'vitest';
import { pickSyllabus, usableAssignmentsText, type GuideMaterial } from '../inputs';

const mat = (o: Partial<GuideMaterial>): GuideMaterial => ({
  id: 'm', fileName: 'f.pdf', isSyllabus: false, ignored: false, retiredAt: null, extractedText: 'text', ignoredItems: [], ...o,
});

describe('pickSyllabus', () => {
  it('returns every usable flagged syllabus', () => {
    expect(pickSyllabus([mat({ id: 's', fileName: 'syl.pdf', isSyllabus: true, extractedText: 'OBJ' }), mat({ id: 'x' })]))
      .toEqual({ status: 'ok', syllabi: [{ id: 's', fileName: 'syl.pdf', text: 'OBJ' }] });
  });

  it('a FERPA set-aside syllabus is never usable', () => {
    expect(pickSyllabus([mat({ isSyllabus: true, ignored: true, extractedText: 'student emails' })]))
      .toEqual({ status: 'syllabus-set-aside' });
  });

  it('a set-aside syllabus that faculty included is usable', () => {
    const included = { ...mat({ id: 's', isSyllabus: true, ignored: false, extractedText: 'OBJ' }), autoSetAside: true };
    expect(pickSyllabus([included]).status).toBe('ok');
  });

  it('skips retired and empty syllabi', () => {
    expect(pickSyllabus([mat({ isSyllabus: true, retiredAt: new Date() })])).toEqual({ status: 'no-syllabus' });
    expect(pickSyllabus([mat({ isSyllabus: true, extractedText: '   ' })])).toEqual({ status: 'no-syllabus' });
    expect(pickSyllabus([mat({ isSyllabus: true, ignored: true, retiredAt: new Date() })])).toEqual({ status: 'no-syllabus' });
  });

  it('uses the usable one when another copy is set aside', () => {
    const r = pickSyllabus([
      mat({ id: 'a', isSyllabus: true, ignored: true, extractedText: 'SECRET' }),
      mat({ id: 'b', isSyllabus: true, extractedText: 'OBJ' }),
    ]);
    expect(r).toEqual({ status: 'ok', syllabi: [{ id: 'b', fileName: 'f.pdf', text: 'OBJ' }] });
  });
});

describe('usableAssignmentsText', () => {
  const text = '## A (5 pts)\nfirst\n\n## B (5 pts)\nsecond';

  it('removes per-item ignores', () => {
    const out = usableAssignmentsText([mat({ fileName: 'Canvas: Assignments', extractedText: text, ignoredItems: ['B (5 pts)'] })]);
    expect(out).toContain('## A (5 pts)');
    expect(out).not.toContain('second');
  });

  it('skips ignored and retired rows and joins the rest', () => {
    expect(usableAssignmentsText([mat({ fileName: 'Canvas: Assignments', ignored: true, extractedText: text })])).toBeNull();
    expect(usableAssignmentsText([mat({ fileName: 'Canvas: Assignments', retiredAt: '2026-10-01T00:00:00Z', extractedText: text })])).toBeNull();
    expect(usableAssignmentsText([
      mat({ fileName: 'Canvas: Assignments', extractedText: '## A\none' }),
      mat({ fileName: 'Canvas: Assignments', extractedText: '## B\ntwo' }),
    ])).toBe('## A\none\n\n## B\ntwo');
  });

  it('returns null when there is no assignments material', () => {
    expect(usableAssignmentsText([mat({ fileName: 'Canvas: Pages' })])).toBeNull();
  });
});
