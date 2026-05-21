import { describe, it, expect } from 'vitest';

import { POST } from '@/app/api/admin/resync-courses/route';

describe('POST /api/admin/resync-courses', () => {
  it('returns 410 — route retired', async () => {
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'anything' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(410);
  });
});
