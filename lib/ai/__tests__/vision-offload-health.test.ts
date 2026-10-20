import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Fresh module per test — the canary holds state in a module singleton, so we
 * reset the registry and re-import to isolate each case.
 */
async function freshModule() {
  // The canary state lives on globalThis (so instrumentation + route handlers share
  // it in Next) — resetModules alone won't clear it, so drop the global registry too.
  delete (globalThis as unknown as { __gcVisionOffloadHealth?: unknown }).__gcVisionOffloadHealth;
  vi.resetModules();
  return import('@/lib/ai/vision-offload-health');
}

function modelsResponse(ids: string[]) {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
}

describe('vision-offload canary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports disabled when VISION_OFFLOAD_* is unset', async () => {
    vi.stubEnv('VISION_OFFLOAD_BASE_URL', '');
    vi.stubEnv('VISION_OFFLOAD_MODEL', '');
    const m = await freshModule();
    await m.probeVisionOffload();
    expect(m.getOffloadHealthSnapshot().status).toBe('disabled');
  });

  it('reports ok when the endpoint serves the configured model', async () => {
    vi.stubEnv('VISION_OFFLOAD_BASE_URL', 'http://127.0.0.1:38001/v1');
    vi.stubEnv('VISION_OFFLOAD_MODEL', 'nvidia/Gemma-4-26B-A4B-NVFP4');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelsResponse(['nvidia/Gemma-4-26B-A4B-NVFP4'])));
    const m = await freshModule();
    await m.probeVisionOffload();
    const s = m.getOffloadHealthSnapshot();
    expect(s.status).toBe('ok');
    expect(s.servedModels).toEqual(['nvidia/Gemma-4-26B-A4B-NVFP4']);
    expect(s.lastOkAt).not.toBeNull();
    expect(s.downForSeconds).toBeNull();
  });

  it('reports down when reachable but the configured model is not served', async () => {
    vi.stubEnv('VISION_OFFLOAD_BASE_URL', 'http://127.0.0.1:38001/v1');
    vi.stubEnv('VISION_OFFLOAD_MODEL', 'nvidia/Gemma-4-26B-A4B-NVFP4');
    // e.g. the DGX came back up serving only the text-only 12B
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelsResponse(['AxionML/Gemma-4-12B-NVFP4'])));
    const m = await freshModule();
    await m.probeVisionOffload();
    const s = m.getOffloadHealthSnapshot();
    expect(s.status).toBe('down');
    expect(s.lastError).toMatch(/not served/);
  });

  it('reports down (with since) when the endpoint is unreachable', async () => {
    vi.stubEnv('VISION_OFFLOAD_BASE_URL', 'http://127.0.0.1:38001/v1');
    vi.stubEnv('VISION_OFFLOAD_MODEL', 'nvidia/Gemma-4-26B-A4B-NVFP4');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    const m = await freshModule();
    await m.probeVisionOffload();
    const s = m.getOffloadHealthSnapshot();
    expect(s.status).toBe('down');
    expect(s.since).not.toBeNull();
    expect(s.downForSeconds).toBeGreaterThanOrEqual(0);
  });

  describe('RCD lifecycle (?full=true)', () => {
    const MODEL = 'qwen3.6-35b-a3b-fp8';
    /** Plain /models lists the model; /models?full=true carries `lifecycle` (or `lifecycles[i]` per call). */
    function rcdFetch(lifecycles: Array<string | undefined | Error>) {
      let fullCalls = 0;
      return vi.fn(async (url: string) => {
        if (!String(url).includes('full=true')) return modelsResponse([MODEL]);
        const lc = lifecycles[Math.min(fullCalls++, lifecycles.length - 1)];
        if (lc instanceof Error) throw lc;
        return new Response(JSON.stringify({ data: [{ id: MODEL, ...(lc ? { lifecycle: lc } : {}) }] }), { status: 200 });
      });
    }
    beforeEach(() => {
      vi.stubEnv('VISION_OFFLOAD_BASE_URL', 'https://llm.rcd.clemson.edu/v1');
      vi.stubEnv('VISION_OFFLOAD_MODEL', MODEL);
    });

    it('records the model lifecycle from the full listing', async () => {
      vi.stubGlobal('fetch', rcdFetch(['experimental']));
      const m = await freshModule();
      await m.probeVisionOffload();
      expect(m.getOffloadHealthSnapshot().lifecycle).toBe('experimental');
    });

    it('warns when the lifecycle changes between probes', async () => {
      vi.stubGlobal('fetch', rcdFetch(['experimental', 'deprecated']));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = await freshModule();
      await m.probeVisionOffload();
      expect(warn).not.toHaveBeenCalled();
      await m.probeVisionOffload();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/lifecycle.*experimental.*deprecated/i));
      expect(m.getOffloadHealthSnapshot().lifecycle).toBe('deprecated');
    });

    it('warns on first sight of a lifecycle other than active/experimental', async () => {
      vi.stubGlobal('fetch', rcdFetch(['deprecated']));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = await freshModule();
      await m.probeVisionOffload();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/lifecycle.*deprecated/i));
    });

    it('does not warn again while the lifecycle is unchanged', async () => {
      vi.stubGlobal('fetch', rcdFetch(['deprecated']));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = await freshModule();
      await m.probeVisionOffload();
      await m.probeVisionOffload();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('leaves lifecycle null and stays quiet when the gateway sends none (Spark)', async () => {
      vi.stubGlobal('fetch', rcdFetch([undefined]));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = await freshModule();
      await m.probeVisionOffload();
      const s = m.getOffloadHealthSnapshot();
      expect(s.status).toBe('ok');
      expect(s.lifecycle).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('a failing full listing does not change an ok status', async () => {
      vi.stubGlobal('fetch', rcdFetch([new Error('fetch failed')]));
      const m = await freshModule();
      await m.probeVisionOffload();
      expect(m.getOffloadHealthSnapshot().status).toBe('ok');
    });
  });

  it('recordRealFallback bumps the informational counter without needing a probe', async () => {
    vi.stubEnv('VISION_OFFLOAD_BASE_URL', 'http://127.0.0.1:38001/v1');
    vi.stubEnv('VISION_OFFLOAD_MODEL', 'nvidia/Gemma-4-26B-A4B-NVFP4');
    // fetch (the debounced confirm-probe) resolves ok — status stays ok, but the
    // real-fallback counter still records the production event.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelsResponse(['nvidia/Gemma-4-26B-A4B-NVFP4'])));
    const m = await freshModule();
    m.recordRealFallback('OCR 3/12 pages: EHOSTUNREACH');
    const s = m.getOffloadHealthSnapshot();
    expect(s.realFallbacks.count).toBe(1);
    expect(s.realFallbacks.lastReason).toMatch(/EHOSTUNREACH/);
  });
});
