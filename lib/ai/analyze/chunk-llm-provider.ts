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
): Promise<{ data: T; model: string } & CompletionTelemetry> {
  const campus = campusOss();
  if (campus) {
    try {
      const r = await campus.complete<T>(args);
      return { ...r, model: campus.model };
    } catch (e) {
      console.warn(`[chunk-llm] campus ${campus.model} failed → OpenAI fallback:`, e instanceof Error ? e.message : e);
    }
  }
  const provider = await getProviderForFunction(funcId);
  const r = await provider.complete<T>(args);
  return { ...r, model: provider.model };
}
