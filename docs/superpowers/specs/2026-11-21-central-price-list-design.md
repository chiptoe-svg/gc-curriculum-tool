# One price list for every cost estimate — design (2026-11-21)

**Owner decisions (2026-11-21):** "create a central price storage, and use it for all cost estimates (just one place to update) and keep all historical references"; storage = **a file in the code** (not a settings-page table).

## Why
Prices are written down in six places that disagree: `lib/ai/models.ts` `MODEL_PRICING` (OpenAI list $), a cached-input factor hard-coded as `× 0.1` in four spots in `lib/ai/openai.ts` plus `lib/ai/agent/pi/turn.ts` and `lib/ai/anthropic.ts`, a separate Claude table in `lib/ai/anthropic.ts`, measured RCD gateway credit rates in `scripts/capture/interview-bench.ts`, a copied gpt-5.4-mini price in `scripts/bench/classify-holdout.ts`, and Whisper's $0.006/min in `lib/ai/transcribe.ts`. The Clemson contract reference (2026-11-21) shows the cached rate is 5% of input for GPT-6.1/6.2 (10% for GPT-6 and 5.6), not a flat 10%. The real constraint is the RCD gateway's shared credit pool, so estimates need credits as well as dollars.

## Design
- **One file, `lib/ai/prices.ts`,** holds every price as dated entries: model id, the date it took effect (`from`, YYYY-MM-DD), a `source` string (e.g. "Clemson OpenAI token pricing reference, 2026-11-21", "RCD gateway measurement, 2026-10-28 (STATE.md)", "OpenAI list, 2026-10-05"), and rates per million tokens for **fresh input, cached input and output** (plus cache writes where a provider charges them, e.g. Anthropic), in **USD**; and, where known, the same three in **RCD gateway credits**. Non-token prices (Whisper per minute) live in the same file with their unit.
- **History is kept in the file:** a price change adds a new dated entry; old entries are never edited or deleted. Lookups take a date (default now) and use the newest entry whose `from` ≤ that date. Initial history is reconstructed from `git log -p lib/ai/models.ts` (and the other files) — each past value with the commit date it appeared — plus the 2026-11-21 Clemson reference and the 2026-10-28 gateway measurement.
- **Campus models (`CAMPUS_MODELS`) cost $0 / 0 credits.** An unknown model uses one explicit fallback entry and logs a warning (as today's `FALLBACK_PRICING` silently does).
- **Every cost calculation goes through it:** one `costUsdCents(model, tokens, at?)` (tokens = fresh input, cached input, output, cache writes) and one `costCredits(model, tokens, at?)`. Replaces the inline math in openai.ts (4 places + the pre-call estimate), pi/turn.ts, anthropic.ts, interview-bench.ts `estimateCredits`, classify-holdout.ts, transcribe.ts. `lib/ai/model-catalog.ts` (settings model list) reads current prices from it. Units unchanged: `daily_cost` stays in 1/100-cent units.
- **A guard test** fails if a price literal or a cached-rate factor appears outside `prices.ts` (scan `lib/`, `app/`, `scripts/` for `MODEL_PRICING`, `{ input: <n>, output: <n> }` price objects, and `* 0.1`-style cache factors in cost code).

## Not in scope
A settings-page editor; tagging each `daily_cost` row with the price version (daily_cost stores day totals only); recording the wiki-writer calls in `daily_cost` (separate known gap).

## Effect
Logged costs change slightly: cached input for gpt-6.1-sol/terra drops from 10% to 5% of input. Historical log rows are not recomputed.
