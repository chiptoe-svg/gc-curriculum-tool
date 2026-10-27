/**
 * Model registry: the one place that names OpenAI models.
 *
 * - TIER_TO_MODEL: which model each tier (light / default / heavy) runs.
 *   Per-function tiers and custom models live in `ai_function_settings`
 *   (lib/ai/function-settings.ts, edited on /settings).
 * - MODEL_PRICING: per-model prices for the daily-cost ledger.
 * - DEFAULT_REASONING_EFFORT: effort a model runs at when the caller sets none.
 * - usesResponsesApi: which models take tool calls through the Responses API.
 *
 * To try a new model: add its price here, then point a tier (or one
 * function's settings row) at it. A guard test
 * (lib/ai/__tests__/model-registry.test.ts) fails if a model id is written
 * anywhere else in lib/ or app/.
 */

export type Tier = 'light' | 'default' | 'heavy';

export const TIER_TO_MODEL: Record<Tier, string> = {
  light: 'gpt-5.4-mini',
  // Owner decision 2026-10-06: default and heavy move to gpt-6.1-sol (low
  // reasoning effort, below). See
  // docs/superpowers/audits/2026-10-05-model-evaluation.md.
  default: 'gpt-6.1-sol',
  heavy: 'gpt-6.1-sol',
};

// Per-model pricing in USD per 1M tokens. Update from
// https://developers.openai.com/api/docs/pricing when adding models.
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // GPT-6 / 5.6 families, published standard rates as of 2026-10-05 (gateway
  // markup, if any, unverified). Without these, unpriced models fell back to
  // gpt-5.4 rates and the daily-cost ledger under-counted (Astra ~4×).
  'gpt-6-astra': { input: 10.0, output: 50.0 },
  'gpt-6.1-sol': { input: 2.0, output: 10.0 },
  // Released 2026-10-26; standard rate as reported by third-party trackers
  // quoting OpenAI's launch post (2026-10-27).
  'gpt-6.1-terra': { input: 1.0, output: 5.0 },
  'gpt-6-sol': { input: 2.0, output: 10.0 },
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'gpt-5.6-sol': { input: 4.0, output: 20.0 },
  'gpt-5.6-terra': { input: 2.0, output: 12.0 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.5': { input: 5.0, output: 30.0 },
  'gpt-5.4': { input: 2.5, output: 15.0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  // Legacy fallbacks if these names still resolve on the API:
  'gpt-4.1': { input: 2.5, output: 10.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
};

export const FALLBACK_PRICING = { input: 2.5, output: 15.0 };  // assume workhorse

/**
 * Reasoning effort a model runs at when the caller sets none. Owner decision
 * 2026-10-06: gpt-6.1-sol runs at low (the 2026-10-05 evaluation and blind
 * evidence check: as consistent as medium/high, closest to the evidence,
 * cheapest). Models not listed get no reasoning_effort, so their requests
 * are unchanged.
 */
export const DEFAULT_REASONING_EFFORT: Record<string, string> = { 'gpt-6.1-sol': 'low' };

/** gpt-6* models 400 on Chat Completions when function tools are present, so
 * tool-using calls go through the stateless Responses API for them. */
export function usesResponsesApi(model: string): boolean {
  return /^gpt-6/.test(model);
}
