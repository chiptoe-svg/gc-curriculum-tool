import { describe, it, expect } from 'vitest';
import {
  buildSyllabusPrompt, normalizeCourseCode, parseSyllabusDraft, prereqLinks, syllabusDraftSchema, toCourseEdits, type SyllabusDraft,
} from '../syllabus-draft';
import { parsePlanState } from '../plan-schema';
import { EMPTY_PLAN } from '../types';

const meta = { by: 'Ada', at: '2026-11-16T15:00:00.000Z', draftId: '8b1f0c2e-0000-4000-8000-000000000001', fileName: 'gc3020.pdf' };
const draft: SyllabusDraft = {
  objectives: [{ text: 'Explain the halftone process', bloom: 'Understand' }, { text: 'Design a package dieline', bloom: 'Create' }],
  developed: [
    { statement: 'Prepare a print-ready PDF', k: 2, u: 1, d: 4, condition_missing: true },
    { statement: 'Troubleshoot press registration on unfamiliar jobs', k: 3, u: 3, d: 4, condition_missing: false },
    { statement: 'Write a clear production report', k: null, u: null, d: 2, condition_missing: false },
  ],
  required: [{ statement: 'Use Adobe Illustrator layers', k: 2, u: null, d: 2 }],
  prerequisites: [{ code: 'gc1040', kind: 'prereq' }, { code: 'GC  2070', kind: 'coreq' }, { code: 'see catalog', kind: 'prereq' }],
};

describe('toCourseEdits', () => {
  const edits = toCourseEdits(draft, meta);
  it('marks every item origin syllabus and draft (an add, stamped, with the source on the course)', () => {
    const all = [...edits.objectives, ...edits.required, ...edits.developed];
    expect(all).toHaveLength(6);
    for (const e of all) {
      expect(e.action).toBe('add');
      expect(e.target).toBeNull();
      expect(e.origin).toBe('syllabus');
      expect(e.by).toBe('Ada');
      expect(e.at).toBe(meta.at);
    }
    expect(new Set(all.map(e => e.id)).size).toBe(6);
    expect(edits.source).toEqual({ kind: 'syllabus', draftId: meta.draftId, fileName: 'gc3020.pdf', at: meta.at });
    expect(edits.objectives[1]).toMatchObject({ text: 'Design a package dieline', bloom: 'Create' });
    expect(edits.required[0]!.levels).toEqual({ k: 2, u: null, d: 2 });
  });
  it('a developed skill with D4 and condition_missing is capped at D2 with the flag kept', () => {
    const capped = edits.developed[0]!;
    expect(capped.levels).toEqual({ k: 2, u: 1, d: 2 });
    expect(capped.conditionMissing).toBe(true);
    // A stated condition keeps D4, and carries no flag.
    expect(edits.developed[1]!.levels?.d).toBe(4);
    expect(edits.developed[1]!.conditionMissing).toBeUndefined();
  });
  it('drops a repeated statement', () => {
    const twice = toCourseEdits({ ...draft, required: [...draft.required, { statement: ' use adobe  illustrator layers.', k: 1, u: null, d: 1 }] }, meta);
    expect(twice.required).toHaveLength(1);
  });
  it('the edits survive the plan schema', () => {
    const plan = parsePlanState({ ...EMPTY_PLAN, courseEdits: { 'GC 3020': edits } });
    expect(plan?.courseEdits?.['GC 3020']?.source?.fileName).toBe('gc3020.pdf');
    expect(plan?.courseEdits?.['GC 3020']?.developed[0]?.origin).toBe('syllabus');
    expect(plan?.courseEdits?.['GC 3020']?.developed[0]?.conditionMissing).toBe(true);
  });
});

describe('prerequisites', () => {
  it('normalizes codes like "GC 1040" and drops what is not a code', () => {
    expect(normalizeCourseCode('gc1040')).toBe('GC 1040');
    expect(normalizeCourseCode('GC-4900ap')).toBe('GC 4900AP');
    expect(normalizeCourseCode('see catalog')).toBeNull();
  });
  it('become plan links into the course, coreqs with kind, never to itself', () => {
    const links = prereqLinks({ ...draft, prerequisites: [...draft.prerequisites, { code: 'GC 3020', kind: 'prereq' }] }, { ref: 'GC 3020', code: 'GC 3020' }, c => c);
    expect(links).toEqual([{ from: 'GC 1040', to: 'GC 3020' }, { from: 'GC 2070', to: 'GC 3020', kind: 'coreq' }]);
  });
  it('resolve a code to a course proposed on the plan', () => {
    const links = prereqLinks(draft, { ref: 'new:x', code: 'GC 5000' }, c => (c === 'GC 1040' ? 'new:y' : c));
    expect(links[0]).toEqual({ from: 'new:y', to: 'new:x' });
  });
});

describe('syllabusDraftSchema', () => {
  it('rejects a level of 6', () => {
    const bad = { ...draft, developed: [{ ...draft.developed[0]!, d: 6 }] };
    expect(syllabusDraftSchema.safeParse(bad).success).toBe(false);
    expect(syllabusDraftSchema.safeParse(draft).success).toBe(true);
  });
  it('rejects a Bloom process outside the six', () => {
    expect(syllabusDraftSchema.safeParse({ ...draft, objectives: [{ text: 'x', bloom: 'Synthesize' }] }).success).toBe(false);
  });
  it('parseSyllabusDraft reads a missing level as null and a missing flag as set when Do is above 2', () => {
    const d = parseSyllabusDraft({ objectives: [], developed: [{ statement: 'A', k: 2, d: 4 }, { statement: 'B', d: 2 }], required: [{ statement: 'C' }] });
    expect(d.developed).toEqual([
      { statement: 'A', k: 2, u: null, d: 4, condition_missing: true },
      { statement: 'B', k: null, u: null, d: 2, condition_missing: false },
    ]);
    expect(d.required[0]).toEqual({ statement: 'C', k: null, u: null, d: null });
    expect(d.prerequisites).toEqual([]);
  });
  it('parseSyllabusDraft keeps the first items when the model returns too many', () => {
    const many = { ...draft, developed: Array.from({ length: 20 }, (_, i) => ({ ...draft.developed[0]!, statement: `Skill ${i}` })) };
    expect(parseSyllabusDraft(many).developed).toHaveLength(15);
  });
});

describe('buildSyllabusPrompt', () => {
  const p = buildSyllabusPrompt('SYLLABUS BODY', { code: 'GC 3020', title: 'Prepress' });
  it('contains the depth scale and the goal-not-evidence rule', () => {
    expect(p).toContain('KUD Depth Scales');
    expect(p).toMatch(/GOALS?/);
    expect(p).toMatch(/never evidence/i);
  });
  it('states the Do-condition cap, foundational D-only, one Bloom process per objective, and named prerequisites only', () => {
    expect(p).toMatch(/condition_missing/);
    expect(p).toMatch(/at most 2/i);
    for (const f of ['Agency', 'Attention to Detail', 'Resilience', 'Curiosity', 'Written Communication', 'Spoken Communication']) expect(p).toContain(f);
    expect(p).toMatch(/one Bloom process/i);
    expect(p).toMatch(/only (the )?(prerequisites|courses) the syllabus names/i);
    expect(p).toContain('GC 3020');
    expect(p).toContain('SYLLABUS BODY');
  });
});
