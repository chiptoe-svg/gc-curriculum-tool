/**
 * RCD Qwen3-Reranker client (interim, owner 2026-11-19: "a reranker would be a no brainer").
 *
 * Matches rag-core exactly (~/projects/rag-core/src/rag_core/index/rerank.py, confirmed by the
 * rag-core session 2026-11-19) so the GC 3400 comparison before the switch to rag-core is like for
 * like: POST {CAMPUS_LLM_BASE_URL}/rerank, model qwen3-rerank-4b (served as
 * tomaarsen/Qwen3-Reranker-4B-seq-cls), Jina/Cohere body. The server does NOT apply the Qwen3
 * template, so the query and each document are sent templated; untemplated scores bunch together
 * (off-topic ~0.73 vs on-topic ~0.93), templated they separate (0.999 vs < 0.01).
 *
 * Measured by rag-core on curriculum's corpus (v2 gold set, 17 questions, 2026-10-06): hit@1 41% -> 59%,
 * MRR 0.58 -> 0.68, about +80 ms per query. Probe 2026-11-19 from this Mac: 76 ms for 2 passages.
 *
 * Queries and passages are content: never logged, never in error messages.
 */

export const DEFAULT_RERANK_MODEL = 'qwen3-rerank-4b';
const INSTRUCTION = 'Given a web search query, retrieve relevant passages that answer the query';
const PREFIX =
  '<|im_start|>system\nJudge whether the Document meets the requirements based on the '
  + 'Query and the Instruct provided. Note that the answer can only be "yes" or "no".'
  + '<|im_end|>\n<|im_start|>user\n';
const SUFFIX = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n';
const CONTROL = /<\|im_(?:start|end)\|>|<\/?think>/g;

/** Strip chat control tokens from untrusted text so a passage can't close its own turn; loops until stable. */
function neutralise(text: string): string {
  for (;;) {
    const out = text.replace(CONTROL, m => m.replace(/[<>/|]/g, ''));
    if (out === text) return out;
    text = out;
  }
}

export function formatQuery(query: string): string {
  return `${PREFIX}<Instruct>: ${INSTRUCTION}\n<Query>: ${neutralise(query)}\n`;
}

export function formatDocument(text: string): string {
  return `<Document>: ${neutralise(text)}${SUFFIX}`;
}

/** On unless RERANK=off (an operator switch to compare or to bypass a reranker outage). */
export function rerankEnabled(): boolean {
  return process.env.RERANK?.trim().toLowerCase() !== 'off';
}

export interface RerankOptions {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/** Score every passage against the query; returns {index, score} for all of them, best first. Throws on any malformed reply. */
export async function rerank(query: string, passages: string[], opts: RerankOptions = {}): Promise<Array<{ index: number; score: number }>> {
  if (!passages.length) return [];
  const baseURL = opts.baseURL ?? process.env.CAMPUS_LLM_BASE_URL?.trim();
  const apiKey = opts.apiKey ?? process.env.CAMPUS_LLM_API_KEY?.trim();
  if (!baseURL || !apiKey) throw new Error('rerank: CAMPUS_LLM_BASE_URL / CAMPUS_LLM_API_KEY not set');
  const res = await fetch(`${baseURL.replace(/\/$/, '')}/rerank`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model ?? process.env.RERANK_MODEL?.trim() ?? DEFAULT_RERANK_MODEL,
      query: formatQuery(query),
      documents: passages.map(formatDocument),
      top_n: passages.length,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  if (res.status !== 200) throw new Error(`rerank: endpoint returned ${res.status}`);
  const results = ((await res.json()) as { results?: Array<{ index: unknown; relevance_score: unknown }> }).results ?? [];
  if (results.length !== passages.length) throw new Error(`rerank: ${results.length} results for ${passages.length} passages`);
  const seen = new Set<number>();
  const out = results.map(r => {
    const index = r.index;
    const score = Number(r.relevance_score);
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= passages.length) throw new Error('rerank: index out of range');
    if (seen.has(index)) throw new Error('rerank: duplicate index');
    if (!Number.isFinite(score)) throw new Error('rerank: non-finite score');
    seen.add(index);
    return { index, score };
  });
  return out.sort((a, b) => b.score - a.score);
}
