/**
 * Stateful integration-style test for G3(a) (security re-review,
 * 2026-10-07): revokeGrant must not let two concurrent revokes of two
 * DIFFERENT admin grants each see the other as "the live admin that
 * protects me" and both succeed, which would leave zero admins.
 *
 * Unlike grant-admin.test.ts's per-call configurable mock, this file runs a
 * REAL in-memory table shared across "concurrent" calls, with a lock queue
 * standing in for Postgres's real row lock: `db.transaction`'s callback
 * only runs for ONE caller at a time, and `tx.select().for('update')`
 * resolves only once that caller holds the lock — exactly the serialization
 * `SELECT … FOR UPDATE` provides in real Postgres. `eq`/`isNull`/`and` from
 * drizzle-orm are replaced with trivial tagged-object builders (same trick
 * grant-admin-reissue-atomic.test.ts uses) so this file's fake `where()`
 * can interpret them generically, without reimplementing any real
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

/**
 * A lock queue standing in for a real Postgres row lock: at most one
 * "transaction" callback runs at a time. `acquire()` resolves immediately
 * if the lock is free, else queues until `release()` runs.
 */
function makeLock() {
  let locked = false;
  const waiters: Array<() => void> = [];
  return {
    async acquire(): Promise<void> {
      if (!locked) { locked = true; return; }
      await new Promise<void>((resolve) => waiters.push(resolve));
      locked = true;
    },
    release(): void {
      locked = false;
      const next = waiters.shift();
      if (next) next();
    },
  };
}
const lock = makeLock();

function makeLockedTx(backing: Row[]) {
  return {
    select: () => {
      let cond: Cond | null = null;
      const chain = {
        from: () => chain,
        where: (c: Cond) => { cond = c; return chain; },
        // The lock is already held by the time this resolves (acquired by
        // `transaction()` before the callback runs), so this snapshot
        // reflects every prior commit — exactly what `FOR UPDATE` guarantees.
        for: () => Promise.resolve(backing.filter((r) => matches(r, cond))),
      };
      return chain;
    },
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: (c: Cond) => {
          const matched = backing.filter((r) => matches(r, c));
          matched.forEach((r) => Object.assign(r, patch));
          return {
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(undefined).then(resolve, reject),
          };
        },
      }),
    }),
  };
}

vi.mock('@/lib/db/client', () => ({
  db: new Proxy({}, {
    get(_t, prop) {
      if (prop === 'transaction') {
        return async (fn: (tx: unknown) => unknown) => {
          await lock.acquire();
          try {
            return await fn(makeLockedTx(table));
          } finally {
            lock.release();
          }
        };
      }
      return undefined;
    },
  }),
}));

import { revokeGrant } from '@/lib/auth/grant-admin';

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'g1', tokenHash: 'deadbeef', label: 'grant', email: null,
    scope: ['*'], can: ['capture', 'create', 'admin'], expiresAt: null, revokedAt: null,
    createdAt: new Date('2026-10-07T12:00:00Z'), lastUsedAt: null,
    ...over,
  };
}

beforeEach(() => { table = []; });

describe('revokeGrant — atomic last-admin guard under concurrency (G3a)', () => {
  it('concurrent revoke of two admin grants: exactly one succeeds, never both — at least one admin always survives', async () => {
    table.push(row({ id: 'admin1' }), row({ id: 'admin2' }));

    const [r1, r2] = await Promise.all([revokeGrant('admin1'), revokeGrant('admin2')]);

    const results = [r1, r2].sort();
    expect(results).toEqual(['last-admin', 'ok']);
    const liveAdmins = table.filter((r) => !r.revokedAt);
    expect(liveAdmins).toHaveLength(1);
  });

  it('three admins, two revoked concurrently: both succeed (a third live admin always remained)', async () => {
    table.push(row({ id: 'admin1' }), row({ id: 'admin2' }), row({ id: 'admin3' }));

    const [r1, r2] = await Promise.all([revokeGrant('admin1'), revokeGrant('admin2')]);

    expect([r1, r2].sort()).toEqual(['ok', 'ok']);
    const liveAdmins = table.filter((r) => !r.revokedAt);
    expect(liveAdmins).toHaveLength(1);
    expect(liveAdmins[0]!.id).toBe('admin3');
  });

  it('sequential revoke of two admins: the second correctly sees the first\'s commit and refuses', async () => {
    table.push(row({ id: 'admin1' }), row({ id: 'admin2' }));

    const first = await revokeGrant('admin1');
    const second = await revokeGrant('admin2');

    expect(first).toBe('ok');
    expect(second).toBe('last-admin');
    const liveAdmins = table.filter((r) => !r.revokedAt);
    expect(liveAdmins).toHaveLength(1);
    expect(liveAdmins[0]!.id).toBe('admin2');
  });
});
