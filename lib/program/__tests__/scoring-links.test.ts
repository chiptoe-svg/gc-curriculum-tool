import { describe, it, expect, vi } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { scoringLinkFor, ensureScoringLink } from '../scoring-links';

const stmts = ['  Students map career paths. ', 'Students pitch work.'];

// result: 'insert' = new row, 'upgrade' = an embedding suggestion became a scoring link, 'none' = row kept as it was
function fakeDb(profileStatements: string[], result: 'insert' | 'upgrade' | 'none') {
  const insertValues = vi.fn();
  const conflict = vi.fn();
  const ex = {
    select: () => ({ from: () => ({ where: async () => [{ profile: { competencies: profileStatements.map(statement => ({ statement })) } }] }) }),
    insert: () => ({ values: (v: unknown) => { insertValues(v); return { onConflictDoUpdate: (o: unknown) => { conflict(o); return { returning: async () => (result === 'none' ? [] : [{ inserted: result === 'insert' }]) }; } }; } }),
  };
  return { ex, insertValues, conflict };
}

describe('scoringLinkFor', () => {
  it("matches the trimmed statement and returns the seed's skillRef", () => {
    expect(scoringLinkFor(stmts, 'Students map career paths.')).toEqual({
      statement: 'Students map career paths.', skillRef: textHash(normalizeStatement('Students map career paths.')),
    });
  });
  it('returns null for a matched text that is no skill statement', () => {
    expect(scoringLinkFor(stmts, 'Something else')).toBeNull();
    expect(scoringLinkFor(stmts, null)).toBeNull();
  });
});

describe('ensureScoringLink', () => {
  it('zero level adds no link', async () => {
    const { ex, insertValues } = fakeDb(stmts, 'insert');
    expect(await ensureScoringLink(ex as never, { snapshotId: 's', competencyId: 'c', matchedCompetency: 'Students pitch work.', level: 0 })).toBe('zero');
    expect(insertValues).not.toHaveBeenCalled();
  });
  it('adds a proposed scoring link for an above-zero cell', async () => {
    const { ex, insertValues } = fakeDb(stmts, 'insert');
    expect(await ensureScoringLink(ex as never, { snapshotId: 's', competencyId: 'c', matchedCompetency: 'Students pitch work.', level: 2 })).toBe('added');
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 's', competencyId: 'c', source: 'scoring', status: 'proposed', statement: 'Students pitch work.' }));
  });
  it('existing link for the same skill/competency (e.g. rejected) is left as it is (DO NOTHING)', async () => {
    const { ex } = fakeDb(stmts, 'none');
    expect(await ensureScoringLink(ex as never, { snapshotId: 's', competencyId: 'c', matchedCompetency: 'Students pitch work.', level: 2 })).toBe('exists');
  });
  it('a proposed embedding suggestion on the same skill/competency becomes a scoring link (upgraded), only when proposed and embedding', async () => {
    const { ex, conflict } = fakeDb(stmts, 'upgrade');
    expect(await ensureScoringLink(ex as never, { snapshotId: 's', competencyId: 'c', matchedCompetency: 'Students pitch work.', level: 2 })).toBe('upgraded');
    const o = conflict.mock.calls[0]![0] as { set: Record<string, unknown>; setWhere: unknown };
    expect(o.set).toEqual({ source: 'scoring' });
    expect(o.setWhere).toBeDefined();
  });
  it('no-match when the matched text is not one of the snapshot statements', async () => {
    const { ex, insertValues } = fakeDb(stmts, 'insert');
    expect(await ensureScoringLink(ex as never, { snapshotId: 's', competencyId: 'c', matchedCompetency: 'other', level: 2 })).toBe('no-match');
    expect(insertValues).not.toHaveBeenCalled();
  });
});
