/**
 * Stateful integration-style tests for the M1 fix (security review, fix
 * round 1): reissueGrant must atomically claim the old grant, so a second
 * reissue of the same id — a stale tab, a retry, a direct API replay —
 * never produces two live grants, and reissuing an already-revoked grant
 * never resurrects it or overwrites the original revoke time.
 *
 * Unlike grant-admin.test.ts's per-call configurable mock, this file runs a
 * REAL in-memory table that reissueGrant's two sequential calls both
 * mutate, so "reissue twice" is actually observable across calls. `eq`/
 * `and`/`isNull` from drizzle-orm are replaced with trivial tagged-object
 * builders (columns are just their camelCase field-name strings, since
 * '@/lib/db/schema' is also mocked to the same shape) so this file's fake
 * `where()` can interpret them generically, without reimplementing any real
 * drizzle/SQL semantics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Row {
  id: string;
  tokenHash: string;
  label: string;
  email: string | null;
  scope: string[];
  can: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

type Cond = { kind: 'eq'; column: string; value: unknown } | { kind: 'isNull'; column: string } | { kind: 'and'; conds: Cond[] };

vi.mock('drizzle-orm', () => ({
  eq: (column: string, value: unknown): Cond => ({ kind: 'eq', column, value }),
  isNull: (column: string): Cond => ({ kind: 'isNull', column }),
  and: (...conds: Cond[]): Cond => ({ kind: 'and', conds }),
}));

vi.mock('@/lib/db/schema', () => ({
  accessGrants: {
    id: 'id', tokenHash: 'tokenHash', label: 'label', email: 'email', scope: 'scope',
    can: 'can', expiresAt: 'expiresAt', revokedAt: 'revokedAt', createdAt: 'createdAt', lastUsedAt: 'lastUsedAt',
  },
}));

function matches(row: Row, cond: Cond | null): boolean {
  if (!cond) return true;
  if (cond.kind === 'eq') return (row as unknown as Record<string, unknown>)[cond.column] === cond.value;
  if (cond.kind === 'isNull') return (row as unknown as Record<string, unknown>)[cond.column] == null;
  return cond.conds.every((c) => matches(row, c));
}

let table: Row[] = [];
let idCounter = 0;

function makeFakeDb(backing: Row[]) {
  return {
    select: () => {
      let cond: Cond | null = null;
      const chain = {
        from: () => chain,
        where: (c: Cond) => { cond = c; return chain; },
        limit: (n: number) => Promise.resolve(backing.filter((r) => matches(r, cond)).slice(0, n)),
      };
      return chain;
    },
    insert: () => ({
      values: (v: Partial<Row>) => ({
        returning: () => {
          idCounter += 1;
          const row: Row = {
            id: `new-${idCounter}`, tokenHash: '', label: '', email: null, scope: [], can: [],
            expiresAt: null, revokedAt: null, createdAt: new Date(), lastUsedAt: null, ...v,
          };
          backing.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: (c: Cond) => {
          const matched = backing.filter((r) => matches(r, c));
          matched.forEach((r) => Object.assign(r, patch));
          const result = matched.map((r) => ({ ...r }));
          return {
            returning: () => Promise.resolve(result),
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(undefined).then(resolve, reject),
          };
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(makeFakeDb(backing)),
  };
}

vi.mock('@/lib/db/client', () => ({ db: makeFakeDbProxy() }));

// A Proxy so `table` (reset in beforeEach, reassigned per test) is read live
// by the mocked module instead of being captured by value at import time.
function makeFakeDbProxy() {
  return new Proxy({}, {
    get(_t, prop) {
      return (makeFakeDb(table) as unknown as Record<string, unknown>)[prop as string];
    },
  });
}

import { reissueGrant } from '@/lib/auth/grant-admin';

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'old', tokenHash: 'deadbeef', label: 'Danita Swaney', email: 'danita@example.edu',
    scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null,
    createdAt: new Date('2026-10-07T12:00:00Z'), lastUsedAt: null,
    ...over,
  };
}

beforeEach(() => { table = []; idCounter = 0; });

describe('reissueGrant — atomic claim (fix round 1, M1)', () => {
  it('double reissue: the second call 409s (revoked) and exactly one grant for the person stays live', async () => {
    table.push(row());

    const first = await reissueGrant('old');
    expect(first).not.toBe('not-found');
    expect(first).not.toBe('revoked');

    const second = await reissueGrant('old');
    expect(second).toBe('revoked');

    const live = table.filter((r) => !r.revokedAt);
    expect(live).toHaveLength(1);
    expect(table).toHaveLength(2); // old (revoked) + the one new grant from the FIRST reissue only
  });

  it('reissue of an already-revoked id 409s and never changes the original revokedAt', async () => {
    const revokedAt = new Date('2020-01-01T00:00:00Z');
    table.push(row({ revokedAt }));

    const result = await reissueGrant('old');

    expect(result).toBe('revoked');
    expect(table).toHaveLength(1); // no grant minted
    expect(table[0]!.revokedAt).toEqual(revokedAt); // original revoke time untouched
  });
});
