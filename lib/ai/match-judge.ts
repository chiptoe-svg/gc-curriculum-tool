/**
 * The skill-match judge: a free campus model says whether a skill developed in an earlier course supplies a skill
 * a later course requires. Two yes/no questions per pair ("fully", "partly"), each one token; P(yes) is read from
 * the returned logprobs. Judgments are cached by text hash + model + PROMPT_VERSION (lib/db/match-queries.ts).
 */

export const MODELS = ['qwen3.8-27b-fp8', 'deepseek-v4.1-flash-1017'] as const;
export type Model = (typeof MODELS)[number];
/** The model whose judgments the map reads; the other is stored for comparison once owner labels exist. */
export const MODEL_IN_USE: Model = MODELS[0];
/** Bump when the prompt text changes so old cached judgments are not reused. */
export const PROMPT_VERSION = 'm1';

/** PROVISIONAL (spike 2026-11-16, before owner labels): P(yes) at or above these counts as fully / partly. */
export const CUTOFFS: Record<Model, { fully: number; partly: number }> = {
  'qwen3.8-27b-fp8': { fully: 0.6, partly: 0.9 },
  'deepseek-v4.1-flash-1017': { fully: 0.75, partly: 0.95 },
};

export type PairText = {
  requiredText: string; requiredCourse: string; requiredTitle: string;
  suppliedText: string; suppliedCourse: string; suppliedTitle: string;
};

const QUESTIONS = {
  fully: 'Does the earlier course develop the activity that the later course requires on arrival? Judge the activity only, not the level or the wording of conditions. Answer Yes or No.',
  partly: 'Does the earlier course develop at least part of the activity that the later course requires on arrival (a component of it, or a closely related narrower activity)? Answer Yes or No.',
} as const;

export function judgePrompt(q: 'fully' | 'partly', p: PairText): string {
  return `Earlier course: ${p.suppliedCourse} ${p.suppliedTitle}. It develops: "${p.suppliedText}"\nLater course: ${p.requiredCourse} ${p.requiredTitle}. Students must arrive able to: "${p.requiredText}"\n\n${QUESTIONS[q]}`;
}

/** Yes mass over Yes+No mass among the top tokens (trimmed, lowercased); null when neither appears. */
export function pYes(topLogprobs: Array<{ token: string; logprob: number }>): number | null {
  let y = 0, n = 0;
  for (const t of topLogprobs) {
    const w = t.token.trim().toLowerCase();
    if (w === 'yes') y += Math.exp(t.logprob);
    else if (w === 'no') n += Math.exp(t.logprob);
  }
  return y + n > 0 ? y / (y + n) : null;
}

type Opts = { model?: Model; fetchImpl?: typeof fetch; concurrency?: number; retryDelayMs?: number };

async function ask(prompt: string, model: Model, fetchImpl: typeof fetch, retryDelayMs: number): Promise<number | null> {
  const base = (process.env.CAMPUS_LLM_BASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.CAMPUS_LLM_API_KEY ?? '';
  const body = JSON.stringify({
    model, max_tokens: 1, temperature: 0, logprobs: true, top_logprobs: 20,
    messages: [{ role: 'user', content: prompt }],
    chat_template_kwargs: { enable_thinking: false },
  });
  for (let attempt = 0; attempt <= 4; attempt++) {
    try {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST', body, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ch = (await res.json()).choices?.[0];
      const top = ch?.logprobs?.content?.[0]?.top_logprobs;
      return Array.isArray(top) ? pYes(top) : null;
    } catch {
      if (attempt < 4) await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** attempt));
    }
  }
  return null;
}

/** Judges each pair with one model; a question that fails after retries gives null. Order matches the input. */
export async function judgePairs(pairs: PairText[], opts: Opts = {}): Promise<Array<{ pFully: number | null; pPartly: number | null }>> {
  const model = opts.model ?? MODEL_IN_USE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delay = opts.retryDelayMs ?? 1000;
  const out: Array<{ pFully: number | null; pPartly: number | null }> = new Array(pairs.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < pairs.length; i = next++) {
      const p = pairs[i]!;
      out[i] = {
        pFully: await ask(judgePrompt('fully', p), model, fetchImpl, delay),
        pPartly: await ask(judgePrompt('partly', p), model, fetchImpl, delay),
      };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return out;
}
