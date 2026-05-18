import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/flag/route';

vi.mock('@/lib/db/queries', () => ({
  insertFlag: vi.fn().mockResolvedValue({ id: 'flag-id' }),
}));

import * as queries from '@/lib/db/queries';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/flag', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/flag', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a valid flag', async () => {
    const req = makeRequest({
      runId: '11111111-2222-3333-8444-555555555555',
      flagType: 'coverage',
      target: 'upstream.brand-positioning',
      note: 'The AI thinks this course addresses positioning but the only project is a logo.',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('flag-id');
    expect(queries.insertFlag).toHaveBeenCalledWith({
      runId: '11111111-2222-3333-8444-555555555555',
      flagType: 'coverage',
      target: 'upstream.brand-positioning',
      note: expect.stringContaining('logo'),
    });
  });

  it('rejects empty note with 400', async () => {
    const req = makeRequest({ runId: '11111111-2222-3333-8444-555555555555', flagType: 'coverage', target: 'x', note: '' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects unknown flagType with 400', async () => {
    const req = makeRequest({ runId: '11111111-2222-3333-8444-555555555555', flagType: 'unknown', target: 'x', note: 'real note here' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
