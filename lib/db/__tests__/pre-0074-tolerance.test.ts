/** Where migration 0074 is not applied: string reads and loadTree degrade instead of throwing. Mocked errors, no database. */
import { describe, it, expect } from 'vitest';
import { loadTree } from '@/lib/db/skill-tree-queries';
import { loadGraph } from '@/lib/db/string-queries';

const pgErr = (code: string) => Object.assign(new Error('pg'), { cause: { code } });

describe('loadTree without 0074 tables', () => {
  it('returns an empty tree on undefined_table', async () => {
    const exec = { select: () => ({ from: () => ({ orderBy: () => Promise.reject(pgErr('42P01')) }) }) };
    expect(await loadTree(exec as never)).toEqual({ nodes: [], leaves: [], depths: [] });
  });
  it('rethrows other errors', async () => {
    const exec = { select: () => ({ from: () => ({ orderBy: () => Promise.reject(pgErr('08006')) }) }) };
    await expect(loadTree(exec as never)).rejects.toThrow();
  });
});

describe('loadGraph without 0074 columns', () => {
  const pointRow = { id: 'p1', courseCode: 'GC 1010', role: 'requires', statement: 's', statementHash: 'h', snapshotId: null, k: 1, u: 1, d: 1, term: 1 };
  /** Rejects any select that names a 0074 column in its field list, as Postgres would; otherwise serves canned rows by the table's name. */
  function fakeExec(mode: 'missing' | 'present') {
    const exec: Record<string, unknown> = {
      transaction: async (fn: (t: unknown) => unknown) => fn(exec),
      select: (cols?: Record<string, unknown>) => {
        const keys = cols ? Object.keys(cols) : null;
        const touches0074 = keys === null || keys.includes('nodeId') || keys.includes('needK');
        const chain: Record<string, unknown> = {};
        let table = '';
        const proxy = new Proxy(chain, {
          get(_t, prop: string) {
            if (prop === 'then') {
              return (res: (v: unknown) => void, rej: (e: unknown) => void) => {
                if (table === 'string_points' && touches0074 && mode === 'missing') return rej(pgErr('42703'));
                if (table === 'string_points') return res(keys === null || !keys.includes('nodeId') ? [pointRow] : [{ id: 'p1', nodeId: 'n1', needK: 3, needU: null, needD: 2 }]);
                if (table === 'curriculum_strings') return res([{ id: 's1', name: 'n', description: '', status: 'active', endNote: null, mergedInto: null, version: 1 }]);
                if (table === 'curriculum_string_path') return res([{ stringId: 's1', pointId: 'p1', position: 0 }]);
                return res([]);
              };
            }
            return (arg: unknown) => {
              if (prop === 'from') table = (arg as { [k: symbol]: string })[Symbol.for('drizzle:Name')] ?? '';
              return proxy;
            };
          },
        });
        return proxy;
      },
    };
    return exec;
  }
  it('reads points with null node fields when the columns are absent', async () => {
    const g = await loadGraph({ includeUnlocked: true }, fakeExec('missing') as never);
    expect(g.points.p1).toMatchObject({ courseCode: 'GC 1010', nodeId: null, needK: null, needD: null });
  });
  it('reads the node fields when present', async () => {
    const g = await loadGraph({ includeUnlocked: true }, fakeExec('present') as never);
    expect(g.points.p1).toMatchObject({ nodeId: 'n1', needK: 3, needD: 2 });
  });
});
