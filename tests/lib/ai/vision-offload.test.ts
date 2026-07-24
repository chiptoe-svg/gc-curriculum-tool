import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldOffload, resolveOffloadConcurrency, __resetConcurrencyCache, type VisionOffload } from '@/lib/ai/vision-offload';

const off: VisionOffload = { baseURL: 'http://spark/v1', model: 'qwen3.6-35b-a3b', apiKey: 'k', concurrency: 12, minItems: 4 };

describe('shouldOffload', () => {
  it('honors the size tier by default (below minItems stays local)', () => {
    expect(shouldOffload(off, 1)).toBe(false);
    expect(shouldOffload(off, 4)).toBe(true);
  });
  it('force=true offloads even a single page (bypasses the size tier)', () => {
    expect(shouldOffload(off, 1, true)).toBe(true);
  });
  it('force=true still returns false when there is no offload config', () => {
    expect(shouldOffload(null, 1, true)).toBe(false);
  });
});

describe('resolveOffloadConcurrency', () => {
  afterEach(() => { __resetConcurrencyCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function stubModels(rc: number | undefined, ok = true) {
    const data = [{ id: off.model, ...(rc === undefined ? {} : { recommended_concurrency: rc }) }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }), { status: ok ? 200 : 500 })));
  }

  it('uses the gateway recommended_concurrency when below the env ceiling', async () => {
    stubModels(7);
    expect(await resolveOffloadConcurrency(off, 1000)).toBe(7); // min(7, env 12)
  });

  it('caps at the env ceiling when the gateway recommends more', async () => {
    stubModels(20);
    expect(await resolveOffloadConcurrency(off, 1000)).toBe(12); // min(20, env 12)
  });

  it('falls back to env when the field is absent', async () => {
    stubModels(undefined);
    expect(await resolveOffloadConcurrency(off, 1000)).toBe(12);
  });

  it('falls back to env on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('unreachable'); }));
    expect(await resolveOffloadConcurrency(off, 1000)).toBe(12);
  });

  it('caches within the TTL (one fetch for repeat calls)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: off.model, recommended_concurrency: 7 }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await resolveOffloadConcurrency(off, 1000);
    await resolveOffloadConcurrency(off, 1000 + 60_000); // within 5-min TTL
    expect(f).toHaveBeenCalledTimes(1);
  });
});
