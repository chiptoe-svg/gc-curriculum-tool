/**
 * The one price list for every cost estimate (spec:
 * docs/superpowers/specs/2026-11-21-central-price-list-design.md).
 *
 * To change a price: ADD a new dated entry. Never edit or delete an old one;
 * lookups take a date and use the newest entry whose `from` is on or before it,
 * so old estimates stay reproducible. Nothing outside this file may hold a
 * price or a cached-rate factor (tests/lib/ai/prices.test.ts scans for it).
 *
 * Units: rates are USD per million tokens. `costUsdCents` returns 1/100-cent
 * units (what `daily_cost` stores): ceil per term, as the call sites did before.
 */
import { isCampusModel } from '@/lib/ai/models';

export interface PriceEntry {
  /** Date the price took effect, YYYY-MM-DD. */
  from: string;
  source: string;
  /** USD per million tokens. */
  input: number;
  cachedInput: number;
  output: number;
  /** Cache-write rate where a provider charges one (Anthropic). Absent = writes count as fresh input. */
  cacheWrite?: number;
}

export interface TokenCounts {
  freshInput: number;
  cachedInput: number;
  output: number;
  /** Charged at the entry's cacheWrite rate when it has one; otherwise at the fresh-input rate. Counted separately from freshInput. */
  cacheWrite?: number;
}

export interface CreditRate {
  from: string;
  source: string;
  /** RCD gateway credits per million tokens. */
  input: number;
  cachedInput: number;
  output: number;
}

// Before 2026-11-21 the code applied cached input = 10% of input for OpenAI
// and Anthropic (anthropic.ts also charged cache writes at 125% of input).
// Entries from those eras keep that factor so historical lookups reproduce what
// the code computed then.
const tenth = (input: number) => input * 0.1;
const old = (from: string, source: string, input: number, output: number): PriceEntry =>
  ({ from, source, input, cachedInput: tenth(input), output });

const CLEMSON = 'Clemson OpenAI token pricing reference, 2026-11-21 (API standard short-context rates)';
const clemson = (input: number, cachedInput: number, output: number): PriceEntry =>
  ({ from: '2026-11-21', source: CLEMSON, input, cachedInput, output });

/** Newest entry last within each model; the lookup does not rely on order. */
export const PRICES: Record<string, PriceEntry[]> = {
  // GPT-6 / 5.6 families: published standard rates 2026-10-05 (lib/ai/openai.ts @ 81a283f0).
  'gpt-6-astra': [old('2026-10-05', 'lib/ai/openai.ts @ 81a283f0 (OpenAI list)', 10.0, 50.0), clemson(10.0, 1.0, 50.0)],
  'gpt-6.1-sol': [old('2026-10-05', 'lib/ai/openai.ts @ 81a283f0 (OpenAI list)', 2.0, 10.0), clemson(2.0, 0.1, 10.0)],
  // Released 2026-10-26; rate as reported by third-party trackers quoting OpenAI's launch post.
  'gpt-6.1-terra': [old('2026-10-27', 'lib/ai/models.ts @ 5e05b069 (third-party trackers quoting the launch post)', 1.0, 5.0), clemson(1.0, 0.05, 5.0)],
  'gpt-6-sol': [old('2026-10-05', 'lib/ai/openai.ts @ 81a283f0 (OpenAI list)', 2.0, 10.0), clemson(2.0, 0.2, 10.0)],
  'gpt-6-luna': [old('2026-10-05', 'lib/ai/openai.ts @ 81a283f0 (OpenAI list)', 0.1, 0.5), clemson(0.1, 0.01, 0.5)],
  'gpt-5.6-sol': [old('2026-10-05', 'lib/ai/openai.ts @ 81a283f0 (OpenAI list)', 4.0, 20.0), clemson(4.0, 0.4, 20.0)],
  'gpt-5.6-terra': [old('2026-10-05', 'lib/ai/openai.ts @ 81a283f0 (OpenAI list)', 2.0, 12.0), clemson(2.0, 0.2, 12.0)],
  'gpt-5.6-luna': [old('2026-10-05', 'lib/ai/openai.ts @ 81a283f0 (OpenAI list)', 0.2, 1.2), clemson(0.2, 0.02, 1.2)],
  // In the Clemson reference but not used by the app yet.
  'gpt-6.2-astra': [clemson(8.0, 0.4, 40.0)],
  'gpt-6.2-sol': [clemson(2.0, 0.1, 10.0)],
  'gpt-5.2': [clemson(1.75, 0.175, 14.0)],
  // Earlier families: per-model map introduced 2026-05-18 (lib/ai/openai.ts @ 144b3a84); the 10% cached
  // factor arrived the same day (4e8619ee). Not in the Clemson reference, so unchanged since.
  'gpt-5.5': [old('2026-05-18', 'lib/ai/openai.ts @ 144b3a84', 5.0, 30.0)],
  'gpt-5.4': [old('2026-05-18', 'lib/ai/openai.ts @ 144b3a84', 2.5, 15.0)],
  'gpt-5.4-mini': [old('2026-05-18', 'lib/ai/openai.ts @ 144b3a84', 0.75, 4.5)],
  'gpt-5.4-nano': [old('2026-05-18', 'lib/ai/openai.ts @ 144b3a84', 0.2, 1.25)],
  'gpt-4.1': [old('2026-05-18', 'lib/ai/openai.ts @ 144b3a84 (legacy fallback)', 2.5, 10.0)],
  'gpt-4o': [old('2026-05-18', 'lib/ai/openai.ts @ 144b3a84 (legacy fallback)', 2.5, 10.0)],
  // Anthropic: lib/ai/anthropic.ts @ 9a6624c7 (2026-05-21): cached reads 10% of input, cache writes 125% of input.
  'claude-opus-4-7': [{ ...old('2026-05-21', 'lib/ai/anthropic.ts @ 9a6624c7', 15.0, 75.0), cacheWrite: 15.0 * 1.25 }],
  'claude-sonnet-4-6': [{ ...old('2026-05-21', 'lib/ai/anthropic.ts @ 9a6624c7', 3.0, 15.0), cacheWrite: 3.0 * 1.25 }],
  'claude-haiku-4-5-20251001': [{ ...old('2026-05-21', 'lib/ai/anthropic.ts @ 9a6624c7', 0.8, 4.0), cacheWrite: 0.8 * 1.25 }],
};

/**
 * Used for a model with no entry. A warning is logged once per model. (Anthropic's old table fell back to
 * $3 / $15; the OpenAI table, and now every provider, falls back to the gpt-5.4 workhorse rate.)
 */
export const FALLBACK_PRICE: PriceEntry = {
  ...old('2026-05-18', 'fallback: assume the gpt-5.4 workhorse rate (lib/ai/models.ts FALLBACK_PRICING, 144b3a84)', 2.5, 15.0),
};

/** Campus (RCD) models are free. */
const ZERO_PRICE: PriceEntry = { from: '1970-01-01', source: 'campus models cost nothing', input: 0, cachedInput: 0, output: 0 };

/**
 * RCD gateway credits per million tokens, where known. Separate from USD because
 * the gateway's shared credit pool is its own constraint. Measured 2026-10-28
 * (docs/STATE.md, "RCD credit rates"): gpt-6.1-sol input (≈2.5; the gateway's cache
 * writes carry no premium) and cache reads (≈0.08). ESTIMATED, not measured: Sol
 * output and every gpt-6.1-terra figure (list × 1.25).
 */
export const CREDIT_RATES: Record<string, CreditRate[]> = {
  'gpt-6.1-sol': [{ from: '2026-10-28', source: 'RCD gateway measurement 2026-10-28 (STATE.md); output estimated as list x 1.25', input: 2.5, cachedInput: 0.08, output: 12.5 }],
  'gpt-6.1-terra': [{ from: '2026-10-28', source: 'RCD gateway 2026-10-28 (STATE.md): all three ESTIMATED as list x 1.25, not measured', input: 1.25, cachedInput: 0.04, output: 6.25 }],
};

/** Whisper (paid OpenAI backend) per audio minute, USD. */
export const WHISPER_PER_MINUTE: Array<{ from: string; source: string; usd: number }> = [
  { from: '2026-05-23', source: 'lib/ai/transcribe.ts @ 23efd660 (OpenAI Whisper ~$0.006/min)', usd: 0.006 },
];

const asOf = (at: Date) => at.toISOString().slice(0, 10);
const newest = <T extends { from: string }>(list: T[] | undefined, at: Date): T | undefined =>
  (list ?? []).filter(e => e.from <= asOf(at)).sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0))[0];

const warned = new Set<string>();

/** Newest entry with from ≤ at. Campus model → zero entry. Unknown (or priced only after `at`) → FALLBACK_PRICE, warned once per model. */
export function priceFor(model: string, at: Date = new Date()): PriceEntry {
  if (isCampusModel(model)) return ZERO_PRICE;
  const hit = newest(PRICES[model], at);
  if (hit) return hit;
  if (!warned.has(model)) {
    warned.add(model);
    console.warn(`[prices] no price on file for "${model}"; using the fallback ${FALLBACK_PRICE.input}/${FALLBACK_PRICE.output} USD per M tokens`);
  }
  return FALLBACK_PRICE;
}

/** True when the model has a price on file (campus models count: they are free). */
export function hasPrice(model: string): boolean {
  return isCampusModel(model) || model in PRICES;
}

const units = (tokens: number, usdPerMillion: number) => Math.ceil((tokens / 1_000_000) * usdPerMillion * 100 * 100);

/** Cost in 1/100-cent units (the unit `daily_cost` uses). Each term rounds up on its own. */
export function costUsdCents(model: string, t: TokenCounts, at: Date = new Date()): number {
  const p = priceFor(model, at);
  return units(t.freshInput, p.input)
    + units(t.cachedInput, p.cachedInput)
    + units(t.output, p.output)
    + (t.cacheWrite ? units(t.cacheWrite, p.cacheWrite ?? p.input) : 0);
}

/** RCD gateway credits for the usage, or null when no credit rate is known for the model. Uses the newest rate on file as of `at`. */
export function costCredits(model: string, t: TokenCounts, at: Date = new Date()): number | null {
  const r = newest(CREDIT_RATES[model], at);
  if (!r) return null;
  // The gateway bills cache writes as plain input (no premium).
  return ((t.freshInput + (t.cacheWrite ?? 0)) * r.input + t.cachedInput * r.cachedInput + t.output * r.output) / 1_000_000;
}

/** True when a credit rate is on file for the model. */
export function hasCreditRate(model: string): boolean {
  return model in CREDIT_RATES;
}

/** Whisper cost for `minutes` of audio in 1/100-cent units, rounded up. */
export function whisperCostUnits(minutes: number, at: Date = new Date()): number {
  const w = newest(WHISPER_PER_MINUTE, at) ?? WHISPER_PER_MINUTE[0]!;
  return Math.ceil(minutes * Math.round(w.usd * 100 * 100));
}
