import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mutable references so vi.mock factories can access them.
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn(async () => {}) }));

vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue }));
vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: () => true }));
vi.mock('@/lib/capture/ingest-selection', () => ({ ingestAction: () => 'queue' }));
vi.mock('@/lib/db/schema', () => ({ courseMaterials: {}, courses: {} }));

// The route makes two db.select() calls:
//   1. courses lookup: .select({ code }).from(courses).where(...).limit(1)
//      → returns [{ code: 'GC 1010' }]
//   2. materials lookup: .select().from(courseMaterials).where(and(...))
//      → awaited directly (no .limit()), returns [] (empty — no materials)
//
// We use a call-counter to produce the right shape per call.
let selectCallCount = 0;

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => {
      selectCallCount++;
      const callIndex = selectCallCount;
      if (callIndex === 1) {
        // First call: course existence check — chain ends with .limit()
        return {
          from: () => ({
            where: () => ({
              limit: async () => [{ code: 'GC 1010' }],
            }),
          }),
        };
      }
      // Second call: materials list — chain ends at .where(), awaited directly
      return {
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      };
    },
  },
}));

import { POST } from '../route';

function req(body: unknown) {
  return new Request('http://x/api/admin/v2-backfill', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('v2-backfill mode param', () => {
  beforeEach(() => {
    enqueue.mockClear();
    selectCallCount = 0;
  });

  it('rejects an invalid mode with 400', async () => {
    const res = await POST(req({ courseCode: 'GC 1010', slug: 's', mode: 'bogus' }));
    expect(res.status).toBe(400);
  });

  it('accepts mode:hybrid (default) without error', async () => {
    const res = await POST(req({ courseCode: 'GC 1010', slug: 's', mode: 'hybrid' }));
    expect(res.status).toBe(200);
  });

  it('accepts mode:local without error', async () => {
    const res = await POST(req({ courseCode: 'GC 1010', slug: 's', mode: 'local' }));
    expect(res.status).toBe(200);
  });

  it('defaults to hybrid when mode is omitted', async () => {
    const res = await POST(req({ courseCode: 'GC 1010', slug: 's' }));
    expect(res.status).toBe(200);
  });
});
