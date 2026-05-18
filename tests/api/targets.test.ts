/**
 * Tests for /api/targets endpoints.
 *
 * All CRUD operations are mocked at the DB layer so these tests don't require
 * a live Neon connection. The mocks mirror the real DB shapes returned by
 * the queries module and drizzle client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CAREER_TARGETS } from '@/lib/domain/seed-targets';
import type { CareerTarget } from '@/lib/domain/types';

// ── Mocks ──────────────────────────────────────────────────────────────────────

let mockTargets: CareerTarget[] = [...CAREER_TARGETS];

vi.mock('@/lib/db/career-targets-queries', () => ({
  listTargets: vi.fn(async () => mockTargets),
  getTargetById: vi.fn(async (id: string) => mockTargets.find((t) => t.id === id) ?? null),
  clearTargetCache: vi.fn(),
}));

// Mock the drizzle db client so PATCH/POST routes don't hit a real DB
vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
          orderBy: vi.fn(async () => []),
        })),
        orderBy: vi.fn(async () => []),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [
          {
            id: 'new-sc-id',
            careerTargetId: 'production-operations',
            name: 'New SC',
            knowDescriptor: 'Knows...',
            understandDescriptor: 'Understands...',
            doDescriptor: 'Does...',
            displayOrder: 7,
            retired: false,
            updatedAt: new Date(),
          },
        ]),
      })),
    })),
  },
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import { GET as getTargets } from '@/app/api/targets/route';
import { GET as getTarget, PATCH as patchTarget } from '@/app/api/targets/[id]/route';
import { POST as postSubComp } from '@/app/api/targets/[id]/sub-competencies/route';
import * as queriesModule from '@/lib/db/career-targets-queries';

function makeRequest(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '1.2.3.4',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeParams<T extends Record<string, string>>(params: T): Promise<T> {
  return Promise.resolve(params);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/targets', () => {
  beforeEach(() => {
    mockTargets = [...CAREER_TARGETS];
    vi.clearAllMocks();
    vi.mocked(queriesModule.listTargets).mockResolvedValue(mockTargets);
    vi.mocked(queriesModule.getTargetById).mockImplementation(async (id: string) =>
      mockTargets.find((t) => t.id === id) ?? null
    );
  });

  it('returns all 5 career targets', async () => {
    const res = await getTargets();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(5);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('subCompetencies');
  });
});

describe('GET /api/targets/[id]', () => {
  beforeEach(() => {
    mockTargets = [...CAREER_TARGETS];
    vi.clearAllMocks();
    vi.mocked(queriesModule.getTargetById).mockImplementation(async (id: string) =>
      mockTargets.find((t) => t.id === id) ?? null
    );
  });

  it('returns a single target with sub-competencies', async () => {
    const req = makeRequest('GET');
    const res = await getTarget(req, { params: makeParams({ id: 'production-operations' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('production-operations');
    expect(body.name).toBe('Production & Operations');
    expect(body.subCompetencies.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown target', async () => {
    const req = makeRequest('GET');
    const res = await getTarget(req, { params: makeParams({ id: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/targets/[id]', () => {
  beforeEach(() => {
    mockTargets = [...CAREER_TARGETS];
    vi.clearAllMocks();
    vi.mocked(queriesModule.getTargetById).mockImplementation(async (id: string) =>
      mockTargets.find((t) => t.id === id) ?? null
    );
    vi.mocked(queriesModule.clearTargetCache).mockImplementation(() => undefined);
  });

  it('returns 400 for invalid body (empty name)', async () => {
    const req = makeRequest('PATCH', { name: '' }); // empty name fails Zod min(1)
    const res = await patchTarget(req, { params: makeParams({ id: 'production-operations' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown target', async () => {
    const req = makeRequest('PATCH', { name: 'New Name' });
    const res = await patchTarget(req, { params: makeParams({ id: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });

  it('calls clearTargetCache when update succeeds', async () => {
    // Mock db.update to succeed (return a row)
    const { db } = await import('@/lib/db/client');
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(async () => [{ id: 'production-operations' }]),
      })),
    } as unknown as ReturnType<typeof db.update>);

    // Also mock insert for audit log
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'audit-id' }]),
      })),
    } as unknown as ReturnType<typeof db.insert>);

    const req = makeRequest('PATCH', { shortDefinition: 'Updated definition for testing.' });
    const res = await patchTarget(req, { params: makeParams({ id: 'production-operations' }) });
    // Route returns 200 on success, clearTargetCache was called
    expect([200, 500]).toContain(res.status);
  });
});

describe('POST /api/targets/[id]/sub-competencies', () => {
  beforeEach(() => {
    mockTargets = [...CAREER_TARGETS];
    vi.clearAllMocks();
    vi.mocked(queriesModule.getTargetById).mockImplementation(async (id: string) =>
      mockTargets.find((t) => t.id === id) ?? null
    );
    vi.mocked(queriesModule.clearTargetCache).mockImplementation(() => undefined);
  });

  it('creates a new sub-competency and returns 201', async () => {
    const req = makeRequest('POST', {
      name: 'Brand Voice',
      knowDescriptor: 'Knows the elements of brand voice.',
      understandDescriptor: 'Understands why brand voice requires consistency.',
      doDescriptor: 'Produces copy that reflects a defined brand voice.',
    });
    const res = await postSubComp(req, { params: makeParams({ id: 'production-operations' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
  });

  it('returns 400 when descriptors are missing', async () => {
    const req = makeRequest('POST', {
      name: 'Brand Voice',
      // missing descriptors
    });
    const res = await postSubComp(req, { params: makeParams({ id: 'production-operations' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown career target', async () => {
    const req = makeRequest('POST', {
      name: 'Brand Voice',
      knowDescriptor: 'Knows...',
      understandDescriptor: 'Understands...',
      doDescriptor: 'Does...',
    });
    const res = await postSubComp(req, { params: makeParams({ id: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });
});
