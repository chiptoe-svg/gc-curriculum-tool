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
// The conditional-claim UPDATE inside reissueGrant calls .returning(); default
// to echoing back whatever txSelectResult held (i.e. "the claim succeeded"),
// overridable per-test to simulate "someone else already revoked it" (empty).
let txUpdateReturning: unknown[] | null = null;
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
            return {
              where: () => ({
                returning: () => Promise.resolve(txUpdateReturning ?? txSelectResult),
                then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                  Promise.resolve(undefined).then(resolve, reject),
              }),
            };
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
  isValidGrantId,
} from '@/lib/auth/grant-admin';

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = [];
  insertResult = [];
  insertValuesCapture = null;
  txSelectResult = [];
  txInsertResult = [];
  txInsertValuesCapture = null;
  txUpdateReturning = null;
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
  it('refuses (admin-managed) to edit a CLI admin grant, and never calls update', async () => {
    selectResult = [row({ can: ['capture', 'create', 'admin'], revokedAt: null })];
    expect(await patchGrant('g1', { label: 'New' })).toBe('admin-managed');
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

  // ── F3 (security review 2026-10-07): refuse to revoke the LAST live
  // admin grant — the owner could otherwise lock themselves out of every
  // /admin surface (no built-in Basic Auth carries admin anymore, so a DB
  // grant is the only way back in; CLI-only repair otherwise).
  it('refuses (last-admin) to revoke the only live admin grant, and never calls update', async () => {
    selectResult = [row({ id: 'admin1', can: ['capture', 'create', 'admin'], revokedAt: null })];
    expect(await revokeGrant('admin1')).toBe('last-admin');
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('allows revoking an admin grant when ANOTHER live admin grant exists', async () => {
    selectResult = [
      row({ id: 'admin1', can: ['capture', 'create', 'admin'], revokedAt: null }),
      row({ id: 'admin2', can: ['capture', 'create', 'admin'], revokedAt: null }),
    ];
    expect(await revokeGrant('admin1')).toBe('ok');
    expect(updateSetMock).toHaveBeenCalledTimes(1);
  });

  it('a REVOKED other admin grant does not count as "another live admin" — still last-admin', async () => {
    selectResult = [
      row({ id: 'admin1', can: ['capture', 'create', 'admin'], revokedAt: null }),
      row({ id: 'admin2', can: ['capture', 'create', 'admin'], revokedAt: new Date('2020-01-01T00:00:00Z') }),
    ];
    expect(await revokeGrant('admin1')).toBe('last-admin');
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('an EXPIRED other admin grant does not count as "another live admin" — still last-admin', async () => {
    selectResult = [
      row({ id: 'admin1', can: ['capture', 'create', 'admin'], revokedAt: null }),
      row({ id: 'admin2', can: ['capture', 'create', 'admin'], revokedAt: null, expiresAt: new Date('2020-01-01T00:00:00Z') }),
    ];
    expect(await revokeGrant('admin1')).toBe('last-admin');
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('a non-admin grant never triggers the last-admin check, even alone', async () => {
    selectResult = [row({ id: 'g1', can: ['capture'], revokedAt: null })];
    expect(await revokeGrant('g1')).toBe('ok');
    expect(updateSetMock).toHaveBeenCalledTimes(1);
  });

  it('revoking an ALREADY-EXPIRED admin grant is allowed (not currently live, so nothing to protect)', async () => {
    selectResult = [row({ id: 'admin1', can: ['capture', 'create', 'admin'], revokedAt: null, expiresAt: new Date('2020-01-01T00:00:00Z') })];
    expect(await revokeGrant('admin1')).toBe('ok');
    expect(updateSetMock).toHaveBeenCalledTimes(1);
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
  it('rejects control characters (fix round 1, L6)', () => {
    expect(validateLabel('A\r\nBcc: evil@x.com\u0000<script>')).toHaveProperty('error');
    expect(validateLabel('Danita\u007f')).toHaveProperty('error');
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
  it('rejects control characters (fix round 1, L6)', () => {
    expect(validateEmail('a\u0000b@x.com')).toHaveProperty('error');
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
  it('interprets a date-only string as end of that day in America/New_York (fix round 1, L5)', () => {
    const winter = validateExpiresAt('2026-01-15') as { expiresAt: Date };
    expect(winter.expiresAt.toISOString()).toBe('2026-01-16T04:59:59.999Z'); // EST, UTC-5
    const summer = validateExpiresAt('2026-07-15') as { expiresAt: Date };
    expect(summer.expiresAt.toISOString()).toBe('2026-07-16T03:59:59.999Z'); // EDT, UTC-4
  });
  it('rejects a date-only string that is not a real calendar date', () => {
    expect(validateExpiresAt('2026-02-30')).toHaveProperty('error');
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
  it('rejects "*" mixed into an array of courses (fix round 1, L2)', () => {
    expect(resolveScope(['*', 'GC 1010'], known)).toHaveProperty('error');
  });
  it('rejects a percent-encoded wildcard, even alone (fix round 1, L2)', () => {
    expect(resolveScope(['%2A'], known)).toHaveProperty('error');
  });
  it('dedupes equivalent codes after normalizing (fix round 1, L2)', () => {
    expect(resolveScope(['gc 1010', ' GC  1010 ', 'GC%201010'], known)).toEqual({ scope: ['GC 1010'] });
  });
});

describe('reissueGrant', () => {
  it('returns not-found when the grant does not exist, touching neither update nor insert', async () => {
    txSelectResult = [];
    expect(await reissueGrant('nope')).toBe('not-found');
    expect(txUpdateSetMock).not.toHaveBeenCalled();
    expect(txInsertCalledMock).not.toHaveBeenCalled();
  });

  it("refuses (admin-managed) a CLI admin grant without touching it (fix round 1, L1)", async () => {
    txSelectResult = [row({ can: ['capture', 'create', 'admin'], revokedAt: null })];
    expect(await reissueGrant('old')).toBe('admin-managed');
    expect(txUpdateSetMock).not.toHaveBeenCalled();
    expect(txInsertCalledMock).not.toHaveBeenCalled();
  });

  it('refuses (revoked) a grant that is already revoked, leaving its revokedAt untouched (fix round 1, M1 scenario B)', async () => {
    const revokedAt = new Date('2020-01-01T00:00:00Z');
    txSelectResult = [row({ revokedAt })];
    expect(await reissueGrant('old')).toBe('revoked');
    expect(txUpdateSetMock).not.toHaveBeenCalled();
    expect(txInsertCalledMock).not.toHaveBeenCalled();
  });

  it('refuses (expired) a grant whose expiry has already passed (fix round 1, L5)', async () => {
    txSelectResult = [row({ expiresAt: new Date('2020-01-01T00:00:00Z'), revokedAt: null })];
    expect(await reissueGrant('old')).toBe('expired');
    expect(txUpdateSetMock).not.toHaveBeenCalled();
    expect(txInsertCalledMock).not.toHaveBeenCalled();
  });

  it('returns revoked (no insert) when the conditional claim matches zero rows — the race-safety path (fix round 1, M1)', async () => {
    // Pre-check SELECT still sees it live (a concurrent reissue claimed it
    // first, between our read and our conditional UPDATE), so the UPDATE …
    // WHERE revoked_at IS NULL … RETURNING finds nothing to claim.
    txSelectResult = [row({ revokedAt: null })];
    txUpdateReturning = [];
    expect(await reissueGrant('old')).toBe('revoked');
    expect(txInsertCalledMock).not.toHaveBeenCalled();
  });

  it('revokes the old grant and creates a new one with the same label/email/scope/expiresAt, can rebuilt via buildCan, atomically', async () => {
    const existing = row({ id: 'old', label: 'Danita Swaney', email: 'danita@example.edu', scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null });
    txSelectResult = [existing];
    txInsertResult = [row({ id: 'new' })];

    const result = await reissueGrant('old');

    expect(txUpdateSetMock).toHaveBeenCalledTimes(1);
    const revokeArg = txUpdateSetMock.mock.calls[0]![0] as { revokedAt: Date };
    expect(revokeArg.revokedAt).toBeInstanceOf(Date);

    expect(txInsertValuesCapture).toMatchObject({ label: 'Danita Swaney', email: 'danita@example.edu', scope: ['GC 3730'], can: ['capture'], expiresAt: null });
    expect(result).not.toBe('not-found');
    expect(result).not.toBe('revoked');
    const minted = result as { grant: { id: string }; token: string };
    expect(minted.grant.id).toBe('new');
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(minted.token)).toBe(txInsertValuesCapture!.tokenHash);

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

  it('rebuilds can from the create flag rather than copying verbatim (defense in depth; admin is already excluded upstream)', async () => {
    txSelectResult = [row({ can: ['capture', 'create'], revokedAt: null })];
    txInsertResult = [row({ id: 'new' })];
    await reissueGrant('old');
    expect(txInsertValuesCapture!.can).toEqual(['capture', 'create']);
  });
});

describe('isValidGrantId', () => {
  it('accepts a 36-char hyphenated UUID shape', () => {
    expect(isValidGrantId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });
  it('rejects built-in ids, SQL-injection-shaped strings, and path traversal (fix round 1, L3)', () => {
    expect(isValidGrantId('builtin:faculty:deadbeefdeadbeef')).toBe(false);
    expect(isValidGrantId("1' OR '1'='1")).toBe(false);
    expect(isValidGrantId('../../x')).toBe(false);
  });
  it('rejects a 36-char string of the right length but wrong shape (fix round 2, N5)', () => {
    expect(isValidGrantId('------------------------------------')).toBe(false); // 36 hyphens
    expect(isValidGrantId('a'.repeat(36))).toBe(false); // 36 hex-alphabet chars, no hyphens at all
    expect(isValidGrantId('123e4567e89b12d3a456426614174000gg')).toBe(false); // right length, missing dashes
  });
});
