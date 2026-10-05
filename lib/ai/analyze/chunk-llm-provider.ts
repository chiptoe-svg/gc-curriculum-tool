import { CampusProvider } from '@/lib/ai/campus';
import { getProviderForFunction, type AIProvider, type CompletionTelemetry } from '@/lib/ai/provider';
import type { AIFunctionId } from '@/lib/ai/function-settings';

type CompleteArgs<T> = Parameters<AIProvider['complete']>[0] & { validate: (raw: unknown) => T };

/** Campus gpt-oss-120b provider, or null when campus isn't configured / is
 *  force-disabled (CHUNK_LLM_SKIP_CAMPUS=1). reasoning_effort:low keeps the
 *  reasoning out of `content` so the strict {blurb}/{digest} JSON parses. */
function campusOss(): CampusProvider | null {
  const baseURL = process.env.CAMPUS_LLM_BASE_URL?.trim();
  const apiKey = process.env.CAMPUS_LLM_API_KEY?.trim();
  if (!baseURL || !apiKey || process.env.CHUNK_LLM_SKIP_CAMPUS === '1') return null;
  const model = process.env.CHUNK_LLM_CAMPUS_MODEL?.trim() || 'gptoss-120b';
  return new CampusProvider(model, baseURL, apiKey, { reasoningEffort: 'low' });
}

/**
 * Completion for the high-volume per-chunk LLM functions (chunk-contextualize +
 * material-digest): **campus gpt-oss-120b first**, falling back to the function's
 * configured provider (OpenAI gpt-5.4-mini) on ANY campus error — unreachable
 * endpoint, non-JSON, or a `validate` rejection. Chosen 2026-06-17 after a
 * bake-off: campus oss-120b was ~3-4× faster, $0, 0 JSON failures, and the
 * gpt-5.5 judge preferred it 8/10 on real GC chunks. Set CHUNK_LLM_SKIP_CAMPUS=1
 * to force the OpenAI path; CHUNK_LLM_CAMPUS_MODEL to override the campus model.
 *
 * Returns the actually-used model so callers record the right provenance.
 */
export async function chunkLlmComplete<T>(
  funcId: AIFunctionId,
  args: CompleteArgs<T>,
  opts?: { noOpenAIFallback?: boolean },
): Promise<{ data: T; model: string } & CompletionTelemetry> {
  // Campus and the OpenAI fallback share one gateway (llm.rcd.clemson.edu), so
  // a gateway blip fails both together (seen 2026-10-05: 502 on both within a
  // minute; the retry a minute later succeeded). On a gateway-type failure, wait
  // and run the whole sequence once more instead of failing the material.
  try {
    return await chunkLlmAttempt(funcId, args, opts);
  } catch (e) {
    if (!isGatewayOutage(e)) throw e;
    const delayMs = Number(process.env.CHUNK_LLM_RETRY_DELAY_MS ?? 60_000);
    console.warn(`[chunk-llm] gateway error on both routes (${e instanceof Error ? e.message : e}); retrying in ${delayMs / 1000}s`);
    await new Promise(r => setTimeout(r, delayMs));
    return chunkLlmAttempt(funcId, args, opts);
  }
}

/** 5xx, connection failure or timeout: the gateway, not the request, is at fault. */
function isGatewayOutage(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 500) return true;
  const name = (e as { name?: unknown })?.name;
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true;
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|timed out|Bad Gateway|Gateway Time-?out/i.test(e instanceof Error ? e.message : String(e));
}

async function chunkLlmAttempt<T>(
  funcId: AIFunctionId,
  args: CompleteArgs<T>,
  opts?: { noOpenAIFallback?: boolean },
): Promise<{ data: T; model: string } & CompletionTelemetry> {
  const campus = campusOss();
  if (campus) {
    try {
      const r = await campus.complete<T>(args);
      return { ...r, model: campus.model };
    } catch (e) {
      if (opts?.noOpenAIFallback) throw e; // local-only mode: surface as a failed material, no paid fallback
      console.warn(`[chunk-llm] campus ${campus.model} failed → OpenAI fallback:`, e instanceof Error ? e.message : e);
    }
  } else if (opts?.noOpenAIFallback) {
    // Local-only mode with campus unconfigured/disabled has no free path — fail loudly.
    throw new Error('chunkLlmComplete: local-only mode but campus provider is unavailable');
  }
  const provider = await getProviderForFunction(funcId);
  const r = await provider.complete<T>(args);
  return { ...r, model: provider.model };
}
