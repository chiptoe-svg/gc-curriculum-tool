# /settings: vetted models, the evidence behind each choice, and search settings

**Status:** approved by the owner 2026-11-20 ("do the What I'd add", then "agree" to the short list, plus a
Settings link on /admin).

## Why

/settings shows which model each AI function uses and lets an admin override it, but:

- The model picker lists every chat model the RCD gateway offers for our key (it filters by name only: anything
  starting `gpt-` or `o`). That includes gpt-4o, gpt-4.1, gpt-5 and o3, which nobody has tested on our prompts.
- The four vetted campus models (`CAMPUS_MODELS`) never appear, though the server routes a pinned campus model
  correctly (`fromModel` in `lib/ai/function-settings.ts`).
- Nothing says why a function runs on its model. The evidence is in STATE.md and repo audit files.
- The reranker (`RERANK` env) and the embedding model are not on the page at all.
- /admin does not link to /settings.

## Approaches

- **A. A short vetted list, the full gateway list behind a switch.** *Chosen (owner "agree").*
- B. Keep the gateway list; add campus models and drop pre-GPT-5 names. Still offers untested models.

## Design

1. **Vetted model list** (`lib/ai/model-catalog.ts`): OpenAI gpt-6.1-sol, gpt-6.1-terra, gpt-6.2-sol,
   gpt-6.2-astra, gpt-5.4-mini, gpt-5.4-nano; campus (free) the four `CAMPUS_MODELS`. Each shows its price per
   million tokens from `MODEL_PRICING`, "free" for campus, or "price not on file". gpt-6.2-sol and gpt-6.2-astra
   are marked "not tested here". The picker groups them (OpenAI / Campus); a "Show every model the gateway
   offers" switch adds the current gateway list as a third group. A pinned model outside both lists still shows.
2. **Evidence register** (`docs/benchmarks/*.md`, one file per decision, frontmatter `title`, `date`,
   `applies` (function ids, `role:<role>`, `search:rerank`, `search:embedding`), `summary`). Figures are copied
   from STATE.md and the 2026-10-05 audit, with pointers to the original records. `lib/settings/evidence.ts`
   loads them; a function row shows its own evidence, else its campus route's, else its role's, else
   "Not benchmarked for this function". Each line links to `/settings/benchmarks/<id>`, which renders the file.
3. **Search section:** reranker On / Off / Default (Default = the `RERANK` env, on unless `off`), model
   `qwen3-rerank-4b`; embedding model `qwen3-embedding-4b`, display only (changing it means re-embedding).
   Storage: new table `app_settings (key text pk, value text, updated_at)` (migration 0073, additive);
   `rerankEnabledNow()` reads it with a 30 s cache and falls back to the env switch; the Weaviate search uses
   it. `PUT /api/settings/search` (admin, like every unlisted write).
4. **/admin header** gains a Settings link (with the slug).

## Not in this change

- Rewriting benchmark write-ups into research documents; the register is a pointer with the numbers.
- Changing the embedding model from the page.
