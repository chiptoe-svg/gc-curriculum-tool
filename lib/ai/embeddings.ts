/**
 * Embeddings client for the campus-hosted qwen3-embedding-4b model.
 *
 * The endpoint is the same OpenAI-compatible base URL as the LLM
 * (CAMPUS_LLM_BASE_URL), so the same bearer token works. The model
 * produces 2560-dim vectors at /v1/embeddings.
 *
 * Stage 2 (Weaviate-backed retrieval) will route through this client.
 * The in-memory store below exists so the chunk → embed → search path
 * can be exercised end-to-end before Weaviate lands.
 */

export interface EmbedOptions {
  /** Override the default model. */
  model?: string;
  /** Override the default base URL (mostly for tests). */
  baseURL?: string;
  /** Override the default API key (mostly for tests). */
  apiKey?: string;
}

export const DEFAULT_EMBEDDING_MODEL = 'qwen3-embedding-4b';
export const EMBEDDING_DIM = 2560;

/**
 * Campus endpoint caps a request at 32,000 tokens summed across all inputs.
 * We use a conservative character budget (36,000 chars ≈ 24k tokens at ~1.5
 * chars/tok) so even dense technical content (closer to 2 chars/tok) stays
 * well under the cap.  Truncation per input is last-resort: it only fires
 * when a single chunk exceeds the cap and must not block the whole batch.
 */
export const MAX_CHARS_PER_REQUEST = 36_000;
export const MAX_CHARS_PER_INPUT   = 36_000;

/**
 * Pack texts into sub-batches so each batch's summed character count ≤
 * MAX_CHARS_PER_REQUEST.  Any single input longer than MAX_CHARS_PER_INPUT is
 * truncated first (last-resort: prevents one giant chunk from hard-400ing the
 * whole batch).  Order is preserved; flattening the result array gives the
 * same sequence as the input.
 */
export function packEmbeddingBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const raw of texts) {
    // Truncate individual inputs that exceed the per-input cap.
    const text = raw.length > MAX_CHARS_PER_INPUT ? raw.slice(0, MAX_CHARS_PER_INPUT) : raw;
    const len = text.length;

    if (current.length > 0 && currentLen + len > MAX_CHARS_PER_REQUEST) {
      // Flush current batch before adding this input.
      batches.push(current);
      current = [];
      currentLen = 0;
    }

    current.push(text);
    currentLen += len;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

interface EmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

interface EmbedConfig { baseURL: string; apiKey: string; model: string }

function resolveConfig(opts: EmbedOptions = {}): EmbedConfig {
  const baseURL = (opts.baseURL ?? process.env.CAMPUS_LLM_BASE_URL?.trim());
  if (!baseURL) throw new Error('CAMPUS_LLM_BASE_URL not set');
  const apiKey = (opts.apiKey ?? process.env.CAMPUS_LLM_API_KEY?.trim());
  if (!apiKey) throw new Error('CAMPUS_LLM_API_KEY not set');
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  return { baseURL, apiKey, model };
}

/**
 * Optional FALLBACK endpoint for when the campus primary is unreachable/hung —
 * the DGX Spark router (`qwen3-embedding-4b`, vectors verified cosine-0.9997
 * identical to campus, so existing Weaviate vectors stay consistent). Campus
 * stays primary; this only fires on a primary failure. Null when unconfigured,
 * or when the caller pinned an explicit `baseURL` (tests) — don't second-guess.
 */
function resolveFallbackConfig(opts: EmbedOptions = {}): EmbedConfig | null {
  if (opts.baseURL) return null;
  const baseURL = process.env.EMBEDDINGS_FALLBACK_BASE_URL?.trim();
  if (!baseURL) return null;
  return {
    baseURL,
    apiKey: process.env.EMBEDDINGS_FALLBACK_API_KEY?.trim() || 'none',
    model: opts.model ?? process.env.EMBEDDINGS_FALLBACK_MODEL?.trim() ?? DEFAULT_EMBEDDING_MODEL,
  };
}

// Primary is failed-over on any error incl. timeout, so a HUNG campus doesn't
// block indefinitely; the fallback gets a generous window for a cold model load.
const PRIMARY_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.EMBEDDINGS_PRIMARY_TIMEOUT_MS ?? '60000', 10) || 60_000);
const FALLBACK_TIMEOUT_MS = Math.max(30_000, Number.parseInt(process.env.EMBEDDINGS_FALLBACK_TIMEOUT_MS ?? '200000', 10) || 200_000);

/**
 * Send exactly one batch of (already-packed, already-truncated) texts to the
 * endpoint.  Returns vectors in input order using the index-slot reconstruction
 * pattern (the API may return rows in any order).
 */
async function embedOneRequest(
  texts: string[],
  cfg: EmbedConfig,
  timeoutMs?: number,
): Promise<number[][]> {
  const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: cfg.model, input: texts }),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Embedding request failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  const payload = (await res.json()) as EmbeddingsResponse;
  const slots = new Array<number[] | undefined>(texts.length);
  for (const row of payload.data) {
    slots[row.index] = row.embedding;
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const vec = slots[i];
    if (!vec) throw new Error(`Embedding response missing index ${i}`);
    out.push(vec);
  }
  return out;
}

/**
 * Embed one or more strings.  Returns one vector per input, in order.
 *
 * Large or numerous inputs are automatically split into sub-batches so that
 * each request stays within the campus endpoint's 32k shared-token cap.
 * Batches are issued sequentially (not concurrently) to avoid hammering the
 * shared cluster.
 */
export async function embedBatch(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const primary = resolveConfig(opts);
  const fallback = resolveFallbackConfig(opts);

  const batches = packEmbeddingBatches(texts);
  const results: number[][] = [];
  let announcedFallback = false;
  for (const batch of batches) {
    let vecs: number[][];
    try {
      vecs = await embedOneRequest(batch, primary, PRIMARY_TIMEOUT_MS);
    } catch (e) {
      if (!fallback) throw e; // no fallback configured → fail loudly as before
      if (!announcedFallback) {
        console.warn(`[embeddings] campus primary failed → DGX fallback: ${e instanceof Error ? e.message : e}`);
        announcedFallback = true;
      }
      vecs = await embedOneRequest(batch, fallback, FALLBACK_TIMEOUT_MS);
    }
    for (const v of vecs) results.push(v);
  }
  return results;
}

/** Embed a single string. Returns a single vector. */
export async function embedText(text: string, opts: EmbedOptions = {}): Promise<number[]> {
  const vectors = await embedBatch([text], opts);
  const vec = vectors[0];
  if (!vec) throw new Error('Embedding response was empty');
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Minimal in-memory vector store. Stage 2 will replace this with Weaviate;
 * the spike uses it to prove the chunk → embed → search path without the
 * external dependency.
 */
export class InMemoryVectorStore<TMeta = Record<string, unknown>> {
  private items: Array<{ id: string; vector: number[]; meta: TMeta }> = [];

  upsert(id: string, vector: number[], meta: TMeta): void {
    const existing = this.items.findIndex(it => it.id === id);
    const entry = { id, vector, meta };
    if (existing >= 0) this.items[existing] = entry;
    else this.items.push(entry);
  }

  size(): number {
    return this.items.length;
  }

  search(query: number[], k: number = 5): Array<{ id: string; score: number; meta: TMeta }> {
    return this.items
      .map(it => ({ id: it.id, score: cosineSimilarity(query, it.vector), meta: it.meta }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
