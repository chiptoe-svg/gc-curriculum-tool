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

interface EmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

function resolveConfig(opts: EmbedOptions = {}): { baseURL: string; apiKey: string; model: string } {
  const baseURL = (opts.baseURL ?? process.env.CAMPUS_LLM_BASE_URL?.trim());
  if (!baseURL) throw new Error('CAMPUS_LLM_BASE_URL not set');
  const apiKey = (opts.apiKey ?? process.env.CAMPUS_LLM_API_KEY?.trim());
  if (!apiKey) throw new Error('CAMPUS_LLM_API_KEY not set');
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  return { baseURL, apiKey, model };
}

/** Embed one or more strings. Returns one vector per input, in order. */
export async function embedBatch(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { baseURL, apiKey, model } = resolveConfig(opts);

  const res = await fetch(`${baseURL.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: texts }),
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
