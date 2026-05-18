import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('returns ok with provider name', async () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.aiProvider).toBe('openai');
  });
});
