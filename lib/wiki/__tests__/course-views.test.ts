import { describe, it, expect } from 'vitest';
import { evidenceFromProfile, summarizePredicted, groupTargets, withoutRetired } from '../course-views';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

describe('evidenceFromProfile', () => {
  const profile = {
    competencies: [
      { statement: 'Measures color', type: 'technical', k_depth: 4, u_depth: 2, d_depth: 3, source: 'materials' },
      { statement: 'Agency', type: 'foundational', k_depth: null, u_depth: null, d_depth: 2, source: 'instructor' },
      { statement: 'Legacy row', type: 'technical', k_depth: 1, u_depth: 0, d_depth: 0 },
      { statement: 'Inferred row', type: 'technical', k_depth: 4, u_depth: 2, d_depth: 3, source: 'inferred', citations: [{ type: 'chunk' }] },
      { statement: 'Cited row', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 2, source: 'instructor', citations: [{ type: 'chunk' }] },
    ],
    verification_summary: { catalog_vs_evidence: ['Catalog overstates manufacturing.', '  '] },
    audit_notes: { objective_misalignments: ['Catalog overstates manufacturing.', 'Objective 3 has no assessment.'] },
  } as unknown as CaptureProfile;

  it('keeps measured depths and maps the evidence source', () => {
    const e = evidenceFromProfile(profile, '2026-06-16');
    expect(e.capturedOn).toBe('2026-06-16');
    expect(e.rows[0]).toEqual({ statement: 'Measures color', foundational: false, k: 4, u: 2, d: 3, evidence: 'materials' });
    expect(e.rows[1]).toMatchObject({ foundational: true, k: null, u: null, d: 2, evidence: 'claimed' });
    expect(e.rows[2]!.evidence).toBe('claimed'); // pre-v2 snapshots have no source flag
    expect(e.rows[3]!.evidence).toBe('claimed'); // inferred is a claim, whatever it cites (same rule as the wiki page)
    expect(e.rows[4]!.evidence).toBe('materials'); // an instructor claim backed by a material chunk
  });

  it('merges the two disagreement lists, drops blanks and verbatim repeats', () => {
    expect(evidenceFromProfile(profile, '2026-06-16').disagreements).toEqual([
      'Catalog overstates manufacturing.',
      'Objective 3 has no assessment.',
    ]);
  });
});

describe('summarizePredicted', () => {
  const row = (targetId: string, order: number, k: number | null, u: number | null, d: number | null) => ({ targetId, name: targetId.toUpperCase(), order, k, u, d });

  it('takes the max depth per target and counts touched competencies', () => {
    const out = summarizePredicted([row('b', 1, 2, 1, 3), row('b', 1, 4, null, 1), row('b', 1, 0, 0, 0), row('a', 0, 1, 0, 0)]);
    expect(out.map(t => t.targetId)).toEqual(['a', 'b']); // display order, not input order
    expect(out[1]).toMatchObject({ k: 4, u: 1, d: 3, competencies: 2 });
  });

  it('drops a target the syllabus does not touch at all', () => {
    expect(summarizePredicted([row('x', 0, 0, 0, 0), row('x', 0, null, null, null)])).toEqual([]);
  });

  it('ignores predictions on retired sub-competencies (2026-10-06 target batch)', () => {
    const out = summarizePredicted([
      { ...row('t5', 4, 1, 1, 1), retired: false },
      { ...row('t5', 4, 4, 4, 4), retired: true },
      { ...row('t9', 5, 3, 3, 3), retired: true },
    ]);
    expect(out).toEqual([{ targetId: 't5', name: 'T5', k: 1, u: 1, d: 1, competencies: 1 }]);
  });
});

describe('groupTargets', () => {
  it('groups competencies under targets in display order and skips retired ones', () => {
    const out = groupTargets([
      { targetId: 't2', targetName: 'Two', targetOrder: 1, id: 'c3', name: 'C3', order: 0, retired: false },
      { targetId: 't1', targetName: 'One', targetOrder: 0, id: 'c2', name: 'C2', order: 1, retired: false },
      { targetId: 't1', targetName: 'One', targetOrder: 0, id: 'c1', name: 'C1', order: 0, retired: false },
      { targetId: 't1', targetName: 'One', targetOrder: 0, id: 'old', name: 'Old', order: 2, retired: true },
      { targetId: 't3', targetName: 'Empty', targetOrder: 2, id: null, name: null, order: null, retired: null },
    ]);
    expect(out.map(t => t.id)).toEqual(['t1', 't2', 't3']);
    expect(out[0]!.competencies.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(out[2]!.competencies).toEqual([]);
  });
});

describe('withoutRetired', () => {
  it('drops wiki competency pages whose sub-competency is retired', () => {
    const pages = [{ slug: 'kept', title: 'Kept' }, { slug: 'prompt-design', title: 'Prompt design' }];
    expect(withoutRetired(pages, new Set(['prompt-design']))).toEqual([{ slug: 'kept', title: 'Kept' }]);
  });
});
