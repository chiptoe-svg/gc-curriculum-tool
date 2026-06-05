/**
 * Tests for lib/db/prerequisite-edge-queries.ts
 *
 * DB convention: mock @/lib/db/client (same as capture-messages-queries.test.ts).
 * wouldCreateCycle / bfsWouldCycle: tested via the pure bfsWouldCycle helper —
 *   no DB needed, no mock chains required.
 * upsertSeededEdges skip-confirmed logic: verified by controlling what .returning()
 *   resolves to ([] → skipped, [{id}] → inserted).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock — set up before the module under test is imported.
// ---------------------------------------------------------------------------

// Capture the chain-builder so individual tests can control .returning() output.
let returningMock = vi.fn();
// update chain: .set().where().returning()
let updateReturningMock = vi.fn();
let deleteMock = vi.fn();
let selectDistinctMock = vi.fn();
// selectDistinct with .where() — used by listConfirmedEdgePairs
let selectDistinctWhereMock = vi.fn();
// select with .where().limit() — used by getEdgeById
let selectLimitMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    // insert chain: .values().onConflictDoUpdate().returning()
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: returningMock,
        }),
      }),
    }),
    // update chain: .set().where().returning()
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({
          returning: () => updateReturningMock(v),
        }),
      }),
    }),
    // delete chain: .where()
    delete: () => ({
      where: () => deleteMock(),
    }),
    // selectDistinct chain: .from() or .from().where()
    selectDistinct: () => ({
      from: () => ({
        // listEdgePairs awaits .from() directly
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          selectDistinctMock().then(resolve, reject),
        // listConfirmedEdgePairs calls .where() on .from() result
        where: () => selectDistinctWhereMock(),
      }),
    }),
    // select chain — used by listEdgesForFocal and getEdgeById
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (n: number) => selectLimitMock(n),
        }),
      }),
    }),
  },
}));

// Import AFTER mocks are registered.
import {
  upsertSeededEdges,
  updateEdge,
  confirmEdge,
  deleteEdge,
  bfsWouldCycle,
  wouldCreateCycle,
  getEdgeById,
} from '@/lib/db/prerequisite-edge-queries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_EDGE = {
  focalCourseCode: 'GC 3010',
  prereqCourseCode: 'GC 2010',
  subCompetencyId: 'sub-1',
  expectedK: 2,
  expectedU: 2,
  expectedD: 1,
  confidence: 'medium' as const,
  rationale: 'test rationale',
};

// ---------------------------------------------------------------------------

describe('upsertSeededEdges', () => {
  beforeEach(() => {
    returningMock.mockReset();
    updateReturningMock.mockReset();
    deleteMock.mockReset();
    selectDistinctMock.mockReset();
    selectDistinctWhereMock.mockReset();
    selectLimitMock.mockReset().mockResolvedValue([]);
  });

  it('returns { inserted: 0, skippedConfirmed: 0 } for an empty array', async () => {
    const result = await upsertSeededEdges([]);
    expect(result).toEqual({ inserted: 0, skippedConfirmed: 0 });
    expect(returningMock).not.toHaveBeenCalled();
  });

  it('counts a new row as inserted when .returning() yields a row', async () => {
    returningMock.mockResolvedValue([{ id: 'uuid-1' }]);
    const result = await upsertSeededEdges([BASE_EDGE]);
    expect(result).toEqual({ inserted: 1, skippedConfirmed: 0 });
  });

  it('counts a confirmed-skip as skippedConfirmed when .returning() yields []', async () => {
    // Postgres returns nothing when setWhere (confirmed=false) does not match —
    // i.e. the row was already confirmed=true.  Drizzle surfaces this as [].
    returningMock.mockResolvedValue([]);
    const result = await upsertSeededEdges([BASE_EDGE]);
    expect(result).toEqual({ inserted: 0, skippedConfirmed: 1 });
  });

  it('is idempotent: second call on same key reported as inserted again (no skip) if not confirmed', async () => {
    returningMock.mockResolvedValue([{ id: 'uuid-1' }]);
    const r1 = await upsertSeededEdges([BASE_EDGE]);
    const r2 = await upsertSeededEdges([BASE_EDGE]);
    expect(r1).toEqual({ inserted: 1, skippedConfirmed: 0 });
    expect(r2).toEqual({ inserted: 1, skippedConfirmed: 0 });
  });

  it('handles mixed batch: some inserted, some skipped', async () => {
    // First call → inserted, second → skipped (already confirmed).
    returningMock
      .mockResolvedValueOnce([{ id: 'uuid-1' }]) // edge 1: new
      .mockResolvedValueOnce([])                  // edge 2: already confirmed
      .mockResolvedValueOnce([{ id: 'uuid-3' }]); // edge 3: new
    const result = await upsertSeededEdges([
      BASE_EDGE,
      { ...BASE_EDGE, prereqCourseCode: 'GC 1010' },
      { ...BASE_EDGE, subCompetencyId: 'sub-2' },
    ]);
    expect(result).toEqual({ inserted: 2, skippedConfirmed: 1 });
  });

  it('throws on a self-referential edge before touching the DB', async () => {
    await expect(
      upsertSeededEdges([{ ...BASE_EDGE, prereqCourseCode: 'GC 3010' }]),
    ).rejects.toThrow(/self-referential/);
    expect(returningMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('updateEdge / confirmEdge', () => {
  beforeEach(() => {
    // Default: return a row so no-op guard is not triggered
    updateReturningMock.mockReset().mockResolvedValue([{ id: 'edge-id-1' }]);
  });

  it('confirmEdge sets confirmed=true, source=faculty, confidence=high', async () => {
    await confirmEdge('edge-id-1');
    expect(updateReturningMock).toHaveBeenCalledOnce();
    const setArg = updateReturningMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg.confirmed).toBe(true);
    expect(setArg.source).toBe('faculty');
    expect(setArg.confidence).toBe('high');
  });

  it('updateEdge only spreads provided fields', async () => {
    await updateEdge({ id: 'edge-id-2', expectedK: 3 });
    const setArg = updateReturningMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg.expectedK).toBe(3);
    // confirmed was not passed — should not appear in the set object
    expect('confirmed' in setArg).toBe(false);
    expect('source' in setArg).toBe(false);
  });

  it('updateEdge with confirmed=true adds source+confidence', async () => {
    await updateEdge({ id: 'edge-id-3', confirmed: true, expectedD: 2 });
    const setArg = updateReturningMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg.confirmed).toBe(true);
    expect(setArg.source).toBe('faculty');
    expect(setArg.confidence).toBe('high');
    expect(setArg.expectedD).toBe(2);
  });

  it('updateEdge throws when confirmed=false (downgrade rejected)', async () => {
    await expect(
      updateEdge({ id: 'edge-id-4', confirmed: false }),
    ).rejects.toThrow(/cannot unconfirm/);
    expect(updateReturningMock).not.toHaveBeenCalled();
  });

  it('updateEdge throws when the edge does not exist (zero rows returned)', async () => {
    updateReturningMock.mockResolvedValue([]);
    await expect(
      updateEdge({ id: 'nonexistent-id', expectedK: 1 }),
    ).rejects.toThrow(/edge not found/);
  });
});

// ---------------------------------------------------------------------------

describe('deleteEdge', () => {
  beforeEach(() => {
    deleteMock.mockReset().mockResolvedValue(undefined);
    updateReturningMock.mockReset();
  });

  it('calls delete on the db', async () => {
    await deleteEdge('edge-id-99');
    expect(deleteMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------

describe('getEdgeById', () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
  });

  it('returns the row when found', async () => {
    const fakeRow = {
      id: 'edge-abc',
      focalCourseCode: 'GC 3010',
      prereqCourseCode: 'GC 2010',
      subCompetencyId: 'sub-1',
      expectedK: 2,
      expectedU: 2,
      expectedD: 1,
      source: 'faculty',
      confidence: 'high',
      confirmed: true,
      rationale: 'rationale text',
    };
    selectLimitMock.mockResolvedValue([fakeRow]);
    const result = await getEdgeById('edge-abc');
    expect(result).toEqual(fakeRow);
  });

  it('returns null when no row found', async () => {
    selectLimitMock.mockResolvedValue([]);
    const result = await getEdgeById('nonexistent-id');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pure BFS — no DB required
// ---------------------------------------------------------------------------

describe('bfsWouldCycle (pure helper)', () => {
  it('returns true for a direct self-reference (focal === prereq)', () => {
    expect(bfsWouldCycle('A', 'A', new Map())).toBe(true);
  });

  it('returns false for an empty graph', () => {
    expect(bfsWouldCycle('A', 'B', new Map())).toBe(false);
  });

  it('detects a direct cycle: B already has A as a prereq, adding A→B would cycle', () => {
    // existing edge: B→A (A is prereq of B, meaning B depends on A)
    const adj = new Map([['B', ['A']]]);
    // proposed: A→B (make B a prereq of A)
    // walking from B: B→A, find 'A' === focal 'A' → cycle
    expect(bfsWouldCycle('A', 'B', adj)).toBe(true);
  });

  it('detects a transitive cycle: A→B→C, adding C→A would cycle', () => {
    const adj = new Map<string, string[]>([
      ['A', ['B']],
      ['B', ['C']],
    ]);
    // proposed: focal=C, prereq=A  → walk from A: A→B→C, find C === focal → cycle
    expect(bfsWouldCycle('C', 'A', adj)).toBe(true);
  });

  it('returns false when no path exists (disjoint graph)', () => {
    const adj = new Map<string, string[]>([
      ['X', ['Y']],
      ['Y', ['Z']],
    ]);
    // A and B are not connected to X/Y/Z
    expect(bfsWouldCycle('A', 'B', adj)).toBe(false);
  });

  it('handles a diamond without infinite looping (visited set prevents re-visit)', () => {
    // Diamond: A→B, A→C, B→D, C→D
    // Adding D→E: focal=D, prereq=E — E is not in graph, no cycle.
    const adj = new Map<string, string[]>([
      ['A', ['B', 'C']],
      ['B', ['D']],
      ['C', ['D']],
    ]);
    expect(bfsWouldCycle('D', 'E', adj)).toBe(false);
    // Adding E→A where A→B→D means A reaches D; focal=D, prereq=A → cycle
    expect(bfsWouldCycle('D', 'A', adj)).toBe(true);
  });

  it('does NOT cycle when B→…→A is absent', () => {
    // Only A depends on B; B has no outgoing edges
    const adj = new Map<string, string[]>([['A', ['B']]]);
    // proposed: focal=X, prereq=B — X is not reachable from B
    expect(bfsWouldCycle('X', 'B', adj)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// wouldCreateCycle (DB-backed wrapper) — uses confirmed-only pairs
// ---------------------------------------------------------------------------

describe('wouldCreateCycle (DB wrapper)', () => {
  beforeEach(() => {
    selectDistinctWhereMock.mockReset();
  });

  it('returns true when CONFIRMED DB pairs show a transitive path back to focal', async () => {
    // Existing confirmed edge: B→A (A is prereq of B)
    // We want to add A→B (make B a prereq of A → would cycle)
    selectDistinctWhereMock.mockResolvedValue([{ focal: 'B', prereq: 'A' }]);
    expect(await wouldCreateCycle('A', 'B')).toBe(true);
  });

  it('returns false when no path exists', async () => {
    selectDistinctWhereMock.mockResolvedValue([
      { focal: 'X', prereq: 'Y' },
      { focal: 'Y', prereq: 'Z' },
    ]);
    expect(await wouldCreateCycle('A', 'B')).toBe(false);
  });

  it('returns true for self-reference without querying the DB shape', async () => {
    selectDistinctWhereMock.mockResolvedValue([]);
    expect(await wouldCreateCycle('A', 'A')).toBe(true);
  });

  it('does NOT cycle when only an UNCONFIRMED seed A→B exists (confirmed-only check)', async () => {
    // listConfirmedEdgePairs returns [] because A→B is unconfirmed
    selectDistinctWhereMock.mockResolvedValue([]);
    // So the faculty's correct reverse B→A should not be blocked
    expect(await wouldCreateCycle('B', 'A')).toBe(false);
  });

  it('DOES cycle when a CONFIRMED A→B exists and faculty tries B→A', async () => {
    selectDistinctWhereMock.mockResolvedValue([{ focal: 'A', prereq: 'B' }]);
    expect(await wouldCreateCycle('B', 'A')).toBe(true);
  });
});
