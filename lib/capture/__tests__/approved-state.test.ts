import { describe, it, expect } from 'vitest';
import { approvedOn } from '../approved-state';

const profile = { course_code: 'GC 4400', competencies: [{ statement: 'A', k_depth: 3, d_depth: 2 }], overview: { a: 1, b: 2 } };
const snapshot = { profile, createdAt: '2026-10-29T17:22:00.000Z', reviewerNote: null };
const draft = (over: object = {}) => ({ profile, reviewerStatus: 'confirmed', reviewerNote: null, ...over });

describe('approvedOn', () => {
  it('gives the approval date when the confirmed draft is the latest snapshot', () => {
    expect(approvedOn(draft(), snapshot)).toBe('2026-10-29T17:22:00.000Z');
  });
  it('ignores key order and a null draft-only revision field', () => {
    const reordered = { overview: { b: 2, a: 1 }, competencies: [{ d_depth: 2, statement: 'A', k_depth: 3 }], course_code: 'GC 4400', revision: null };
    expect(approvedOn(draft({ profile: reordered }), snapshot)).toBe('2026-10-29T17:22:00.000Z');
  });
  it('is null when a score differs', () => {
    const edited = { ...profile, competencies: [{ statement: 'A', k_depth: 4, d_depth: 2 }] };
    expect(approvedOn(draft({ profile: edited }), snapshot)).toBeNull();
  });
  it('is null when the draft is not confirmed, has an open revision, or its note changed', () => {
    expect(approvedOn(draft({ reviewerStatus: 'edited' }), snapshot)).toBeNull();
    expect(approvedOn(draft({ reviewerStatus: 'ai_drafted' }), snapshot)).toBeNull();
    expect(approvedOn(draft({ profile: { ...profile, revision: { mode: 'recheck', changes: [] } } }), snapshot)).toBeNull();
    expect(approvedOn(draft({ reviewerNote: 'new context' }), snapshot)).toBeNull();
  });
  it('is null with no draft or no snapshot', () => {
    expect(approvedOn(null, snapshot)).toBeNull();
    expect(approvedOn(draft(), null)).toBeNull();
  });
});
