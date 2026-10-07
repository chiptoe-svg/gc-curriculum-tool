/**
 * Tests for lib/auth/grant-admin.ts — the shared grant-admin helpers behind
 * both scripts/access/grant.ts and the /api/admin/access routes (spec:
 * docs/superpowers/specs/2026-10-07-faculty-access-panel-design.md).
 *
 * DB convention: mock @/lib/db/client (same as course-roster-queries.test.ts).
 * select().from().where().limit(n) and select().from().orderBy() are both
 * exercised; db.transaction(fn) hands fn a tx mock with the same select /
 * insert / update chain shapes, captured separately so assertions can tell
 * top-level calls from in-transaction calls apart.
 */
import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashToken, signSession, grantFromSessionCookie, type StoredGrant } from '@/lib/auth/grants';

let selectResult: unknown[] = [];
let insertValuesCapture: Record<string, unknown> | null = null;
let insertResult: unknown[] = [];
const updateSetMock = vi.fn();

let txSelectResult: unknown[] = [];
let txInsertValuesCapture: Record<string, unknown> | null = null;
let txInsertResult: unknown[] = [];
const txUpdateSetMock = vi.fn();
const txInsertCalledMock = vi.fn();

function selectChain(result: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: (_n: number) => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => selectChain(selectResult),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertValuesCapture = v;
        return { returning: () => Promise.resolve(insertResult) };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updateSetMock(v);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => selectChain(txSelectResult),
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            txInsertValuesCapture = v;
            txInsertCalledMock();
            return { returning: () => Promise.resolve(txInsertResult) };
          },
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => {
            txUpdateSetMock(v);
            return { where: () => Promise.resolve(undefined) };
          },
        }),
      }),
  },
}));

import {
  buildCan,
  computeStatus,
  buildAccessLink,
  createGrant,
  listGrantsForAdmin,
  patchGrant,
  revokeGrant,
  reissueGrant,
  validateLabel,
  validateEmail,
  validateExpiresAt,
  resolveScope,
} from '@/lib/auth/grant-admin';

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = [];
  insertResult = [];
  insertValuesCapture = null;
  txSelectResult = [];
  txInsertResult = [];
  txInsertValuesCapture = null;
});

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'g1',
  tokenHash: 'deadbeef',
  label: 'Danita Swaney',
  email: 'danita@example.edu',
  scope: ['GC 3730'],
  can: ['capture'],
  expiresAt: null,
  revokedAt: null,
  createdAt: new Date('2026-10-07T12:00:00Z'),
  lastUsedAt: null,
  ...over,
});

describe('buildCan', () => {
  it('always includes capture; create only when canCreate is true; admin never', () => {
    expect(buildCan(false)).toEqual(['capture']);
    expect(buildCan(true)).toEqual(['capture', 'create']);
    for (const c of [buildCan(false), buildCan(true)]) expect(c).not.toContain('admin');
  });
});

describe('computeStatus', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it('revoked wins over expiry', () => {
    expect(computeStatus({ revokedAt: new Date('2026-01-01T00:00:00Z'), expiresAt: null }, now)).toBe('revoked');
    expect(computeStatus({ revokedAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2099-01-01T00:00:00Z') }, now)).toBe('revoked');
  });
  it('expired when expiresAt <= now and not revoked', () => {
    expect(computeStatus({ revokedAt: null, expiresAt: new Date('2026-10-07T12:00:00Z') }, now)).toBe('expired');
    expect(computeStatus({ revokedAt: null, expiresAt: new Date('2026-10-07T11:59:59Z') }, now)).toBe('expired');
  });
  it('active otherwise (null expiry or future expiry)', () => {
    expect(computeStatus({ revokedAt: null, expiresAt: null }, now)).toBe('active');
    expect(computeStatus({ revokedAt: null, expiresAt: new Date('2099-01-01T00:00:00Z') }, now)).toBe('active');
  });
});

describe('buildAccessLink', () => {
  it('builds a ?key= link off the given origin, trimming a trailing slash', () => {
    expect(buildAccessLink('tok123', 'https://gcworkflow.clemson.edu:8443/')).toBe('https://gcworkflow.clemson.edu:8443/?key=tok123');
  });
  it('falls back to the default campus origin when none is given', () => {
    expect(buildAccessLink('tok123')).toBe('https://gcworkflow.clemson.edu:8443/?key=tok123');
  });
});

describe('createGrant', () => {
  it('mints a token, inserts a hashed grant, and returns the token exactly once (never tokenHash)', async () => {
    insertResult = [row()];
    const result = await createGrant({ label: 'Danita Swaney', email: 'danita@example.edu', scope: ['GC 3730'], can: ['capture'], expiresAt: null });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(result.token)).toBe(insertValuesCapture!.tokenHash);
    expect(insertValuesCapture).toMatchObject({ label: 'Danita Swaney', email: 'danita@example.edu', scope: ['GC 3730'], can: ['capture'], expiresAt: null });
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).toMatchObject({ id: 'g1', label: 'Danita Swaney', email: 'danita@example.edu', status: 'active' });
  });

  it('never inserts admin into can, regardless of what is passed', async () => {
    insertResult = [row({ can: ['capture', 'create'] })];
    await createGrant({ label: 'X', email: null, scope: ['*'], can: ['capture', 'create'], expiresAt: null });
    expect((insertValuesCapture!.can as string[])).not.toContain('admin');
  });
});

describe('listGrantsForAdmin', () => {
  it('never returns tokenHash and computes status per row', async () => {
    const now = new Date('2026-10-07T12:00:00Z');
    selectResult = [
      row({ id: 'active', revokedAt: null, expiresAt: null }),
      row({ id: 'expired', revokedAt: null, expiresAt: new Date('2026-01-01T00:00:00Z') }),
      row({ id: 'revoked', revokedAt: new Date('2026-01-01T00:00:00Z') }),
    ];
    const out = await listGrantsForAdmin(now);
    expect(out).toHaveLength(3);
    for (const g of out) expect(g).not.toHaveProperty('tokenHash');
    expect(out.find(g => g.id === 'active')!.status).toBe('active');
    expect(out.find(g => g.id === 'expired')!.status).toBe('expired');
    expect(out.find(g => g.id === 'revoked')!.status).toBe('revoked');
  });
});

describe('patchGrant', () => {
  it('returns not-found when the id does not exist, and never calls update', async () => {
    selectResult = [];
    expect(await patchGrant('nope', { label: 'New' })).toBe('not-found');
    expect(updateSetMock).not.toHaveBeenCalled();
  });
  it('refuses (revoked) to edit a revoked grant, and never calls update', async () => {
    selectResult = [row({ revokedAt: new Date() })];
    expect(await patchGrant('g1', { label: 'New' })).toBe('revoked');
    expect(updateSetMock).not.toHaveBeenCalled();
  });
  it('applies only the provided fields on a live grant', async () => {
    selectResult = [row({ revokedAt: null })];
    expect(await patchGrant('g1', { scope: ['GC 1010'] })).toBe('ok');
    expect(updateSetMock).toHaveBeenCalledWith({ scope: ['GC 1010'] });
  });
});

describe('revokeGrant', () => {
  it('returns not-found when the id does not exist', async () => {
    selectResult = [];
    expect(await revokeGrant('nope')).toBe('not-found');
    expect(updateSetMock).not.toHaveBeenCalled();
  });
  it('revokes a live grant (idempotent — a second call does not re-fire the update)', async () => {
    selectResult = [row({ revokedAt: null })];
    expect(await revokeGrant('g1')).toBe('ok');
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const arg = updateSetMock.mock.calls[0]![0] as { revokedAt: Date };
    expect(arg.revokedAt).toBeInstanceOf(Date);
  });
  it('is a no-op (still ok) when already revoked, and does not overwrite the original revoke time', async () => {
    selectResult = [row({ revokedAt: new Date('2020-01-01T00:00:00Z') })];
    expect(await revokeGrant('g1')).toBe('ok');
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});

describe('validateLabel', () => {
  it('trims and accepts 1-120 chars', () => {
    expect(validateLabel('  Danita Swaney  ')).toEqual({ label: 'Danita Swaney' });
  });
  it('rejects empty, whitespace-only, non-string, and over-120', () => {
    expect(validateLabel('')).toHaveProperty('error');
    expect(validateLabel('   ')).toHaveProperty('error');
    expect(validateLabel(42)).toHaveProperty('error');
    expect(validateLabel('x'.repeat(121))).toHaveProperty('error');
    expect(validateLabel('x'.repeat(120))).toEqual({ label: 'x'.repeat(120) });
  });
});

describe('validateEmail', () => {
  it('accepts undefined/null/empty as no email', () => {
    expect(validateEmail(undefined)).toEqual({ email: null });
    expect(validateEmail(null)).toEqual({ email: null });
    expect(validateEmail('')).toEqual({ email: null });
    expect(validateEmail('  ')).toEqual({ email: null });
  });
  it('accepts a plausible email, trimmed', () => {
    expect(validateEmail('  danita@example.edu  ')).toEqual({ email: 'danita@example.edu' });
  });
  it('rejects spaces, missing/extra @, and over-254 chars', () => {
    expect(validateEmail('danita @example.edu')).toHaveProperty('error');
    expect(validateEmail('not-an-email')).toHaveProperty('error');
    expect(validateEmail('a@b@c.edu')).toHaveProperty('error');
    expect(validateEmail('a'.repeat(250) + '@b.edu')).toHaveProperty('error');
    expect(validateEmail(42)).toHaveProperty('error');
  });
});

describe('validateExpiresAt', () => {
  it('undefined/null means never expires', () => {
    expect(validateExpiresAt(undefined)).toEqual({ expiresAt: null });
    expect(validateExpiresAt(null)).toEqual({ expiresAt: null });
  });
  it('parses a valid ISO date string', () => {
    const r = validateExpiresAt('2027-01-01T00:00:00.000Z') as { expiresAt: Date };
    expect(r.expiresAt).toBeInstanceOf(Date);
    expect(r.expiresAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('rejects a non-date string and a non-string', () => {
    expect(validateExpiresAt('not-a-date')).toHaveProperty('error');
    expect(validateExpiresAt(123)).toHaveProperty('error');
  });
});

describe('resolveScope', () => {
  const known = ['GC 3730', 'GC 1010'];
  it('accepts the literal wildcard', () => {
    expect(resolveScope('*', known)).toEqual({ scope: ['*'] });
  });
  it('accepts and normalizes a non-empty array of known codes', () => {
    expect(resolveScope(['gc 3730', 'GC%201010'], known)).toEqual({ scope: ['GC 3730', 'GC 1010'] });
  });
  it('rejects unknown codes, naming them', () => {
    const r = resolveScope(['GC 3730', 'GC 9999'], known) as { error: string };
    expect(r.error).toMatch(/GC 9999/);
  });
  it('rejects an empty array, non-array, and non-string entries', () => {
    expect(resolveScope([], known)).toHaveProperty('error');
    expect(resolveScope(undefined, known)).toHaveProperty('error');
    expect(resolveScope([1, 2], known)).toHaveProperty('error');
  });
});

describe('reissueGrant', () => {
  it('returns null when the grant does not exist, touching neither update nor insert', async () => {
    txSelectResult = [];
    expect(await reissueGrant('nope')).toBeNull();
    expect(txUpdateSetMock).not.toHaveBeenCalled();
    expect(txInsertCalledMock).not.toHaveBeenCalled();
  });

  it('revokes the old grant and creates a new one with the same label/email/scope/can/expiresAt, atomically', async () => {
    const existing = row({ id: 'old', label: 'Danita Swaney', email: 'danita@example.edu', scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null });
    txSelectResult = [existing];
    txInsertResult = [row({ id: 'new' })];

    const result = await reissueGrant('old');

    expect(txUpdateSetMock).toHaveBeenCalledTimes(1);
    const revokeArg = txUpdateSetMock.mock.calls[0]![0] as { revokedAt: Date };
    expect(revokeArg.revokedAt).toBeInstanceOf(Date);

    expect(txInsertValuesCapture).toMatchObject({ label: 'Danita Swaney', email: 'danita@example.edu', scope: ['GC 3730'], can: ['capture'], expiresAt: null });
    expect(result).not.toBeNull();
    expect(result!.grant.id).toBe('new');
    expect(result!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(result!.token)).toBe(txInsertValuesCapture!.tokenHash);

    // Red-proof the core security property (spec Testing section): a session
    // cookie signed for the OLD grant id must resolve 'dead' once the DB
    // reflects the revoke this call just made — sessions are keyed by grant
    // id, so a rotated hash alone would leave old signed-in browsers alive.
    const secret = 's'.repeat(32);
    const cookie = signSession('old', secret);
    const postUpdateRow = { ...existing, revokedAt: revokeArg.revokedAt } as StoredGrant;
    const resolved = await grantFromSessionCookie(cookie, {
      findGrantById: async () => postUpdateRow,
      env: { sessionSecret: secret },
    });
    expect(resolved).toBe('dead');
  });
});
