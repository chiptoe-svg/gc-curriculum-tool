# Model Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the light/default/heavy tiers with four roles (Judge, Converse, Write, Extract), each carrying a model and a reasoning effort, with no model or effort change except `parse-profile-fields` → gpt-5.4-mini.

**Architecture:** Roles live in the registry `lib/ai/models.ts`. `lib/ai/function-settings.ts` maps each function to a role, reads saved rows (old tier names mapped on read), and resolves `{ model, effort }`. The provider factory and the KUD chat take both. `/settings` shows roles read-only and lets each function pick a role or a custom model. A one-time script deletes the seven custom rows that duplicate their role.

**Tech Stack:** TypeScript strict, Next.js 15, Drizzle on Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-model-roles-design.md`

## Global Constraints

- Roles and day-one settings: `judge`, `converse`, `write` → `gpt-6.1-sol`, effort `low`; `extract` → `gpt-5.4-mini`, no effort.
- Stored values in `ai_function_settings.tier`: `judge` | `converse` | `write` | `extract` | `custom`. No schema migration.
- Legacy rows: `light` → `extract`; `default`/`heavy` → the function's compiled role, unless that role is `extract`, then resolve as `gpt-6.1-sol` with that model's default effort.
- Effort order: caller's explicit effort → `OPENAI_REASONING_EFFORT` → role effort → `DEFAULT_REASONING_EFFORT[model]`. A custom row uses the model's default.
- Roles are read-only in the UI; changed only in `lib/ai/models.ts`.
- Model ids only in `lib/ai/models.ts` (guard test `lib/ai/__tests__/model-registry.test.ts` must stay green).
- Live DB writes only with the owner's yes; vitest with `env -u DATABASE_URL` (or the scratch DB). US spelling.

## Review Focus

1. A saved `default` row on an Extract function must still resolve to gpt-6.1-sol, not mini — pinned in Task 2.
2. A saved row with an unknown tier string must fall back to the function's compiled role, not throw — pinned in Task 2.
3. `OPENAI_REASONING_EFFORT` set in env must still override a role's effort (evaluation knob) — pinned in Task 3.
4. A custom row naming a model with no default effort must send no `reasoning_effort` — pinned in Task 2.
5. The PUT route must reject old tier names for new writes (`light`/`default`/`heavy`) so no new legacy rows appear — pinned in Task 4.

---

### Task 1: Roles in the registry

**Files:**
- Modify: `lib/ai/models.ts`
- Test: `lib/ai/__tests__/model-roles.test.ts` (create)

**Interfaces:**
- Produces: `type ModelRole = 'judge' | 'converse' | 'write' | 'extract'`; `const MODEL_ROLES: readonly ModelRole[]` (that order); `const ROLE_SETTINGS: Record<ModelRole, { model: string; effort: string | undefined; label: string; purpose: string }>`. `TIER_TO_MODEL` and `Tier` are removed.
- Copy for `label` / `purpose` (from the spec table): Judge — "Produces a score or claim that becomes the stored record"; Converse — "Faculty-facing chat, turn by turn, often with tools"; Write — "Prose or proposals a person reads or approves"; Extract — "Bounded extraction, classification or summary, often in bulk".

- [ ] **Step 1: Write the failing test** `model-roles.test.ts`: `ROLE_SETTINGS.judge/converse/write` equal `{ model: 'gpt-6.1-sol', effort: 'low' }` (match on those two keys); `ROLE_SETTINGS.extract` has `model: 'gpt-5.4-mini'`, `effort: undefined`; every role's model has a `MODEL_PRICING` entry.
- [ ] **Step 2: Run** `env -u DATABASE_URL pnpm -s vitest run lib/ai/__tests__/model-roles.test.ts` — Expected: FAIL (no `ROLE_SETTINGS` export).
- [ ] **Step 3: Implement** `ROLE_SETTINGS`/`MODEL_ROLES`/`ModelRole` in `lib/ai/models.ts`; delete `TIER_TO_MODEL`/`Tier` (callers move in Tasks 2–4; tsc may fail until Task 4 — run only the task's tests here).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): model roles in the registry`.

### Task 2: Function settings resolve role → { model, effort }

**Files:**
- Modify: `lib/ai/function-settings.ts`
- Test: `lib/ai/__tests__/function-roles.test.ts` (create; mock `@/lib/db/client` the way other unit tests in the repo do, so no DB is touched)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `type StoredTier = ModelRole | 'custom'`; `ModelTier` removed.
  - `const DEFAULT_ROLES: Record<AIFunctionId, ModelRole>` — assignments exactly as the spec's "Function assignments" lists (29 ids). `DEFAULT_TIERS` removed.
  - `function resolveSetting(functionId: AIFunctionId, tier: string | null, customModel: string | null): { role: ModelRole | 'custom'; model: string; effort: string | undefined }` — pure; applies the legacy mapping and unknown-value fallback.
  - `async function resolveForFunction(id: AIFunctionId): Promise<{ model: string; effort: string | undefined }>` (cached as today).
  - `resolveModelForFunction(id)` kept, returns `(await resolveForFunction(id)).model` (scripts use it).
  - `FunctionSettingRow` becomes `{ functionId; tier: StoredTier; customModel; resolvedModel; resolvedEffort: string | undefined; defaultRole: ModelRole }`.
  - `UpsertFunctionSettingInput.tier: StoredTier`.

- [ ] **Step 1: Write the failing tests** in `function-roles.test.ts`:
  - `DEFAULT_ROLES` has exactly the 29 `AI_FUNCTION_IDS`, and the four lists match the spec.
  - Every function's compiled default resolves (via `resolveSetting(id, null, null)`) to the same `{model, effort}` as today — today = gpt-6.1-sol/`low` for every non-`light` function in the old `DEFAULT_TIERS`, gpt-5.4-mini/`undefined` for the old `light` ones — **except** `parse-profile-fields` → gpt-5.4-mini/`undefined`. Write the expected table inline.
  - `resolveSetting('material-digest', 'default', null)` → `{ model: 'gpt-6.1-sol', effort: 'low' }` (Review Focus 1).
  - `resolveSetting('wiki-update', 'light', null)` → extract (`gpt-5.4-mini`).
  - `resolveSetting('wiki-update', 'heavy', null)` → `{ role: 'write', model: 'gpt-6.1-sol', effort: 'low' }`.
  - `resolveSetting('wiki-update', 'bogus', null)` → role `write` (Review Focus 2).
  - `resolveSetting('jd-extract', 'custom', 'gpt-5.4')` → `{ model: 'gpt-5.4', effort: undefined }` (Review Focus 4).
- [ ] **Step 2: Run** `env -u DATABASE_URL pnpm -s vitest run lib/ai/__tests__/function-roles.test.ts` — Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** in `function-settings.ts`: replace tier types/maps with the Produces block; custom and legacy-Extract cases take effort from `DEFAULT_REASONING_EFFORT[model]`; keep labels/descriptions; replace the long per-function tier comments with one comment pointing at the spec.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): functions resolve a role to model and effort`.

### Task 3: Effort reaches every call path

**Files:**
- Modify: `lib/ai/provider.ts`, `lib/ai/analyze/kud-chat.ts`, `app/api/health/route.ts`
- Test: `lib/ai/__tests__/provider-roles.test.ts` (create; mock `resolveForFunction`)

**Interfaces:**
- Consumes: `resolveForFunction`, `ROLE_SETTINGS`.
- Produces: `getProviderForFunction(id, override?)` builds the provider with `model` and effort `process.env.OPENAI_REASONING_EFFORT?.trim() || resolved.effort` (an explicit `override.reasoningEffort` still wins). The env-default fallback in `buildProvider` uses `ROLE_SETTINGS.write.model`. `/api/health` reports `aiRoles: Record<ModelRole, {model, effort}>` in place of `aiTiers`.

- [ ] **Step 1: Write the failing tests:** with `resolveForFunction` mocked to `{ model: 'gpt-6.1-sol', effort: 'medium' }` and `AI_PROVIDER=openai`, `OPENAI_API_KEY=x`, `(await getProviderForFunction('wiki-update'))` sends `reasoning_effort: 'medium'` (assert through the same seam `openai-effort.test.ts` uses); with `OPENAI_REASONING_EFFORT=high` set, it sends `high` (Review Focus 3); with `override: { model: 'gpt-5.4', reasoningEffort: 'low' }` it sends `low`.
- [ ] **Step 2: Run** `env -u DATABASE_URL pnpm -s vitest run lib/ai/__tests__/provider-roles.test.ts` — Expected: FAIL (effort not passed).
- [ ] **Step 3: Implement** the Produces block; `kudChatTurn` takes `{ model, effort }` from `resolveForFunction('kud-chat')`.
- [ ] **Step 4: Run** that test plus `lib/ai/__tests__/openai-effort.test.ts lib/ai/__tests__/provider.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): role effort reaches the provider and KUD chat`.

### Task 4: Settings API and page show roles

**Files:**
- Modify: `app/api/settings/ai-models/route.ts`, `app/settings/page.tsx`, `app/settings/SettingsClient.tsx`
- Test: `tests/app/settings/SettingsClientAdmin.test.tsx` (update), `tests/api/settings-ai-models-roles.test.ts` (create)

**Interfaces:**
- Consumes: `MODEL_ROLES`, `ROLE_SETTINGS`, `DEFAULT_ROLES`, `StoredTier`, `FunctionSettingRow` (with `resolvedEffort`).
- Produces: GET returns `roles: ROLE_SETTINGS` in place of `tierToModel`, and `defaults: DEFAULT_ROLES`. PUT accepts `tier` in `judge|converse|write|extract|custom` and returns 400 for anything else, including `light`/`default`/`heavy`. Page: a header listing each role with label, purpose, model and effort; functions grouped under their current role (custom rows in a "Custom model" group); per function, buttons for the four roles plus custom; each row shows resolved model and effort.

- [ ] **Step 1: Write the failing tests:** route test — PUT with `tier: 'default'` → 400 (Review Focus 5); `tier: 'judge'` → 200 and `upsertFunctionSetting` called with `tier: 'judge'` (mock it and the slug/rate-limit helpers as the existing settings route tests do, or as `tests/api/analyze-materials.test.ts` mocks its deps). UI test — render with `roles: ROLE_SETTINGS` and `defaults: DEFAULT_ROLES`; the four role headings render with their purpose text, and `Wiki page regeneration` appears under the Write heading.
- [ ] **Step 2: Run** `env -u DATABASE_URL pnpm -s vitest run tests/api/settings-ai-models-roles.test.ts tests/app/settings/SettingsClientAdmin.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the Produces block.
- [ ] **Step 4: Run** the same command, then the whole suite `env -u DATABASE_URL pnpm -s vitest run`, `pnpm -s tsc --noEmit -p .`, and `pnpm -s eslint` on changed files — Expected: all PASS / clean.
- [ ] **Step 5: Commit** `feat(settings): /settings groups functions by role`.

### Task 5: Cleanup script for duplicate custom rows

**Files:**
- Create: `scripts/ai/cleanup-role-rows.ts`
- Test: `tests/db/cleanup-role-rows.test.ts` (scratch-gated with `isP2ScratchDb`, committed fixture rows cleaned up, like `tests/db/competency-substrate-contributors.test.ts`)

**Interfaces:**
- Consumes: `resolveSetting`, `DEFAULT_ROLES`, `ROLE_SETTINGS`, `DEFAULT_REASONING_EFFORT`.
- Produces: `export async function planCleanup(ex): Promise<{ delete: string[]; keep: Array<{ functionId: string; reason: string }> }>` and a CLI `--expect-db <name> [--apply]` (dry run default; refuses when `current_database()` ≠ `--expect-db`). A custom row is deleted only if its model equals its compiled role's model and that model's default effort equals the role's effort; every other custom row is listed with a reason and kept. Non-custom rows are untouched.

- [ ] **Step 1: Write the failing test** (scratch): insert custom rows `capture-scores → gpt-6.1-sol` (delete), `material-digest → gpt-6.1-sol` (keep: role is extract), `wiki-update → gpt-5.5` (keep); `planCleanup` returns exactly those verdicts; applying deletes only `capture-scores`.
- [ ] **Step 2: Run** `DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/cleanup-role-rows.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the script.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): one-time cleanup of custom rows that duplicate their role`.

### Task 6: Docs, deploy and live check

**Files:**
- Modify: `docs/STATE.md` (AI-function table: tier column → role; registry note: roles; Deferred/debt untouched unless something is deferred)

- [ ] **Step 1:** Before deploying, capture today's `/settings` resolved model per function (faculty login read via `read-env.mjs`, never printed) to the scratchpad.
- [ ] **Step 2:** Update STATE.md; commit `docs(state): model roles`.
- [ ] **Step 3:** Deploy chain (fast-forward the deploy checkout, push `main` and `dev`, `pnpm -s build`, kickstart).
- [ ] **Step 4:** Live check: every function's resolved model and effort on `/settings` equals the capture (effort `low` for gpt-6.1-sol, none for gpt-5.4-mini), except `parse-profile-fields` → gpt-5.4-mini. Expected: no other differences.
- [ ] **Step 5:** Run `scripts/ai/cleanup-role-rows.ts --expect-db gc_curriculum` dry run against live (owner runs it, or owner yes), show the plan; on the owner's yes, `--apply`; repeat Step 4.
