/**
 * The set judge (spec 2026-11-17-course-cluster-map-design.md, "Matching rule"): when no single skill fully supplies a
 * target, a free campus model is asked whether a small set of skills together supplies it and whether any course has
 * students use them together. This file holds the shared shape, the cut-offs and the call itself.
 */
import { CUTOFFS, MODEL_IN_USE, judgePairs, pYes } from '@/lib/ai/match-judge';

/** Bump when the set-test prompt text changes so old cached verdicts are not reused. */
export const SET_PROMPT_VERSION = 's1';

/**
 * P(yes) at or above these passes each set question: `any` = the shortlist together supplies it at all, `together` =
 * the kept set together develops it, `combining` = some course has students use them together. PROVISIONAL: picked by
 * hand from the 2026-11-16 composite experiment; refit on the owner's 22 set labels before they are trusted.
 */
export const SET_CUTOFFS = { any: 0.3, together: 0.6, combining: 0.5 } as const;

/** One set-test answer for a target. `kept`: the supplied skill refs in the smallest set (pair judge at least partly). */
export interface SetVerdict { pAny: number | null; kept: string[]; pTogether: number | null; pCombining: number | null }

// ---------------------------------------------------------------------------------------------------------------------
// The call itself: the "v3" procedure from the 2026-11-16 composite experiment (prompt texts copied verbatim).
// ---------------------------------------------------------------------------------------------------------------------

export interface SetTarget { text: string; course: string; title?: string; context: string }
export interface SetPoolItem { ref: string; course: string; title?: string; text: string; context: string }
export type SetJudgment = SetVerdict & { picked: string[] };
type SetOpts = { fetchImpl?: typeof fetch; retryDelayMs?: number };

type Req = { prompt: string; maxTokens: number; logprobs: boolean };

/** One request with the match judge's retry pattern; throws the last error after the retries (a failed call is never stored). */
async function request(r: Req, fetchImpl: typeof fetch, retryDelayMs: number): Promise<Record<string, any>> {
  const base = (process.env.CAMPUS_LLM_BASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.CAMPUS_LLM_API_KEY ?? '';
  const body = JSON.stringify({
    model: MODEL_IN_USE, max_tokens: r.maxTokens, temperature: 0, ...(r.logprobs ? { logprobs: true, top_logprobs: 20 } : {}),
    messages: [{ role: 'user', content: r.prompt }],
    chat_template_kwargs: { enable_thinking: false },
  });
  let last = 'no answer';
  for (let attempt = 0; attempt <= 4; attempt++) {
    try {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST', body, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      if (attempt < 4) await new Promise((r2) => setTimeout(r2, retryDelayMs * 2 ** attempt));
    }
  }
  throw new Error(`The campus model did not answer (${last}).`);
}

async function yesNo(prompt: string, fetchImpl: typeof fetch, delay: number): Promise<number> {
  const json = await request({ prompt, maxTokens: 1, logprobs: true }, fetchImpl, delay);
  const top = json.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs;
  const p = Array.isArray(top) ? pYes(top) : null;
  if (p === null) throw new Error('The campus model gave no yes or no answer.');
  return p;
}

/** Strips the course code and the catalog excerpt from a context string, leaving the title the pair judge's prompt expects. */
const titleOf = (course: string, context: string) => {
  const rest = context.startsWith(course) ? context.slice(course.length) : context;
  const cut = rest.indexOf(' (catalog:');
  return (cut >= 0 ? rest.slice(0, cut) : rest).trim();
};

/**
 * Does a small set of earlier skills together supply the target, and does a course have students combine them?
 * Group "any" question over the pool; the smallest set the model names; picks the pair judge scores below the
 * "partly" cut-off are dropped; then the together and combining questions about the kept set only.
 * `picked` and `kept` are the pool items' refs. Throws if any model call fails: nothing partial is returned.
 */
export async function judgeSet(target: SetTarget, pool: SetPoolItem[], opts: SetOpts = {}): Promise<SetJudgment> {
  if (!process.env.CAMPUS_LLM_BASE_URL || !process.env.CAMPUS_LLM_API_KEY) {
    throw new Error('The campus model is not configured (CAMPUS_LLM_BASE_URL and CAMPUS_LLM_API_KEY must be set).');
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delay = opts.retryDelayMs ?? 1000;
  const list = pool.map((m, k) => `${k + 1}. ${m.context}\n   develops: "${m.text}"`).join('\n');
  const head = `Later course: ${target.context}\nStudents must arrive able to: "${target.text}"\n\nSkills developed in earlier courses:\n${list}\n\n`;

  // Step 1: the group question over the shortlist.
  const pAny = await yesNo(head + 'Taken together, do some or all of these earlier skills develop what the later course requires on arrival? Judge the activity only, not the level. Answer Yes or No.', fetchImpl, delay);

  // Step 2: the smallest set, then keep only picks the single-pair judge scores at least "partly".
  const gen = await request({
    prompt: head + 'What is the smallest set of the numbered skills that together supply the requirement? Leave out any skill that adds nothing the others already cover, and any that is only loosely related. Answer with the numbers only, comma-separated. If none supply it, answer 0.',
    maxTokens: 24, logprobs: false,
  }, fetchImpl, delay);
  const which = gen.choices?.[0]?.message?.content;
  if (typeof which !== 'string') throw new Error('The campus model gave no answer.');
  const picked = [...new Set(which.split(/[^0-9]+/).map(Number).filter((n) => n >= 1 && n <= pool.length))];

  let kept: number[] = [];
  if (picked.length) {
    const errorSink = { message: null as string | null };
    const pair = await judgePairs(picked.map((n) => {
      const m = pool[n - 1]!;
      return { requiredText: target.text, requiredCourse: target.course, requiredTitle: target.title ?? titleOf(target.course, target.context),
        suppliedText: m.text, suppliedCourse: m.course, suppliedTitle: m.title ?? titleOf(m.course, m.context) };
    }), { fetchImpl, retryDelayMs: delay, errorSink });
    const cut = CUTOFFS[MODEL_IN_USE].partly;
    if (pair.some((p) => p.pPartly === null)) throw new Error(`The campus model did not answer (${errorSink.message ?? 'no answer'}).`);
    kept = picked.filter((_, i) => pair[i]!.pPartly! >= cut);
  }

  // Step 3: ask about the chosen set only.
  let pTogether: number | null = null, pCombining: number | null = null;
  if (kept.length) {
    const setList = kept.map((n, k) => `${k + 1}. ${pool[n - 1]!.context}\n   develops: "${pool[n - 1]!.text}"`).join('\n');
    const setHead = `Later course: ${target.context}\nStudents must arrive able to: "${target.text}"\n\nEarlier courses and what they develop:\n${setList}\n\n`;
    pTogether = await yesNo(setHead + 'Taken together, do these earlier courses develop the activity the later course requires on arrival? Judge the activity only, not the level. Answer Yes or No.', fetchImpl, delay);
    pCombining = await yesNo(setHead + 'Does at least one of these earlier courses have students use these skills together, in the way the requirement asks, rather than each on its own? Answer Yes or No.', fetchImpl, delay);
  }
  return { pAny, picked: picked.map((n) => pool[n - 1]!.ref), kept: kept.map((n) => pool[n - 1]!.ref), pTogether, pCombining };
}
