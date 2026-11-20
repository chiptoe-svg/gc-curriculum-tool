# /settings vetted models, evidence and search settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The /settings picker offers vetted models (OpenAI + campus), every function shows the evidence behind
its model with a link, the reranker gets an admin override, and /admin links to /settings.

**Architecture:** A pure catalog module builds the picker groups; a file-based evidence register
(`docs/benchmarks/*.md`) is parsed server-side and passed to the client; a one-row-per-key `app_settings` table
holds the reranker override, read through a cached async switch.

**Tech Stack:** Next.js 15, React, Drizzle/Postgres 17, Vitest, react-markdown + remark-gfm.

**Spec:** `docs/superpowers/specs/2026-11-20-settings-evidence-design.md`

## Global Constraints

- US spelling, plain language. No secrets in pages or logs.
- Campus model ids exactly `CAMPUS_MODELS` (never `tiger`/`cub`).
- Live migration 0073 only with the owner's go-ahead and a backup first.
- Admin-only writes: new write routes must classify as `admin` in `lib/auth/authorize.ts` (unlisted writes do).

## Review Focus

1. A function pinned to a model in neither list (e.g. gpt-4.1) must still show its model in the picker.
2. A reranker DB read failure must not break search: fall back to the env switch.
3. A benchmark file with bad frontmatter must be skipped, not crash /settings.
4. `/settings/benchmarks/<id>` with an unknown or path-like id (`../x`) returns 404, never reads outside the folder.
5. Non-admin viewers see the Search section read-only.

---

### Task 1: Model catalog

**Files:** Create `lib/ai/model-catalog.ts`, test `lib/ai/__tests__/model-catalog.test.ts`.

**Produces:** `VETTED_MODELS: Array<{ id: string; provider: 'openai'|'campus'; price: string; note: string | null }>`;
`pickerGroups(gateway: string[], showAll: boolean, current: string | null): Array<{ label: string; models: Array<{ id: string; text: string }> }>`.

- [ ] Tests: groups are "OpenAI" (6 ids in spec order) and "Campus (free)" (the 4 `CAMPUS_MODELS`); price text
  `$1.00 / $5.00 per M tokens` for terra, `free` for campus, `price not on file` for gpt-6.2-sol; showAll adds
  "Everything the gateway offers" with the gateway ids not already listed; a current model in no group is added
  as a "Pinned now" group; nothing is listed twice.
- [ ] Run, see fail; implement; run, see pass; commit.

### Task 2: Evidence register

**Files:** Create `docs/benchmarks/*.md` (8 files), `lib/settings/evidence.ts`, test `lib/settings/__tests__/evidence.test.ts`.

**Produces:** `loadEvidence(dir?: string): Evidence[]` (`{ id, title, date, applies: string[], summary, body }`,
sorted newest first, bad files skipped); `evidenceFor(list, functionId, role, campusRouted): Evidence | null`
(order: function id, then `role:<role>` — campus-routed functions use their function id only);
`getEvidence(id)` (id must match `^[a-z0-9-]+$`).

- [ ] Tests with a temp dir: parsing, skip bad frontmatter, lookup order, path-like id → null.
- [ ] Write the 8 files from STATE.md and the 2026-10-05 audit (figures copied verbatim, pointer to source).
- [ ] Test that every `applies` key in the real folder names a known function id, role, or `search:*`.
- [ ] Commit.

### Task 3: Search settings storage + switch + API

**Files:** `drizzle/0073_app_settings.sql`, `lib/db/schema.ts` (`appSettings`), `lib/settings/app-settings.ts`,
`lib/ai/rerank.ts` (`rerankEnabledNow`), `lib/capture/vector-store-weaviate.ts`, `app/api/settings/search/route.ts`,
tests `lib/settings/__tests__/rerank-switch.test.ts`, `app/api/settings/search/__tests__/route.test.ts`.

**Produces:** `getRerankOverride(): Promise<'on'|'off'|null>`, `setRerankOverride(v: 'on'|'off'|null)`,
`rerankEnabledNow(): Promise<boolean>` (override, else `rerankEnabled()`; DB error → env; 30 s cache,
cleared by `setRerankOverride`). Route GET `{ rerank: { override, effective, model }, embedding: { model } }`,
PUT `{ rerank: 'on'|'off'|null }` (slug-checked like ai-models).

- [ ] Tests: override wins; null → env; DB throws → env; PUT validates; `classify('PUT','/api/settings/search')` is admin.
- [ ] Implement, pass, commit.

### Task 4: /settings UI + benchmark page + /admin link

**Files:** `app/settings/page.tsx`, `app/settings/SettingsClient.tsx`, `app/settings/benchmarks/[id]/page.tsx`,
`app/admin/page.tsx`.

- [ ] Picker uses `pickerGroups` (optgroups) with a "Show every model the gateway offers" checkbox.
- [ ] Each function row and role header shows "Basis: <summary> (<date>) · benchmark →" or "Not benchmarked for this function".
- [ ] Search section (reranker On/Off/Default, effective state, evidence link; embedding model, display only).
- [ ] Benchmark page renders the markdown; unknown id → `notFound()`.
- [ ] /admin header gains "Settings".
- [ ] Typecheck, suite, commit.

### Task 5: STATE + live

- [ ] STATE.md: routes, migration, env behavior, the register; deferrals.
- [ ] Owner go-ahead → backup, apply 0073, deploy, check pages.
