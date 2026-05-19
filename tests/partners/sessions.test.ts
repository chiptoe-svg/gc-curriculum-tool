import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertReturning = vi.fn();
const selectLimit = vi.fn();
const deleteWhere = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    delete: () => ({ where: deleteWhere }),
  },
}));
vi.mock('@/lib/db/schema', () => ({ partnerSessions: {} }));

import { createSession, lookupSession, revokeSession, SESSION_TTL_MS } from '@/lib/partners/sessions';

beforeEach(() => {
  insertReturning.mockReset();
  selectLimit.mockReset();
  deleteWhere.mockReset().mockResolvedValue(undefined);
});

describe('session helpers', () => {
  it('createSession returns id + expiresAt ~24h in future', async () => {
    insertReturning.mockResolvedValue([{ id: 'sess-1', expiresAt: new Date(Date.now() + SESSION_TTL_MS) }]);
    const out = await createSession('partner-1');
    expect(out.id).toBe('sess-1');
    const ms = out.expiresAt.getTime() - Date.now();
    expect(ms).toBeGreaterThan(SESSION_TTL_MS - 1000);
    expect(ms).toBeLessThanOrEqual(SESSION_TTL_MS + 1000);
  });

  it('lookupSession returns null on expired sessions', async () => {
    selectLimit.mockResolvedValue([{ id: 'sess-1', partnerId: 'p', expiresAt: new Date(Date.now() - 1000) }]);
    const out = await lookupSession('sess-1');
    expect(out).toBeNull();
  });

  it('lookupSession returns the row when not expired', async () => {
    const row = { id: 'sess-1', partnerId: 'p', expiresAt: new Date(Date.now() + 60_000) };
    selectLimit.mockResolvedValue([row]);
    const out = await lookupSession('sess-1');
    expect(out).toEqual(row);
  });

  it('revokeSession deletes by id', async () => {
    await revokeSession('sess-1');
    expect(deleteWhere).toHaveBeenCalled();
  });
});
