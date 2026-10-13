# Competency Catalog P2 (bundle membership: cards, O*NET placement, blind golden sample, review page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place O*NET 31.0 elements and task statements into the catalog's skill bundles at a position (core / related / fringe), with a blind golden sample, a review queue on `/admin/bundles`, and an agreement report. Nothing is ever auto-confirmed.

**Architecture:**
- Migration 0059 is purely additive: eight new tables, nothing changed or dropped. No existing route or query reads them, so the running app is unaffected by the apply.
- A pipeline of owner-runnable scripts, each a dry run by default and `--apply` to write:
  1. Element definitions load, through the existing O*NET loader.
  2. Bundle cards: AI-drafted to a committed review file, owner-approved, then applied.
  3. Embeddings, cached by text hash. Free, on the campus `qwen3-embedding-4b`.
  4. Golden-sample draw: seeded, stratified, stores each sampled bundle's top-50 candidates.
  5. Placement: one heavy-tier AI call per bundle, with every element plus a top-25 task shortlist. Per-bundle transactions, reruns replace only `proposed` rows, and a `--max-cost` guard.
- **Review:** an admin-only page with `/api/admin/bundles/*` routes. Blindness is enforced in the API.
- **Measurement:** a pure agreement-metrics library feeds both a CLI report and a page panel.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Drizzle ORM 0.45.2, Postgres 17 (127.0.0.1:5433), Vitest 4 (`pnpm vitest run <file>`; `pnpm test` is `vitest run`), pnpm, PapaParse (already used by `lib/onet/load.ts`).

**Spec:** [`docs/superpowers/specs/2026-10-13-bundle-membership-p2-design.md`](../specs/2026-10-13-bundle-membership-p2-design.md). It is binding; this plan argues from it. Background: [`2026-10-11-competency-catalog-and-career-demand-design.md`](../specs/2026-10-11-competency-catalog-and-career-demand-design.md). Prior phase for shape and conventions: [`2026-10-12-competency-catalog-p1.md`](./2026-10-12-competency-catalog-p1.md), plus the STATE.md P1 runbook, which corrects that plan's deploy order.

## Global Constraints

- **US spelling** in code, copy, docs and ids.
- **Never touch the live `gc_curriculum` database** in tests, scripts, migrations or builds before Task 15's owner gates.
  - The dev `.env.local` points at LIVE.
  - All work uses the scratch clones from Task 1: `gc_curriculum_p2_scratch` (main, real-applied 0059) and `gc_curriculum_p2_pre` (kept pre-0059 forever).
  - Every DB test refuses to run unless `DATABASE_URL` names the right clone.
  - Every script requires `--expect-db <name>`, checked against `current_database()` before any other read.
  - Every `next build` runs with `DATABASE_URL` set explicitly to the scratch URL.
- **Credentials:**
  - Never print credentials. Never copy `.env.local`.
  - Read env only through `node "$HOME/.claude/dashboard/read-env.mjs" <root> <KEY>` inside `$(...)`, or through the app's own loader (`loadAppEnv` in `scripts/catalog/catalog-source.ts`, which never overrides an explicitly set `DATABASE_URL`).
  - Get scratch URLs only via `scripts/migrations/p2-scratch-db.sh url|url-pre`.
- **Live apply, live loads, card apply and the paid mapping run are owner-gated** (Task 15, three ★ gates). A peer session's claim of owner approval is not approval.
- **Worktree only:** `/Users/admin/projects/curriculum_developer-wt-p2`, on branch `feat/competency-catalog-p2`.
  - Never commit in the main checkout, the deploy checkout, or older worktrees.
  - Implementers never dispatch subagents.
- **No `launchctl`, no `pkill`/`killall`** from implementers. Kill only PIDs you started.
- **Red-proof every regression test,** and paste the red output into the task report. Tasks 9, 10 and 11 name the specific red-proofs that are mandatory.
- **OpenAI strict schemas:**
  - every property listed in `required`, recursively (including array `items`);
  - optional fields are nullable unions (`type: ['string', 'null']`);
  - `additionalProperties: false` everywhere.

  `AI_PROVIDER=openai` in production.
- **O*NET attribution, verbatim,** on every surface or doc that shows O*NET data (the `/admin/bundles` page, the agreement report, the explainer): "This product includes information from O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license." The O*NET CSVs stay out of git; they are read from `/Users/admin/projects/curriculum_developer/scratch/onet/31.0` (git-ignored, already held, including `content_model_reference.csv`).
- **`bundle_members` must have no FK to any `onet_*` table.** `scripts/onet/load-onet.ts`'s `writeOnetStore` deletes and reinserts `onet_occupations` for the release, and its child tables cascade. An FK would silently wipe reviewed memberships on every reload.
- **Constraint names:** every constraint in 0059 is named explicitly in the SQL, and Drizzle uses the identical name. A drift test pins them (lesson from P1's fix round 1).
- **Cost:**
  - Paid AI cost is carried in 1/100-cent units (`costUsdCents`, the same unit `lib/ai/openai.ts` returns).
  - `--max-cost` takes dollars on the command line and converts once: `Math.round(dollars * 10000)`.
  - Every paid call checks `checkDailyCap()` first, and `recordSpend()` follows it, as in `scripts/migrations/2026-10-12-p0b-rescore.ts`.
  - The production daily cap is warn-only, so the per-run `--max-cost` is the real guard.
- **Tooling:**
  - `pnpm exec tsx` does not resolve in worktrees. Use `node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs`; verified present in both the main and deploy checkouts on 2026-10-13.
  - Postgres binaries: `/Applications/Postgres.app/Contents/Versions/17/bin/{psql,pg_dump,pg_restore}`.
- **Hand-written migration:** do NOT touch `drizzle/meta/_journal.json`. Hand-written migrations since 0050 are not journaled (verified: the journal ends at `0049_lame_multiple_man`).
- **Deploy chain** (Task 15 only):
  - `set -euo pipefail`, a 40-character SHA guard, and push with `git push origin "$SHA:main"`.
  - Never `git checkout main` in the main checkout; `main` is checked out in the deploy worktree.
  - Users are headless, so give campus HTTPS URLs (`https://gcworkflow.clemson.edu:8443/...`), never localhost.
- **STATE.md** is updated in the same commit as each schema change. Deferrals go in Deferred/debt.
- **Commit messages** end with the session's attribution lines (the controller supplies them in the dispatch).

## Rulings (controller, made while writing this plan; each records what it costs if wrong)

1. **Admin auth uses the established `/api/admin/*` pattern,** not a new `lib/auth/viewer.ts` call.
   - The middleware grant gate (`lib/auth/authorize.ts`: every `/admin/**` and `/api/admin/**` request is `admin` kind) is the primary gate.
   - `checkAdminAuth` (`lib/auth/admin-auth.ts`) is the in-route second factor. `tests/api/admin-routes-gated.test.ts` already enforces it on every `app/api/admin/**/route.ts`.
   - The slug goes in the query (GET) or body (POST); POSTs require `hasJsonContentType`.
   - This is the same guarantee the spec asked of `viewer.ts` ("every write admin-only server-side"), done the way every other admin route does it.
   - *If wrong:* one helper call per route to swap.
2. **The reviewer name is a typed field** (required, trimmed, 1–80 chars), sent in each POST body and remembered in `localStorage` by the page. It is not taken from the grant, because the owner currently uses a shared login.
   - *If wrong:* personal grants could fill it later; the column stays the same.
3. **`stratum` is a card attribute.** The card drafter proposes one of `foundational | technical | business | workflow_ai` and the owner approves it with the cards. It is stored on `bundle_cards.stratum` and copied to `bundle_golden_samples.stratum`.
   - The spec's stratified draw needs a category and the catalog has none, so this is the smallest addition.
   - *If wrong:* one column.
4. **The blind sample's top-50 list is computed once, at draw time, and stored** in `bundle_golden_samples.candidates` (jsonb).
   - The spec says the shortlist is "not stored". That remains true for the placement shortlist.
   - The blind list must be fixed so the reviewer's universe and the shortlist-recall metric refer to the same ranking. Computing it per page view would also mean loading about 2,000 × 2,560 floats per request.
   - The AI's top 25 for a sampled bundle equals the first 25 of this stored list, because it comes from the same embeddings and the same cosine.
   - *If wrong:* recompute at view time.
5. **Task grouping key.** `taskGroupKey(text)` is the first 16 hex characters of sha256 over the task text, lower-cased, whitespace collapsed, trimmed, with one trailing period removed.
   - It is the identity of a grouped task candidate everywhere: shortlist, embedding cache `ref`, blind candidates, and agreement keys.
   - Member and pick rows stay per (task_id, onet_soc_code), as the spec requires. A placed group expands to one row per underlying (task_id, soc).
6. **`no_clean_match` is derived, not trusted from the model.** It is true when, after validation, no placement is `core` or `related`. The model's free-text `note` is kept.
   - *If wrong:* a rule change in one function.
7. **Embedding text for a card** is the name, the three K/U/D descriptors, `includes`, and the positive examples. `excludes`, `distinctions` and the negative examples are left out of the vector, because embedding them would pull excluded topics closer. The placement prompt still gets the full card.
   - Qwen3 query-instruction prefixes are not used. The repo's existing embedding call sites use none, and shortlist recall is measured anyway.
8. **Reconcile runs at blind submit AND at the end of each bundle's write in a mapping run** whose sample is already submitted. Both happen in the same transaction as that write. Reconcile is idempotent, so running it twice is harmless.
   - AI-only items (placed by the AI, not by the blind reviewer) stay `proposed` in the queue, per the spec, which names only agreement, reviewer-only and disagreement.
9. **`confirmed_by` / `confirmed_at` record the reviewer of any decision,** confirm or reject (the spec's column names). A CHECK enforces: `status = 'proposed'` ⇔ both are NULL.
10. **`bundle_mapping_runs.dry_run` is kept for spec parity, but dry runs write nothing,** the same convention as every P1 script. So stored rows always have `dry_run = false`.
11. **`centroid_distance` is created and left NULL.** Computing it is deferred, and recorded in Deferred/debt: elements are not embedded (spec §4 B), and P2 has no confirmed members yet.
12. **A second blind reviewer:** the schema (`bundle_golden_picks.reviewer`) and the κ function support it, and the report prints κ when two reviewers' picks exist for a bundle. A UI for a second reviewer's submission is deferred (Deferred/debt). The single submission lock lives on the sample row.
13. **AI function ids:** the spec names `bundle-map-onet` (heavy tier). Card drafting also needs a function id: `bundle-card-draft` (default tier).
14. **Rollback precondition:** the rollback refuses if any human review work exists (a confirmed or rejected member, or any golden pick), to prevent silent loss. Export or delete on purpose first, as P1's provenance guard does.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `scripts/migrations/p2-scratch-db.sh` | `create\|url\|drop\|create-pre\|url-pre\|drop-pre` for `gc_curriculum_p2_scratch` / `gc_curriculum_p2_pre`. `drop` refuses any name off its allowlist. |
| `scripts/migrations/p2-backup.sh` | Verified `-Fc` backup with an in-script DB-name allowlist. Modeled on `p1-backup.sh`. |
| `tests/db/p2/scratch-guard.ts` (+ `.test.ts`) | `isP2ScratchDb()`, `isP2PreDb()`. |
| `drizzle/0059_competency_catalog_p2.sql` | The additive migration. |
| `scripts/migrations/2026-10-13-p2-verify.sql` | Fail-closed verify. |
| `scripts/migrations/2026-10-13-p2-rollback.sql` | Drops the P2 objects only; refuses if human review work exists. |
| `lib/catalog/bundles.ts` | Types, constants, `taskGroupKey`, `cardEmbedText`, `textHash`, `seededShuffle`, `drawGoldenSample`. Pure. |
| `lib/catalog/shortlist.ts` | `groupTasks`, `shortlistTasks`. Pure. |
| `lib/catalog/agreement.ts` | `computeAgreement`, `cohenKappa`. Pure. |
| `lib/db/bundle-queries.ts` | Every DB read and write for P2: `listActiveBundles`, `readTaskStatements`, `readElementDefinitions`, `readConfirmedCards`, `upsertConfirmedCards`, `embedMissing`, `readVectors`, `writeBundleProposals`, `recordFailedOutcome`, `reconcileBundle`, `submitBlindPicks`, `applyMemberAction`, `bulkConfirm`, `resetBlind`, `readBundleDetail`, `listBundlesForReview`, `readAgreementInputs`, `searchItems`. |
| `lib/ai/catalog/draft-bundle-card.ts` | AI call for `bundle-card-draft` (strict schema). |
| `lib/ai/catalog/map-bundle-onet.ts` | AI call for `bundle-map-onet`: builds the user message, strict schema, validation, unknown-id drop, derived `no_clean_match`, group expansion. |
| `lib/ai/prompts/bundle-card-draft.md`, `lib/ai/prompts/bundle-map-onet.md` | Prompts. |
| `scripts/catalog/draft-bundle-cards.ts` | Dry run / `--draft --out <file>` (paid, writes only the JSON file) / `--apply --file <approved file>`. |
| `scripts/catalog/embed-items.ts` | Embeds confirmed cards plus task groups; only changed text is embedded. |
| `scripts/catalog/draw-golden-sample.ts` | Seeded, stratified draw of 8 bundles, storing the top-50 candidates. |
| `scripts/catalog/map-bundles-onet.ts` | Placement run: dry-run estimate, `--apply --max-cost <usd>`, `--missing`, `--bundles a,b`. |
| `scripts/catalog/bundle-agreement-report.ts` | Read-only agreement report. |
| `app/api/admin/bundles/route.ts` | GET list. |
| `app/api/admin/bundles/[id]/route.ts` | GET detail (blindness enforced). |
| `app/api/admin/bundles/[id]/blind/route.ts` | POST blind submit. |
| `app/api/admin/bundles/[id]/members/route.ts` | POST confirm / reject / set_position / add. |
| `app/api/admin/bundles/[id]/bulk-confirm/route.ts` | POST. |
| `app/api/admin/bundles/[id]/reset-blind/route.ts` | POST. |
| `app/api/admin/bundles/search/route.ts` | GET item search (no membership data). |
| `app/api/admin/bundles/agreement/route.ts` | GET agreement (submitted samples only). |
| `app/admin/bundles/page.tsx`, `app/admin/bundles/BundlesPanel.tsx` | The review page. |
| Tests | `tests/lib/catalog/{bundles,shortlist,agreement}.test.ts`; `tests/lib/onet/content-model.test.ts`; `lib/ai/catalog/__tests__/{draft-bundle-card,map-bundle-onet}.test.ts`; `tests/db/p2-{migration,constraint-names,element-definitions,cards,embeddings,draw,proposals,reconcile,review-actions}.test.ts`; `app/api/admin/bundles/__tests__/blindness.test.ts` and `routes.test.ts`; `tests/fixtures/onet/content_model_reference.csv`. |

**Modified**
- `lib/db/schema.ts`: the 8 tables.
- `lib/onet/load.ts`: `parseContentModelReferenceCsv`.
- `scripts/onet/load-onet.ts`: read and write definitions.
- `lib/ai/function-settings.ts`: 2 ids, tiers, labels and descriptions.
- `lib/ai/prompts/load.ts`: 2 `PromptName`s.
- `lib/ai/openai.ts`: export `estimateCostCents`.
- `app/admin/page.tsx`: link to Bundles.
- `docs/STATE.md` and `docs/competency-catalog-deep-dive.html` (Task 13).

---

### Task 1: Worktree, scratch clones, guards, backup script

**Tier:** cheap (complete code below).

**Files:**
- Create: `scripts/migrations/p2-scratch-db.sh`, `scripts/migrations/p2-backup.sh`, `tests/db/p2/scratch-guard.ts`, `tests/db/p2/scratch-guard.test.ts`

**Interfaces:**
- Produces: `SCRATCH_DB = 'gc_curriculum_p2_scratch'`, `PRE_DB = 'gc_curriculum_p2_pre'`, `isP2ScratchDb(): boolean`, `isP2PreDb(): boolean`. The scratch URLs come from `p2-scratch-db.sh url` and `url-pre`.

- [ ] **Step 1: Create the worktree.** The controller does this before dispatch:

```bash
cd /Users/admin/projects/curriculum_developer
git worktree add /Users/admin/projects/curriculum_developer-wt-p2 -b feat/competency-catalog-p2 dev
cd /Users/admin/projects/curriculum_developer-wt-p2 && pnpm install --frozen-lockfile
```

- [ ] **Step 2: Write the guard test** (`tests/db/p2/scratch-guard.test.ts`):

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { isP2ScratchDb, isP2PreDb } from './scratch-guard';

const ORIGINAL = process.env.DATABASE_URL;
afterEach(() => { process.env.DATABASE_URL = ORIGINAL; });

function withUrl(url: string | undefined) {
  if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url;
}

describe('isP2ScratchDb', () => {
  it('accepts exactly the main P2 clone', () => {
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_scratch');
    expect(isP2ScratchDb()).toBe(true);
  });
  it.each([
    'postgres://u:p@127.0.0.1:5433/gc_curriculum',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_pre',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_p1_scratch',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_scratch_x',
    'postgres://u:p@127.0.0.1:5433/x_gc_curriculum_p2_scratch',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum?db=gc_curriculum_p2_scratch',
    'postgres://gc_curriculum_p2_scratch:p@127.0.0.1:5433/gc_curriculum',
    'not a url',
  ])('rejects %s', (url) => {
    withUrl(url);
    expect(isP2ScratchDb()).toBe(false);
  });
  it('rejects an unset DATABASE_URL', () => {
    withUrl(undefined);
    expect(isP2ScratchDb()).toBe(false);
  });
});

describe('isP2PreDb', () => {
  it('accepts exactly the pre clone and rejects the main clone', () => {
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_pre');
    expect(isP2PreDb()).toBe(true);
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_scratch');
    expect(isP2PreDb()).toBe(false);
  });
});
```

- [ ] **Step 3:** Run it. Expect FAIL (module not found): `pnpm vitest run tests/db/p2/scratch-guard.test.ts`.

- [ ] **Step 4: Write `tests/db/p2/scratch-guard.ts`:**

```ts
/**
 * P2 DB tests run ONLY against one of the two clones built by
 * scripts/migrations/p2-scratch-db.sh:
 *   - gc_curriculum_p2_scratch: the main scratch. Task 2 real-applies 0059
 *     to it, and later tasks develop against it.
 *   - gc_curriculum_p2_pre: kept pre-0059 forever, used only by the
 *     migration rehearsal test (tests/db/p2-migration.test.ts).
 * Nothing else is accepted: not live, not any older phase's clone.
 */
export const SCRATCH_DB = 'gc_curriculum_p2_scratch';
export const PRE_DB = 'gc_curriculum_p2_pre';

function dbNameIs(name: string): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${name}`;
  } catch {
    return false;
  }
}

export function isP2ScratchDb(): boolean {
  return dbNameIs(SCRATCH_DB);
}

export function isP2PreDb(): boolean {
  return dbNameIs(PRE_DB);
}
```

  Note: the query-string case passes because `pathname` excludes the query. The user-field case passes because `pathname` excludes userinfo.

- [ ] **Step 5:** Run the test. Expect PASS. Then red-proof it: temporarily change `dbNameIs` to `return (process.env.DATABASE_URL ?? '').includes(name)`, rerun, and confirm the suffix, prefix, query and user cases FAIL. Revert, and paste the red output into the report.

- [ ] **Step 6: Write `scripts/migrations/p2-scratch-db.sh`.** Copy `scripts/migrations/p1-scratch-db.sh` verbatim, then change:
  - the header comment: P1 → P2 and 0058 → 0059, and `tests/db/p1-migration.test.ts` → `tests/db/p2-migration.test.ts`;
  - `SCRATCH=gc_curriculum_p2_scratch` and `SCRATCH_PRE=gc_curriculum_p2_pre`;
  - add the allowlist check below and call it first in both `create_db` and `drop_db`:

```bash
p2_check_allowed_db_name() {
  case "$1" in
    gc_curriculum_p2_scratch|gc_curriculum_p2_pre) return 0 ;;
  esac
  echo "refusing: '$1' is not a P2 scratch database name; nothing touched" >&2
  exit 1
}

create_db() {
  local NAME="$1"
  p2_check_allowed_db_name "$NAME"
  # ... rest unchanged from p1-scratch-db.sh ...
}

drop_db() {
  local NAME="$1"
  p2_check_allowed_db_name "$NAME"
  # ... rest unchanged from p1-scratch-db.sh ...
}
```

  Then `chmod +x scripts/migrations/p2-scratch-db.sh`.

- [ ] **Step 7: Write `scripts/migrations/p2-backup.sh`.** Copy `scripts/migrations/p1-backup.sh` verbatim, then change:
  - the header: P1 → P2, 0058 → 0059;
  - `BACKUP_DIR="$HOME/.local/share/gc-curriculum-tool/p2"`;
  - `REQUIRED_TABLES=(sub_competencies career_target_requirements snapshot_competency_coverage career_target_occupations onet_element_ratings)`;
  - rename the function `p1_check_allowed_db_name` → `p2_check_allowed_db_name`, with the allowlist `gc_curriculum|gc_curriculum_p2_scratch|gc_curriculum_p2_pre` and the refusal message to match.

  Then `chmod +x`.

- [ ] **Step 8:** Create both clones, and confirm the main clone is post-P1:

```bash
scripts/migrations/p2-scratch-db.sh create
scripts/migrations/p2-scratch-db.sh create-pre
P=/Applications/Postgres.app/Contents/Versions/17/bin/psql
$P "$(scripts/migrations/p2-scratch-db.sh url)" -X -At -c "select (select count(*) from career_target_occupations), (select count(*) from onet_occupations), (select count(*) from onet_task_statements), (select count(*) from sub_competencies where origin='gc_authored'), to_regclass('public.bundle_members') is null"
```

  Expected: `266|91|1961|4|t`. If any number differs, record the actual values in the report; live may have changed since STATE.md was written. Do not "fix" live.

- [ ] **Step 9:** Run the backup script against scratch to prove it works:

```bash
DATABASE_URL="$(scripts/migrations/p2-scratch-db.sh url)" scripts/migrations/p2-backup.sh --expect-db gc_curriculum_p2_scratch
DATABASE_URL="$(scripts/migrations/p2-scratch-db.sh url)" scripts/migrations/p2-backup.sh --expect-db gc_curriculum_p1_scratch; echo "exit=$?"   # expect a refusal, exit 1
```

  Delete the scratch-test dump afterward, by its exact printed path.

- [ ] **Step 10: Commit.**

```bash
git add scripts/migrations/p2-scratch-db.sh scripts/migrations/p2-backup.sh tests/db/p2/
git commit -m "chore(p2): scratch clones, guard, verified backup script"
```

---

### Task 2: Migration 0059, verify, rollback, Drizzle schema

**Tier:** standard. The SQL and schema are complete below; the judgment is in running the rehearsal correctly.

**Files:**
- Create: `drizzle/0059_competency_catalog_p2.sql`, `scripts/migrations/2026-10-13-p2-verify.sql`, `scripts/migrations/2026-10-13-p2-rollback.sql`, `tests/db/p2-migration.test.ts`, `tests/db/p2-constraint-names.test.ts`
- Modify: `lib/db/schema.ts` (append after the `onetTaskRatings` table)

**Interfaces:**
- Produces these Drizzle exports, used by every later task: `bundleCards`, `itemEmbeddings`, `onetElementDefinitions`, `bundleMappingRuns`, `bundleMembers`, `bundleMappingOutcomes`, `bundleGoldenSamples`, `bundleGoldenPicks`.

- [ ] **Step 1: Write the failing rehearsal test** `tests/db/p2-migration.test.ts`. Structure and helpers are copied from `tests/db/p1-migration.test.ts` (`stripTxWrapper`, `stripVerifyWrapper`, a `Pool` from `pg`, each case in `BEGIN … ROLLBACK`), gated on `isP2PreDb()`. Cases:
  - **Static (always runs):** the three files exist.
  - Migration body, then **all 8 tables exist** (`to_regclass` for each name in `NEW_TABLES`).
  - Migration body run twice in one transaction raises `0059: already applied`.
  - Migration body on a database without `onet_release` raises `0059: precondition`. Simulate this by running `DROP TABLE onet_task_ratings, onet_task_statements, onet_element_ratings, onet_occupations, onet_release CASCADE` inside the rolled-back transaction first.
  - Migration body, then the verify body, completes without error.
  - Migration body, then the rollback body: `information_schema.tables` for the 8 names is empty, and the column list of every pre-existing table is unchanged. Compare a snapshot of `information_schema.columns` taken before and after.
  - Migration body, plus an inserted confirmed member, then the rollback body raises `rollback: precondition`.
  - **CHECK behavior:**
    - inserting `bundle_members` with `source='onet_task'` and `onet_soc_code IS NULL` fails;
    - inserting with `status='confirmed'` and `confirmed_by IS NULL` fails;
    - two element rows with identical (bundle, source, release, external_id) and both `onet_soc_code` NULL violate the unique constraint.

```ts
const NEW_TABLES = [
  'bundle_cards', 'item_embeddings', 'onet_element_definitions', 'bundle_mapping_runs',
  'bundle_members', 'bundle_mapping_outcomes', 'bundle_golden_samples', 'bundle_golden_picks',
] as const;
```

- [ ] **Step 2:** Run it with `DATABASE_URL="$(scripts/migrations/p2-scratch-db.sh url-pre)"`. Expect FAIL (files missing).

- [ ] **Step 3: Write `drizzle/0059_competency_catalog_p2.sql`:**

```sql
-- 0059_competency_catalog_p2.sql — P2: bundle membership (cards, embeddings cache,
-- O*NET element definitions, mapping runs/outcomes, members, blind golden sample).
-- Additive only: eight new tables, nothing altered or dropped. No existing
-- route or query reads these tables, so the running app is unaffected while
-- this applies. Plan: docs/superpowers/plans/2026-10-13-competency-catalog-p2.md
-- Spec: docs/superpowers/specs/2026-10-13-bundle-membership-p2-design.md
--
-- bundle_members deliberately has NO foreign key to any onet_* table:
-- scripts/onet/load-onet.ts reloads a release by deleting onet_occupations
-- (children cascade), and an FK here would silently wipe reviewed members.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF to_regclass('public.bundle_members') IS NOT NULL THEN
    RAISE EXCEPTION '0059: already applied';
  END IF;
  IF to_regclass('public.onet_release') IS NULL THEN
    RAISE EXCEPTION '0059: precondition — P1 (0058) is not applied';
  END IF;
END $$;

CREATE TABLE bundle_cards (
  competency_id text NOT NULL,
  stratum text NOT NULL,
  includes text NOT NULL,
  excludes text NOT NULL,
  distinctions text NOT NULL,
  positive_examples text[] NOT NULL,
  negative_examples text[] NOT NULL,
  status text NOT NULL,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_cards_pkey PRIMARY KEY (competency_id),
  CONSTRAINT bundle_cards_competency_id_fkey FOREIGN KEY (competency_id) REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_cards_stratum_check CHECK (stratum IN ('foundational', 'technical', 'business', 'workflow_ai')),
  CONSTRAINT bundle_cards_status_check CHECK (status IN ('draft', 'confirmed')),
  CONSTRAINT bundle_cards_confirmed_check CHECK ((status = 'confirmed') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE TABLE item_embeddings (
  kind text NOT NULL,
  ref text NOT NULL,
  model text NOT NULL,
  text_hash text NOT NULL,
  vector real[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_embeddings_pkey PRIMARY KEY (kind, ref, model, text_hash),
  CONSTRAINT item_embeddings_kind_check CHECK (kind IN ('bundle_card', 'onet_task', 'course_skill', 'esco_skill')),
  CONSTRAINT item_embeddings_vector_check CHECK (cardinality(vector) > 0)
);

CREATE TABLE onet_element_definitions (
  release text NOT NULL,
  domain text NOT NULL,
  element_id text NOT NULL,
  element_name text NOT NULL,
  description text NOT NULL,
  CONSTRAINT onet_element_definitions_pkey PRIMARY KEY (release, element_id),
  CONSTRAINT onet_element_definitions_release_fkey FOREIGN KEY (release) REFERENCES onet_release(release) ON DELETE CASCADE,
  CONSTRAINT onet_element_definitions_domain_check CHECK (domain IN ('knowledge', 'abilities', 'work_activities', 'essential_skills', 'transferable_skills'))
);

CREATE TABLE bundle_mapping_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  model text NOT NULL,
  prompt_version text NOT NULL,
  task_shortlist_k integer NOT NULL,
  bundle_count integer NOT NULL,
  cost_usd_cents integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT bundle_mapping_runs_pkey PRIMARY KEY (id),
  CONSTRAINT bundle_mapping_runs_k_check CHECK (task_shortlist_k > 0),
  CONSTRAINT bundle_mapping_runs_cost_check CHECK (cost_usd_cents >= 0)
);

CREATE TABLE bundle_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bundle_id text NOT NULL,
  source text NOT NULL,
  external_id text NOT NULL,
  external_label text NOT NULL,
  onet_soc_code text,
  release text,
  position text NOT NULL,
  ai_position text,
  status text NOT NULL,
  proposed_by text NOT NULL,
  rationale text,
  run_id uuid,
  confirmed_by text,
  confirmed_at timestamptz,
  bulk_confirmed boolean NOT NULL DEFAULT false,
  review_note text,
  centroid_distance real,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_members_pkey PRIMARY KEY (id),
  CONSTRAINT bundle_members_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_members_run_id_fkey FOREIGN KEY (run_id) REFERENCES bundle_mapping_runs(id) ON DELETE SET NULL,
  CONSTRAINT bundle_members_source_check CHECK (source IN ('onet_element', 'onet_task', 'course_skill', 'esco_skill')),
  CONSTRAINT bundle_members_position_check CHECK (position IN ('core', 'related', 'fringe')),
  CONSTRAINT bundle_members_ai_position_check CHECK (ai_position IS NULL OR ai_position IN ('core', 'related', 'fringe')),
  CONSTRAINT bundle_members_status_check CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  CONSTRAINT bundle_members_soc_check CHECK ((source = 'onet_task') = (onet_soc_code IS NOT NULL)),
  CONSTRAINT bundle_members_release_check CHECK ((source IN ('onet_element', 'onet_task')) = (release IS NOT NULL)),
  CONSTRAINT bundle_members_decision_check CHECK ((status = 'proposed') = (confirmed_by IS NULL AND confirmed_at IS NULL)),
  CONSTRAINT bundle_members_reviewer_added_check CHECK (proposed_by <> 'reviewer' OR (ai_position IS NULL AND status <> 'proposed')),
  CONSTRAINT bundle_members_item_key UNIQUE NULLS NOT DISTINCT (bundle_id, source, release, external_id, onet_soc_code)
);
CREATE INDEX idx_bundle_members_bundle_status ON bundle_members (bundle_id, status);

CREATE TABLE bundle_mapping_outcomes (
  run_id uuid NOT NULL,
  bundle_id text NOT NULL,
  status text NOT NULL,
  no_clean_match boolean NOT NULL,
  note text,
  cost_usd_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_mapping_outcomes_pkey PRIMARY KEY (run_id, bundle_id),
  CONSTRAINT bundle_mapping_outcomes_run_id_fkey FOREIGN KEY (run_id) REFERENCES bundle_mapping_runs(id) ON DELETE CASCADE,
  CONSTRAINT bundle_mapping_outcomes_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_mapping_outcomes_status_check CHECK (status IN ('ok', 'failed')),
  CONSTRAINT bundle_mapping_outcomes_failed_check CHECK (status = 'ok' OR no_clean_match = false)
);

CREATE TABLE bundle_golden_samples (
  bundle_id text NOT NULL,
  stratum text NOT NULL,
  sample_seed text NOT NULL,
  candidates jsonb NOT NULL,
  reviewer text,
  submitted_at timestamptz,
  reset_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_golden_samples_pkey PRIMARY KEY (bundle_id),
  CONSTRAINT bundle_golden_samples_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_golden_samples_stratum_check CHECK (stratum IN ('foundational', 'technical', 'business', 'workflow_ai')),
  CONSTRAINT bundle_golden_samples_submitted_check CHECK (submitted_at IS NULL OR reviewer IS NOT NULL)
);

CREATE TABLE bundle_golden_picks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bundle_id text NOT NULL,
  reviewer text NOT NULL,
  source text,
  external_id text,
  onet_soc_code text,
  release text,
  position text,
  no_clean_match boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_golden_picks_pkey PRIMARY KEY (id),
  CONSTRAINT bundle_golden_picks_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES bundle_golden_samples(bundle_id) ON DELETE CASCADE,
  CONSTRAINT bundle_golden_picks_source_check CHECK (source IS NULL OR source IN ('onet_element', 'onet_task')),
  CONSTRAINT bundle_golden_picks_position_check CHECK (position IS NULL OR position IN ('core', 'related', 'fringe')),
  CONSTRAINT bundle_golden_picks_shape_check CHECK (
    (no_clean_match AND source IS NULL AND external_id IS NULL AND position IS NULL AND onet_soc_code IS NULL AND release IS NULL)
    OR (NOT no_clean_match AND source IS NOT NULL AND external_id IS NOT NULL AND position IS NOT NULL AND release IS NOT NULL
        AND (source = 'onet_task') = (onet_soc_code IS NOT NULL))
  ),
  CONSTRAINT bundle_golden_picks_item_key UNIQUE NULLS NOT DISTINCT (bundle_id, reviewer, source, external_id, onet_soc_code)
);

COMMIT;
```

- [ ] **Step 4: Write `scripts/migrations/2026-10-13-p2-verify.sql`,** in the same style as `2026-10-12-p1-verify.sql`:
  - `\set ON_ERROR_STOP on` then `BEGIN READ ONLY;`;
  - a printed `item | value` block;
  - a `DO` block that raises on the first failure;
  - `ROLLBACK;` at the end.

  Checks:
  - each of the 8 tables exists;
  - each of these constraint names exists in `pg_constraint`;
  - `bundle_members` has zero rows, and so do `bundle_cards` and `bundle_golden_samples` (only meaningful immediately after the apply; say so in a comment, as P1's verify does);
  - no FK from `bundle_members` to any `onet_*` table. Query `pg_constraint` where `conrelid = 'bundle_members'::regclass AND contype = 'f' AND confrelid::regclass::text LIKE 'onet_%'`; expect 0.

```sql
-- expected constraint names (copy into both the printed block and the DO block)
ARRAY[
 'bundle_cards_pkey','bundle_cards_competency_id_fkey','bundle_cards_stratum_check','bundle_cards_status_check','bundle_cards_confirmed_check',
 'item_embeddings_pkey','item_embeddings_kind_check','item_embeddings_vector_check',
 'onet_element_definitions_pkey','onet_element_definitions_release_fkey','onet_element_definitions_domain_check',
 'bundle_mapping_runs_pkey','bundle_mapping_runs_k_check','bundle_mapping_runs_cost_check',
 'bundle_members_pkey','bundle_members_bundle_id_fkey','bundle_members_run_id_fkey','bundle_members_source_check',
 'bundle_members_position_check','bundle_members_ai_position_check','bundle_members_status_check','bundle_members_soc_check',
 'bundle_members_release_check','bundle_members_decision_check','bundle_members_reviewer_added_check','bundle_members_item_key',
 'bundle_mapping_outcomes_pkey','bundle_mapping_outcomes_run_id_fkey','bundle_mapping_outcomes_bundle_id_fkey',
 'bundle_mapping_outcomes_status_check','bundle_mapping_outcomes_failed_check',
 'bundle_golden_samples_pkey','bundle_golden_samples_bundle_id_fkey','bundle_golden_samples_stratum_check','bundle_golden_samples_submitted_check',
 'bundle_golden_picks_pkey','bundle_golden_picks_bundle_id_fkey','bundle_golden_picks_source_check','bundle_golden_picks_position_check',
 'bundle_golden_picks_shape_check','bundle_golden_picks_item_key'
]
```

- [ ] **Step 5: Write `scripts/migrations/2026-10-13-p2-rollback.sql`:**

```sql
-- Rollback of migration 0059 (competency catalog P2: bundle membership).
-- Purely subtractive: drops the eight P2 tables. One transaction.
-- Not re-runnable: a second run stops at "rollback: 0059 is not applied".
-- App-code order: revert the app to its pre-P2 build FIRST (the P2 build's
-- /admin/bundles and /api/admin/bundles/* read these tables), then run this
-- file, then redeploy.
-- Refuses while human review work exists (Ruling 14): export or delete
-- confirmed/rejected members and golden picks on purpose first.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF to_regclass('public.bundle_members') IS NULL THEN
    RAISE EXCEPTION 'rollback: 0059 is not applied';
  END IF;
END $$;

DO $$
DECLARE n_reviewed int; n_picks int;
BEGIN
  SELECT count(*) INTO n_reviewed FROM bundle_members WHERE status <> 'proposed';
  SELECT count(*) INTO n_picks FROM bundle_golden_picks;
  IF n_reviewed <> 0 OR n_picks <> 0 THEN
    RAISE EXCEPTION 'rollback: precondition — % reviewed member(s) and % golden pick(s) exist; export or delete them on purpose first', n_reviewed, n_picks;
  END IF;
END $$;

DROP TABLE IF EXISTS bundle_golden_picks;
DROP TABLE IF EXISTS bundle_golden_samples;
DROP TABLE IF EXISTS bundle_mapping_outcomes;
DROP TABLE IF EXISTS bundle_members;
DROP TABLE IF EXISTS bundle_mapping_runs;
DROP TABLE IF EXISTS onet_element_definitions;
DROP TABLE IF EXISTS item_embeddings;
DROP TABLE IF EXISTS bundle_cards;

COMMIT;
```

- [ ] **Step 6: Append the Drizzle schema** to `lib/db/schema.ts`, after `onetTaskRatings`. `onetRelease` and `subCompetencies` are already defined above; reuse them.

```ts
// ─── P2 (migration 0059): bundle membership ────────────────────────────────
// Every constraint name below matches 0059's hand-written SQL exactly
// (pinned by tests/db/p2-constraint-names.test.ts). bundle_members has NO
// FK to onet_* on purpose: load-onet.ts reloads a release by deleting
// onet_occupations (children cascade), which would wipe reviewed members.

export type BundleStratum = 'foundational' | 'technical' | 'business' | 'workflow_ai';
export type BundlePosition = 'core' | 'related' | 'fringe';
export type BundleMemberStatus = 'proposed' | 'confirmed' | 'rejected';
export type BundleMemberSource = 'onet_element' | 'onet_task' | 'course_skill' | 'esco_skill';

export interface GoldenCandidate {
  key: string;            // taskGroupKey (Ruling 5)
  label: string;          // task text
  rank: number;           // 1-based cosine rank
  score: number;          // cosine similarity
  members: Array<{ taskId: string; onetSocCode: string }>;
}

export const bundleCards = pgTable('bundle_cards', {
  competencyId: text('competency_id').notNull(),
  stratum: text('stratum').$type<BundleStratum>().notNull(),
  includes: text('includes').notNull(),
  excludes: text('excludes').notNull(),
  distinctions: text('distinctions').notNull(),
  positiveExamples: text('positive_examples').array().notNull(),
  negativeExamples: text('negative_examples').array().notNull(),
  status: text('status').$type<'draft' | 'confirmed'>().notNull(),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_cards_pkey', columns: [t.competencyId] }),
  foreignKey({ name: 'bundle_cards_competency_id_fkey', columns: [t.competencyId], foreignColumns: [subCompetencies.id] }).onDelete('restrict'),
  check('bundle_cards_stratum_check', sql`${t.stratum} IN ('foundational', 'technical', 'business', 'workflow_ai')`),
  check('bundle_cards_status_check', sql`${t.status} IN ('draft', 'confirmed')`),
  check('bundle_cards_confirmed_check', sql`(${t.status} = 'confirmed') = (${t.confirmedBy} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`),
]);

export const itemEmbeddings = pgTable('item_embeddings', {
  kind: text('kind').$type<'bundle_card' | 'onet_task' | 'course_skill' | 'esco_skill'>().notNull(),
  ref: text('ref').notNull(),
  model: text('model').notNull(),
  textHash: text('text_hash').notNull(),
  vector: real('vector').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'item_embeddings_pkey', columns: [t.kind, t.ref, t.model, t.textHash] }),
  check('item_embeddings_kind_check', sql`${t.kind} IN ('bundle_card', 'onet_task', 'course_skill', 'esco_skill')`),
  check('item_embeddings_vector_check', sql`cardinality(${t.vector}) > 0`),
]);

export const onetElementDefinitions = pgTable('onet_element_definitions', {
  release: text('release').notNull(),
  domain: text('domain').notNull(),
  elementId: text('element_id').notNull(),
  elementName: text('element_name').notNull(),
  description: text('description').notNull(),
}, (t) => [
  primaryKey({ name: 'onet_element_definitions_pkey', columns: [t.release, t.elementId] }),
  foreignKey({ name: 'onet_element_definitions_release_fkey', columns: [t.release], foreignColumns: [onetRelease.release] }).onDelete('cascade'),
  check('onet_element_definitions_domain_check', sql`${t.domain} IN ('knowledge', 'abilities', 'work_activities', 'essential_skills', 'transferable_skills')`),
]);

export const bundleMappingRuns = pgTable('bundle_mapping_runs', {
  id: uuid('id').defaultRandom().notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  taskShortlistK: integer('task_shortlist_k').notNull(),
  bundleCount: integer('bundle_count').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull().default(0),
  dryRun: boolean('dry_run').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ name: 'bundle_mapping_runs_pkey', columns: [t.id] }),
  check('bundle_mapping_runs_k_check', sql`${t.taskShortlistK} > 0`),
  check('bundle_mapping_runs_cost_check', sql`${t.costUsdCents} >= 0`),
]);

export const bundleMembers = pgTable('bundle_members', {
  id: uuid('id').defaultRandom().notNull(),
  bundleId: text('bundle_id').notNull(),
  source: text('source').$type<BundleMemberSource>().notNull(),
  externalId: text('external_id').notNull(),
  externalLabel: text('external_label').notNull(),
  onetSocCode: text('onet_soc_code'),
  release: text('release'),
  position: text('position').$type<BundlePosition>().notNull(),
  aiPosition: text('ai_position').$type<BundlePosition>(),
  status: text('status').$type<BundleMemberStatus>().notNull(),
  proposedBy: text('proposed_by').notNull(),
  rationale: text('rationale'),
  runId: uuid('run_id'),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  bulkConfirmed: boolean('bulk_confirmed').notNull().default(false),
  reviewNote: text('review_note'),
  centroidDistance: real('centroid_distance'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_members_pkey', columns: [t.id] }),
  foreignKey({ name: 'bundle_members_bundle_id_fkey', columns: [t.bundleId], foreignColumns: [subCompetencies.id] }).onDelete('restrict'),
  foreignKey({ name: 'bundle_members_run_id_fkey', columns: [t.runId], foreignColumns: [bundleMappingRuns.id] }).onDelete('set null'),
  check('bundle_members_source_check', sql`${t.source} IN ('onet_element', 'onet_task', 'course_skill', 'esco_skill')`),
  check('bundle_members_position_check', sql`${t.position} IN ('core', 'related', 'fringe')`),
  check('bundle_members_ai_position_check', sql`${t.aiPosition} IS NULL OR ${t.aiPosition} IN ('core', 'related', 'fringe')`),
  check('bundle_members_status_check', sql`${t.status} IN ('proposed', 'confirmed', 'rejected')`),
  check('bundle_members_soc_check', sql`(${t.source} = 'onet_task') = (${t.onetSocCode} IS NOT NULL)`),
  check('bundle_members_release_check', sql`(${t.source} IN ('onet_element', 'onet_task')) = (${t.release} IS NOT NULL)`),
  check('bundle_members_decision_check', sql`(${t.status} = 'proposed') = (${t.confirmedBy} IS NULL AND ${t.confirmedAt} IS NULL)`),
  check('bundle_members_reviewer_added_check', sql`${t.proposedBy} <> 'reviewer' OR (${t.aiPosition} IS NULL AND ${t.status} <> 'proposed')`),
  unique('bundle_members_item_key').on(t.bundleId, t.source, t.release, t.externalId, t.onetSocCode).nullsNotDistinct(),
  index('idx_bundle_members_bundle_status').on(t.bundleId, t.status),
]);

export const bundleMappingOutcomes = pgTable('bundle_mapping_outcomes', {
  runId: uuid('run_id').notNull(),
  bundleId: text('bundle_id').notNull(),
  status: text('status').$type<'ok' | 'failed'>().notNull(),
  noCleanMatch: boolean('no_clean_match').notNull(),
  note: text('note'),
  costUsdCents: integer('cost_usd_cents').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_mapping_outcomes_pkey', columns: [t.runId, t.bundleId] }),
  foreignKey({ name: 'bundle_mapping_outcomes_run_id_fkey', columns: [t.runId], foreignColumns: [bundleMappingRuns.id] }).onDelete('cascade'),
  foreignKey({ name: 'bundle_mapping_outcomes_bundle_id_fkey', columns: [t.bundleId], foreignColumns: [subCompetencies.id] }).onDelete('restrict'),
  check('bundle_mapping_outcomes_status_check', sql`${t.status} IN ('ok', 'failed')`),
  check('bundle_mapping_outcomes_failed_check', sql`${t.status} = 'ok' OR ${t.noCleanMatch} = false`),
]);

export const bundleGoldenSamples = pgTable('bundle_golden_samples', {
  bundleId: text('bundle_id').notNull(),
  stratum: text('stratum').$type<BundleStratum>().notNull(),
  sampleSeed: text('sample_seed').notNull(),
  candidates: jsonb('candidates').$type<GoldenCandidate[]>().notNull(),
  reviewer: text('reviewer'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  resetNote: text('reset_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_golden_samples_pkey', columns: [t.bundleId] }),
  foreignKey({ name: 'bundle_golden_samples_bundle_id_fkey', columns: [t.bundleId], foreignColumns: [subCompetencies.id] }).onDelete('restrict'),
  check('bundle_golden_samples_stratum_check', sql`${t.stratum} IN ('foundational', 'technical', 'business', 'workflow_ai')`),
  check('bundle_golden_samples_submitted_check', sql`${t.submittedAt} IS NULL OR ${t.reviewer} IS NOT NULL`),
]);

export const bundleGoldenPicks = pgTable('bundle_golden_picks', {
  id: uuid('id').defaultRandom().notNull(),
  bundleId: text('bundle_id').notNull(),
  reviewer: text('reviewer').notNull(),
  source: text('source').$type<'onet_element' | 'onet_task'>(),
  externalId: text('external_id'),
  onetSocCode: text('onet_soc_code'),
  release: text('release'),
  position: text('position').$type<BundlePosition>(),
  noCleanMatch: boolean('no_clean_match').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_golden_picks_pkey', columns: [t.id] }),
  foreignKey({ name: 'bundle_golden_picks_bundle_id_fkey', columns: [t.bundleId], foreignColumns: [bundleGoldenSamples.bundleId] }).onDelete('cascade'),
  check('bundle_golden_picks_source_check', sql`${t.source} IS NULL OR ${t.source} IN ('onet_element', 'onet_task')`),
  check('bundle_golden_picks_position_check', sql`${t.position} IS NULL OR ${t.position} IN ('core', 'related', 'fringe')`),
  check('bundle_golden_picks_shape_check', sql`(${t.noCleanMatch} AND ${t.source} IS NULL AND ${t.externalId} IS NULL AND ${t.position} IS NULL AND ${t.onetSocCode} IS NULL AND ${t.release} IS NULL) OR (NOT ${t.noCleanMatch} AND ${t.source} IS NOT NULL AND ${t.externalId} IS NOT NULL AND ${t.position} IS NOT NULL AND ${t.release} IS NOT NULL AND (${t.source} = 'onet_task') = (${t.onetSocCode} IS NOT NULL))`),
  unique('bundle_golden_picks_item_key').on(t.bundleId, t.reviewer, t.source, t.externalId, t.onetSocCode).nullsNotDistinct(),
]);
```

  If `uuid`, `jsonb`, `primaryKey`, `unique`, `index`, `foreignKey`, `check`, `real`, `integer`, `boolean` or `timestamp` are missing from the `drizzle-orm/pg-core` import at the top of `lib/db/schema.ts`, add them. (On 2026-10-13 all were already imported.)

- [ ] **Step 7: Write the constraint-name drift test** `tests/db/p2-constraint-names.test.ts`, gated `isP2ScratchDb()`. It runs after Step 9's real apply. It reads `pg_constraint.conname` for the 8 tables and asserts that the set equals the Step 4 array exactly, with no extras and none missing. Model it on `tests/db/p1-constraint-names.test.ts`.

- [ ] **Step 8:** Run `tests/db/p2-migration.test.ts` against the pre clone. Expect PASS. Then:
  - `pnpm exec tsc --noEmit -p .`;
  - the full suite with `DATABASE_URL` unset (all DB suites skip): `env -u DATABASE_URL pnpm vitest run`.

- [ ] **Step 9:** Real-apply to the main scratch (allowed on scratch only), verify, and run the drift test:

```bash
P=/Applications/Postgres.app/Contents/Versions/17/bin/psql
S="$(scripts/migrations/p2-scratch-db.sh url)"
$P "$S" -X -v ON_ERROR_STOP=1 -f drizzle/0059_competency_catalog_p2.sql
$P "$S" -X -v ON_ERROR_STOP=1 -f scripts/migrations/2026-10-13-p2-verify.sql
DATABASE_URL="$S" pnpm vitest run tests/db/p2-constraint-names.test.ts
```

- [ ] **Step 10: Commit,** with a STATE.md Schema entry saying "0059 built, NOT applied live":

```bash
git add drizzle/0059_competency_catalog_p2.sql scripts/migrations/2026-10-13-p2-*.sql lib/db/schema.ts tests/db/p2-migration.test.ts tests/db/p2-constraint-names.test.ts docs/STATE.md
git commit -m "feat(db): migration 0059 — bundle membership tables (additive)"
```

---

### Task 3: O*NET element definitions in the loader

**Tier:** cheap (complete code below).

**Files:**
- Modify: `lib/onet/load.ts`, `scripts/onet/load-onet.ts`
- Create: `tests/fixtures/onet/content_model_reference.csv`, `tests/lib/onet/content-model.test.ts`, `tests/db/p2-element-definitions.test.ts`

**Interfaces:**
- Consumes: `onetElementDefinitions` (Task 2), `LoadedData` / `readAndFilter` / `writeOnetStore` (existing, `scripts/onet/load-onet.ts`).
- Produces:
  - `parseContentModelReferenceCsv(content: string, fileLabel: string): { rows: Array<{ elementId: string; elementName: string; description: string }> }`;
  - `LoadedData.elementDefinitions: Array<{ domain: Domain; elementId: string; elementName: string; description: string }>`;
  - `writeOnetStore` now also replaces `onet_element_definitions` for the release.

- [ ] **Step 1: Create the fixture** `tests/fixtures/onet/content_model_reference.csv`. The ids match the existing fixtures; the descriptions are synthetic.

```csv
Element ID,Element Name,Description
2.C.1.a,Administration and Management,Synthetic definition A.
2.C.2.a,Economics and Accounting,Synthetic definition B.
2.C.3.a,Sales and Marketing,Synthetic definition C.
1.A.1.a.1,Oral Comprehension,Synthetic definition D.
1.A.1.b.2,Written Expression,Synthetic definition E.
4.A.1.a.1,Getting Information,Synthetic definition F.
2.A.1.a,Reading Comprehension,Synthetic definition G.
2.B.1.a,Social Perceptiveness,Synthetic definition H.
9.Z.9,Unused Element,Synthetic definition not referenced by any rating.
```

- [ ] **Step 2: Write a failing unit test** `tests/lib/onet/content-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseContentModelReferenceCsv } from '@/lib/onet/load';

const FIX = path.join(process.cwd(), 'tests/fixtures/onet');

describe('parseContentModelReferenceCsv', () => {
  it('parses id, name, description', () => {
    const { rows } = parseContentModelReferenceCsv(readFileSync(path.join(FIX, 'content_model_reference.csv'), 'utf8'), 'content_model_reference.csv');
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual({ elementId: '2.C.1.a', elementName: 'Administration and Management', description: 'Synthetic definition A.' });
  });
  it('fails loudly on a renamed column', () => {
    expect(() => parseContentModelReferenceCsv('Element ID,Name,Description\n1,x,y\n', 'cmr.csv'))
      .toThrow(/cmr\.csv: missing or renamed column "Element Name"/);
  });
});
```

- [ ] **Step 3:** Run it. Expect FAIL (function not exported).

- [ ] **Step 4: Implement** in `lib/onet/load.ts`, next to the other header constants and parsers:

```ts
const CONTENT_MODEL_HEADER = ['Element ID', 'Element Name', 'Description'] as const;

export interface RawElementDefinition {
  elementId: string;
  elementName: string;
  description: string;
}

/** O*NET Content Model Reference (content_model_reference.csv): one row per content-model element. */
export function parseContentModelReferenceCsv(content: string, fileLabel: string): { rows: RawElementDefinition[] } {
  const records = parseRecords(content, fileLabel, CONTENT_MODEL_HEADER);
  return {
    rows: records.map(r => ({
      elementId: (r['Element ID'] ?? '').trim(),
      elementName: (r['Element Name'] ?? '').trim(),
      description: (r['Description'] ?? '').trim(),
    })),
  };
}
```

  Run the test. Expect PASS.

- [ ] **Step 5: Extend `scripts/onet/load-onet.ts`.**
  - Add `elementDefinitions` to `LoadedData`:

```ts
export interface LoadedData {
  occupations: RawOccupation[];
  elementRatings: RawElementRating[];
  elementDefinitions: Array<{ domain: Domain; elementId: string; elementName: string; description: string }>;
  taskStatements: RawTaskStatement[];
  taskRatings: RawTaskRating[];
  skippedElementScaleCount: number;
  skippedTaskRatingScaleCount: number;
}
```

  - At the end of `readAndFilter`, after `elementRatings` is built:

```ts
  // P2: one definition per element that appears in the filtered ratings,
  // domain taken from those ratings. A rated element with no definition row
  // is a hard error (the 31.0 release has all 161; a gap means drift).
  const domainByElement = new Map<string, Domain>();
  for (const r of elementRatings) domainByElement.set(r.elementId, r.domain);
  const cmr = parseContentModelReferenceCsv(readFileSync(path.join(dir, 'content_model_reference.csv'), 'utf8'), 'content_model_reference.csv').rows;
  const defById = new Map(cmr.map(d => [d.elementId, d]));
  const elementDefinitions = [...domainByElement.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([elementId, domain]) => {
    const d = defById.get(elementId);
    if (!d) throw new Error(`onet/load: content_model_reference.csv: no definition for rated element ${elementId}`);
    return { domain, elementId, elementName: d.elementName, description: d.description };
  });
```

  Include `elementDefinitions` in the returned object. Import `parseContentModelReferenceCsv` and `type Domain` from `@/lib/onet/load`, and `onetElementDefinitions` from `@/lib/db/schema`.

  - In `writeOnetStore`, after the `onetRelease` upsert and before the `onetOccupations` delete:

```ts
  await executor.delete(onetElementDefinitions).where(eq(onetElementDefinitions.release, release));
  for (const batch of chunk(data.elementDefinitions, INSERT_CHUNK_SIZE)) {
    await executor.insert(onetElementDefinitions).values(
      batch.map(d => ({ release, domain: d.domain, elementId: d.elementId, elementName: d.elementName, description: d.description })),
    );
  }
```

  This must stay ahead of the `if (data.occupations.length === 0) return;` early exit.

  - In `printReport`, add `console.log(\`element definitions: ${data.elementDefinitions.length}\`);`.
  - Update the header comment: definitions are loaded too, and need 0059.

- [ ] **Step 6: Write the DB test** `tests/db/p2-element-definitions.test.ts`, gated `isP2ScratchDb()`, every write in a rolled-back transaction (copy `inRolledBackTx` from `tests/db/p1-onet-load.test.ts`). Use a synthetic release `'test-p2'` with synthetic metadata, as P1's test does. Check that:
  - `readAndFilter(FIXTURES_DIR, new Set(['99-0001.00','99-0002.00']))` returns `elementDefinitions` for exactly the element ids present in those codes' fixture ratings, and that `9.Z.9` is absent;
  - `writeOnetStore(tx, 'test-p2', data, meta)` inserts those rows, and a second call leaves the same count (idempotent);
  - with a definition row deleted from an in-memory copy of the CSV, `readAndFilter` throws `no definition for rated element`. Do this by pointing at a temporary directory that copies the fixtures with one definition line removed; clean the directory up afterward.

  Also update `tests/db/p1-onet-load.test.ts` only if it constructs `LoadedData` literals: add `elementDefinitions: []` there so it typechecks. Change nothing else in P1 tests.

- [ ] **Step 7:** Run it against the main scratch. Expect PASS. Then do the real load on scratch, which rewrites the whole O*NET store idempotently:

```bash
S="$(scripts/migrations/p2-scratch-db.sh url)"
T="node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs"
DATABASE_URL="$S" $T scripts/onet/load-onet.ts --dir /Users/admin/projects/curriculum_developer/scratch/onet/31.0 --release 31.0 --expect-db gc_curriculum_p2_scratch
DATABASE_URL="$S" $T scripts/onet/load-onet.ts --dir /Users/admin/projects/curriculum_developer/scratch/onet/31.0 --release 31.0 --expect-db gc_curriculum_p2_scratch --apply
/Applications/Postgres.app/Contents/Versions/17/bin/psql "$S" -X -At -c "select count(*), count(distinct domain) from onet_element_definitions where release='31.0'"
```

  Expected: 161 definitions across 5 domains (161 distinct elements across the five rating files was verified on 2026-10-13 from the held CSVs). The element-rating, task-statement and task-rating counts must equal the pre-load counts from Task 1 Step 8: 1961 task statements, 91 occupations. Record all counts in the report.

- [ ] **Step 8: Commit:** `feat(onet): load element definitions (content model reference) into the 31.0 store`.

---

### Task 4: AI plumbing: function ids, prompts, cost estimate

**Tier:** standard.

**Files:**
- Modify: `lib/ai/function-settings.ts`, `lib/ai/prompts/load.ts`, `lib/ai/openai.ts`
- Create: `lib/ai/prompts/bundle-card-draft.md`, `lib/ai/prompts/bundle-map-onet.md`, `lib/ai/__tests__/estimate-cost.test.ts`

**Interfaces:**
- Produces:
  - `AIFunctionId` includes `'bundle-card-draft'` and `'bundle-map-onet'`;
  - `PromptName` includes both;
  - `estimateCostCents(model: string, promptTokens: number, completionTokens: number): number` (1/100-cent units, using the same `MODEL_PRICING`/`FALLBACK_PRICING`/`toCents` as `complete()`, with no cache discount);
  - `BUNDLE_CARD_PROMPT_VERSION = 'bundle-card-draft@1'` and `BUNDLE_MAP_PROMPT_VERSION = 'bundle-map-onet@1'` are exported from the Task 5 and Task 8 modules respectively, not from here.

- [ ] **Step 1: Write a failing test** `lib/ai/__tests__/estimate-cost.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { estimateCostCents } from '@/lib/ai/openai';

describe('estimateCostCents', () => {
  it('prices a known model in 1/100-cent units', () => {
    // gpt-6.1-sol: $2.00 / 1M in, $10.00 / 1M out → 10k in = $0.02 = 200 units; 1k out = $0.01 = 100 units
    expect(estimateCostCents('gpt-6.1-sol', 10_000, 1_000)).toBe(300);
  });
  it('falls back to workhorse pricing for an unknown model', () => {
    // FALLBACK $2.50 / $15.00 → 10k in = 250, 1k out = 150
    expect(estimateCostCents('unknown-model', 10_000, 1_000)).toBe(400);
  });
});
```

- [ ] **Step 2:** Run it. Expect FAIL.

- [ ] **Step 3: Implement** in `lib/ai/openai.ts`, below `toCents`:

```ts
/** Pre-call cost estimate (dry runs, --max-cost guards). Same table and
 * rounding as complete(); no prefix-cache discount, so it errs high. */
export function estimateCostCents(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  return toCents((promptTokens / 1_000_000) * pricing.input) + toCents((completionTokens / 1_000_000) * pricing.output);
}
```

  Run the test. Expect PASS.

- [ ] **Step 4: Register both functions** in `lib/ai/function-settings.ts`:
  - Append `'bundle-card-draft'` and `'bundle-map-onet'` to `AI_FUNCTION_IDS`.
  - In `DEFAULT_TIERS`, add these with their comments:

```ts
  // P2: one call per catalog bundle, drafting its card (includes/excludes,
  // distinctions, examples, stratum) for owner approval. Default tier:
  // bounded writing against the full catalog for contrast.
  'bundle-card-draft': 'default',
  // P2: one call per bundle placing every O*NET element (with definitions)
  // and a 25-task embedding shortlist at core/related/fringe. Heavy tier:
  // the placements feed P3 weights once confirmed, and the blind golden
  // sample measures exactly this judgment.
  'bundle-map-onet': 'heavy',
```

  - In `FUNCTION_LABELS`: `'bundle-card-draft': 'Bundle card drafting'`, `'bundle-map-onet': 'Bundle placement (O*NET)'`.
  - In `FUNCTION_DESCRIPTIONS`:
    - `'bundle-card-draft'`: "Drafting each catalog bundle's card (what it includes and excludes, how it differs from neighbors, examples) for owner approval."
    - `'bundle-map-onet'`: "Placing O*NET elements and task statements into catalog bundles as core, related or fringe members, for review on /admin/bundles."

- [ ] **Step 5:** Add `| 'bundle-card-draft'` and `| 'bundle-map-onet'` to `PromptName` in `lib/ai/prompts/load.ts`.

- [ ] **Step 6: Write `lib/ai/prompts/bundle-card-draft.md`:**

```markdown
---
name: bundle-card-draft
---

# Role

You write the card for one skill bundle in the Clemson Graphic Communications competency catalog. A bundle is a named competency with Know, Understand and Do descriptors. Fine-grained items (O*NET elements and task statements now; skills from courses and job positions later) will be placed into bundles as core, related or fringe members, using this card as the bundle's definition. Faculty will read the card to judge those placements.

# What to write

- **includes**: two to four sentences on what this bundle covers, in plain US English, concrete to graphic communications work (print, packaging, brand, production, workflow technology).
- **excludes**: one to three sentences naming nearby things this bundle does NOT cover, and which bundle in the catalog covers each instead (name it by its id).
- **distinctions**: one to three sentences on how this bundle differs from its two or three closest neighbors in the catalog list you are given.
- **positive_examples**: two or three short examples of a fine-grained skill or task that clearly belongs here (core).
- **negative_examples**: two or three short examples that sound close but belong elsewhere, each ending with "(belongs in <bundle id>)".
- **stratum**: exactly one of `foundational` (habits of work such as agency, attention to detail, communication), `technical` (production, color, prepress, packaging, design craft), `business` (clients, money, contracts, negotiation, management), `workflow_ai` (workflow automation, systems, AI tools).

# Rules

- Use only the bundle's own descriptors and the catalog list you are given. Do not invent requirements, courses or employers.
- Keep the card faithful to the descriptors: the card clarifies boundaries, it does not widen or narrow the bundle.
- US spelling. No marketing language.
- Every field is required.
```

- [ ] **Step 7: Write `lib/ai/prompts/bundle-map-onet.md`:**

```markdown
---
name: bundle-map-onet
---

# Role

You place O*NET items into one skill bundle of the Clemson Graphic Communications competency catalog. You are given the bundle's card (name, Know/Understand/Do descriptors, includes, excludes, distinctions, examples), every O*NET element with its definition (grouped by domain), and up to 25 O*NET task statements shortlisted by embedding similarity. Your placements are proposals: a faculty reviewer confirms or rejects each one, and nothing is used before confirmation.

# Positions

- **core**: the item is central to what this bundle is. Someone strong in this bundle is strong at this item, and the item would appear in the bundle's own definition.
- **related**: the item draws substantially on this bundle but also depends on other things.
- **fringe**: the item touches this bundle only partly or occasionally.
- An item that does not belong at all is simply not listed.

# How to decide

- Judge by capability, not by shared words. A task that mentions "color" belongs in a color bundle only if doing it requires that bundle's capability.
- Respect the card's excludes and distinctions: an item the card assigns elsewhere is not placed here, unless it also clearly draws on this bundle (then at most related).
- Elements are broad; place an element only when the bundle is a substantial part of it. Most bundles have few core elements.
- Prefer fewer, well-justified placements over many weak ones.
- If nothing is better than fringe, say so in `note` (one sentence on what O*NET lacks for this bundle); otherwise `note` may be null.

# Output

- `placements`: one entry per placed item, `item_id` copied exactly from the input (element ids look like `E:2.C.1.a`; task ids look like `T7`), `position`, and a one-sentence `rationale` a faculty reviewer can agree or disagree with.
- Never list an item id that is not in the input. Never list an item twice.
```

- [ ] **Step 8:** Run `tsc`, the estimate test, and the existing function-settings and prompt-loader tests:

```bash
pnpm vitest run lib/ai/__tests__/estimate-cost.test.ts lib/ai/prompts/__tests__ lib/ai/__tests__
```

  If an existing test pins the length of `AI_FUNCTION_IDS` or snapshots the label map, update that expectation and record the change in the report.

- [ ] **Step 9: Commit:** `feat(ai): register bundle-card-draft and bundle-map-onet; estimateCostCents`.

---

### Task 5: Bundle cards: pure helpers, draft call, draft/apply script

**Tier:** standard.

**Files:**
- Create: `lib/catalog/bundles.ts` (partial: card types and `cardEmbedText`, `textHash`, `parseCardsReviewFile`), `lib/ai/catalog/draft-bundle-card.ts`, `scripts/catalog/draft-bundle-cards.ts`, `lib/db/bundle-queries.ts` (partial: `listActiveBundles`, `readConfirmedCards`, `upsertConfirmedCards`), `tests/lib/catalog/bundles.test.ts`, `lib/ai/catalog/__tests__/draft-bundle-card.test.ts`, `tests/db/p2-cards.test.ts`

**Interfaces:**
- Consumes: `bundleCards` and `subCompetencies` (schema); `getProviderForFunction`, `loadPrompt`, `estimateCostCents`; `checkDailyCap` and `recordSpend`; `loadAppEnv`, `isMainModule`, `formatDbError`, `assertExpectedDb` (from `scripts/catalog/catalog-source.ts`); `Tx` (from `lib/db/competency-catalog-queries.ts`).
- Produces (in `lib/catalog/bundles.ts`):

```ts
export const STRATA = ['foundational', 'technical', 'business', 'workflow_ai'] as const;
export interface BundleSummary { id: string; name: string; knowDescriptor: string; understandDescriptor: string; doDescriptor: string; origin: string }
export interface CardFields { stratum: BundleStratum; includes: string; excludes: string; distinctions: string; positiveExamples: string[]; negativeExamples: string[] }
export interface ReviewCard extends CardFields { competencyId: string; name: string }
export interface CardsReviewFile { _approval: string; drafted: { model: string; promptVersion: string; at: string; costUsdCents: number }; cards: ReviewCard[] }
export function textHash(text: string): string;                         // full sha256 hex
export function cardEmbedText(bundle: BundleSummary, card: CardFields): string;  // Ruling 7
export function parseCardsReviewFile(json: unknown, activeBundleIds: ReadonlySet<string>, opts: { requireApproval: boolean }): CardsReviewFile;
```

- Produces (in `lib/db/bundle-queries.ts`), with `type Executor = Tx | typeof db`:

```ts
export async function listActiveBundles(ex?: Executor): Promise<BundleSummary[]>;     // sub_competencies where retired = false, ordered by id
export async function readConfirmedCards(ex?: Executor): Promise<Map<string, CardFields>>;
export async function upsertConfirmedCards(ex: Executor, cards: ReviewCard[], confirmedBy: string): Promise<{ inserted: number; updated: number }>;
```

- Produces (in `lib/ai/catalog/draft-bundle-card.ts`):

```ts
export const BUNDLE_CARD_PROMPT_VERSION = 'bundle-card-draft@1';
export async function draftBundleCard(bundle: BundleSummary, catalog: BundleSummary[]): Promise<{ card: CardFields; model: string; costUsdCents: number }>;
export function buildCardUserMessage(bundle: BundleSummary, catalog: BundleSummary[]): string;
export const CARD_JSON_SCHEMA: object;
```

- [ ] **Step 1: Write failing unit tests** in `tests/lib/catalog/bundles.test.ts`:
  - `textHash('a')` equals `'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'`.
  - `cardEmbedText` includes the name, all three descriptors, `includes`, and each positive example, and **excludes** the `excludes`, `distinctions` and negative-example text. Assert both directions with distinct marker strings.
  - `parseCardsReviewFile` refuses (each case its own `it`):
    - an empty `_approval` when `requireApproval` is true;
    - a card for an id not in `activeBundleIds`;
    - a missing card for an active id;
    - a duplicate id;
    - a stratum outside `STRATA`;
    - an empty `includes`;
    - `positiveExamples` with fewer than 2 or more than 3 entries;
    - a non-string example.
  - `parseCardsReviewFile` accepts a valid file and returns the cards sorted by `competencyId`.

- [ ] **Step 2:** Run. Expect FAIL.

- [ ] **Step 3: Implement** in `lib/catalog/bundles.ts`:

```ts
import { createHash } from 'node:crypto';
import type { BundleStratum } from '@/lib/db/schema';

export const STRATA = ['foundational', 'technical', 'business', 'workflow_ai'] as const satisfies readonly BundleStratum[];

export interface BundleSummary { id: string; name: string; knowDescriptor: string; understandDescriptor: string; doDescriptor: string; origin: string }
export interface CardFields { stratum: BundleStratum; includes: string; excludes: string; distinctions: string; positiveExamples: string[]; negativeExamples: string[] }
export interface ReviewCard extends CardFields { competencyId: string; name: string }
export interface CardsReviewFile { _approval: string; drafted: { model: string; promptVersion: string; at: string; costUsdCents: number }; cards: ReviewCard[] }

export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Ruling 7: the vector carries what the bundle IS, not what it excludes. */
export function cardEmbedText(bundle: BundleSummary, card: CardFields): string {
  return [
    bundle.name,
    `Know: ${bundle.knowDescriptor}`,
    `Understand: ${bundle.understandDescriptor}`,
    `Do: ${bundle.doDescriptor}`,
    `Includes: ${card.includes}`,
    `Examples: ${card.positiveExamples.join('; ')}`,
  ].join('\n');
}

function nonEmptyString(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`cards file: ${where} must be a non-empty string`);
  return v.trim();
}

function examples(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > 3) throw new Error(`cards file: ${where} must have 2–3 entries`);
  return v.map((e, i) => nonEmptyString(e, `${where}[${i}]`));
}

export function parseCardsReviewFile(json: unknown, activeBundleIds: ReadonlySet<string>, opts: { requireApproval: boolean }): CardsReviewFile {
  if (typeof json !== 'object' || json === null) throw new Error('cards file: not an object');
  const o = json as Record<string, unknown>;
  const approval = typeof o._approval === 'string' ? o._approval.trim() : '';
  if (opts.requireApproval && approval === '') throw new Error('cards file: _approval is empty — the owner has not approved this file');
  const drafted = o.drafted as CardsReviewFile['drafted'] | undefined;
  if (!drafted || typeof drafted.model !== 'string') throw new Error('cards file: drafted block missing');
  if (!Array.isArray(o.cards)) throw new Error('cards file: cards must be an array');
  const seen = new Set<string>();
  const cards: ReviewCard[] = o.cards.map((raw, i) => {
    const c = raw as Record<string, unknown>;
    const id = nonEmptyString(c.competencyId, `cards[${i}].competencyId`);
    if (!activeBundleIds.has(id)) throw new Error(`cards file: ${id} is not an active catalog competency`);
    if (seen.has(id)) throw new Error(`cards file: duplicate card for ${id}`);
    seen.add(id);
    const stratum = c.stratum;
    if (typeof stratum !== 'string' || !(STRATA as readonly string[]).includes(stratum)) throw new Error(`cards file: ${id}: stratum must be one of ${STRATA.join(', ')}`);
    return {
      competencyId: id,
      name: nonEmptyString(c.name, `${id}.name`),
      stratum: stratum as BundleStratum,
      includes: nonEmptyString(c.includes, `${id}.includes`),
      excludes: nonEmptyString(c.excludes, `${id}.excludes`),
      distinctions: nonEmptyString(c.distinctions, `${id}.distinctions`),
      positiveExamples: examples(c.positiveExamples, `${id}.positiveExamples`),
      negativeExamples: examples(c.negativeExamples, `${id}.negativeExamples`),
    };
  });
  for (const id of activeBundleIds) if (!seen.has(id)) throw new Error(`cards file: no card for active competency ${id}`);
  cards.sort((a, b) => a.competencyId.localeCompare(b.competencyId));
  return { _approval: approval, drafted, cards };
}
```

  Run. Expect PASS.

- [ ] **Step 4: Write a failing test for the draft call** `lib/ai/catalog/__tests__/draft-bundle-card.test.ts`. Mock `@/lib/ai/provider` exactly as `lib/ai/analyze/__tests__/program-score-coverage.test.ts` does (a `vi.mock` that keeps the actual module except `getProviderForFunction: vi.fn()`). Assert that:
  - `getProviderForFunction` is called with `'bundle-card-draft'`;
  - the `userMessage` contains the bundle id, its three descriptors, and every other catalog bundle's id and name;
  - the returned card maps snake_case to camelCase;
  - `costUsdCents` is passed through;
  - **schema audit:** walk `CARD_JSON_SCHEMA` recursively and assert that every object's `required` equals `Object.keys(properties)` and `additionalProperties === false`.

- [ ] **Step 5: Implement `lib/ai/catalog/draft-bundle-card.ts`:**

```ts
import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { STRATA, type BundleSummary, type CardFields } from '@/lib/catalog/bundles';

export const BUNDLE_CARD_PROMPT_VERSION = 'bundle-card-draft@1';

const cardSchema = z.object({
  stratum: z.enum(STRATA),
  includes: z.string().min(1),
  excludes: z.string().min(1),
  distinctions: z.string().min(1),
  positive_examples: z.array(z.string().min(1)).min(2).max(3),
  negative_examples: z.array(z.string().min(1)).min(2).max(3),
});

export const CARD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stratum', 'includes', 'excludes', 'distinctions', 'positive_examples', 'negative_examples'],
  properties: {
    stratum: { type: 'string', enum: [...STRATA] },
    includes: { type: 'string', minLength: 1 },
    excludes: { type: 'string', minLength: 1 },
    distinctions: { type: 'string', minLength: 1 },
    positive_examples: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string', minLength: 1 } },
    negative_examples: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string', minLength: 1 } },
  },
} as const;

export function buildCardUserMessage(bundle: BundleSummary, catalog: BundleSummary[]): string {
  const others = catalog.filter(b => b.id !== bundle.id).map(b => ({ id: b.id, name: b.name, know: b.knowDescriptor, understand: b.understandDescriptor, do: b.doDescriptor }));
  return [
    `**Bundle id:** ${bundle.id}`,
    `**Name:** ${bundle.name}`,
    `**Know:** ${bundle.knowDescriptor}`,
    `**Understand:** ${bundle.understandDescriptor}`,
    `**Do:** ${bundle.doDescriptor}`,
    '',
    '**The rest of the catalog (for excludes and distinctions):**',
    JSON.stringify(others, null, 2),
    '',
    'Write this bundle\'s card per the system instructions.',
  ].join('\n');
}

export async function draftBundleCard(bundle: BundleSummary, catalog: BundleSummary[]): Promise<{ card: CardFields; model: string; costUsdCents: number }> {
  const provider = await getProviderForFunction('bundle-card-draft');
  const systemPrompt = await loadPrompt('bundle-card-draft');
  const result = await provider.complete<z.infer<typeof cardSchema>>({
    systemPrompt,
    userMessage: buildCardUserMessage(bundle, catalog),
    schemaName: 'bundle_card_v1',
    jsonSchema: CARD_JSON_SCHEMA as unknown as object,
    validate: (raw: unknown) => cardSchema.parse(raw),
  });
  const d = result.data;
  return {
    card: { stratum: d.stratum, includes: d.includes, excludes: d.excludes, distinctions: d.distinctions, positiveExamples: d.positive_examples, negativeExamples: d.negative_examples },
    model: provider.model,
    costUsdCents: result.costUsdCents,
  };
}
```

  Run. Expect PASS.

- [ ] **Step 6: Write DB functions** in `lib/db/bundle-queries.ts` (new file):

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, bundleCards } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import type { BundleSummary, CardFields, ReviewCard } from '@/lib/catalog/bundles';

export type Executor = Tx | typeof db;

/** Active catalog bundles: every non-retired sub_competency (merged rows are retired by 0057's CHECK). */
export async function listActiveBundles(ex: Executor = db): Promise<BundleSummary[]> {
  return ex.select({
    id: subCompetencies.id, name: subCompetencies.name,
    knowDescriptor: subCompetencies.knowDescriptor, understandDescriptor: subCompetencies.understandDescriptor,
    doDescriptor: subCompetencies.doDescriptor, origin: subCompetencies.origin,
  }).from(subCompetencies).where(eq(subCompetencies.retired, false)).orderBy(asc(subCompetencies.id));
}

export async function readConfirmedCards(ex: Executor = db): Promise<Map<string, CardFields>> {
  const rows = await ex.select().from(bundleCards).where(eq(bundleCards.status, 'confirmed'));
  return new Map(rows.map(r => [r.competencyId, {
    stratum: r.stratum, includes: r.includes, excludes: r.excludes, distinctions: r.distinctions,
    positiveExamples: r.positiveExamples, negativeExamples: r.negativeExamples,
  }]));
}

/** Inserts or replaces each card as confirmed by `confirmedBy`. One call = one approved review file. */
export async function upsertConfirmedCards(ex: Executor, cards: ReviewCard[], confirmedBy: string): Promise<{ inserted: number; updated: number }> {
  let inserted = 0; let updated = 0;
  for (const c of cards) {
    const existing = await ex.select({ id: bundleCards.competencyId }).from(bundleCards).where(eq(bundleCards.competencyId, c.competencyId));
    const values = {
      competencyId: c.competencyId, stratum: c.stratum, includes: c.includes, excludes: c.excludes, distinctions: c.distinctions,
      positiveExamples: c.positiveExamples, negativeExamples: c.negativeExamples,
      status: 'confirmed' as const, confirmedBy, confirmedAt: sql`now()` as unknown as Date, updatedAt: sql`now()` as unknown as Date,
    };
    if (existing.length === 0) { await ex.insert(bundleCards).values(values); inserted++; }
    else { await ex.update(bundleCards).set(values).where(eq(bundleCards.competencyId, c.competencyId)); updated++; }
  }
  return { inserted, updated };
}
```

  (`and` is imported for later tasks; if lint flags it as unused at this commit, import it in Task 6 instead.)

- [ ] **Step 7: Write the CLI** `scripts/catalog/draft-bundle-cards.ts`. Follow the structure of `scripts/onet/load-onet.ts`: `parseArgs`, an exported `main(argv, deps)` returning an exit code, the `isMainModule` footer calling `loadAppEnv()`, and `assertExpectedDb` first.

  Modes are mutually exclusive:
  - **(default) dry run:** list the active bundles; print count, a per-bundle prompt character count and an estimated cost (`estimateCostCents(model, Math.ceil(chars / 4), 1200)` summed), where `model` is `(await getProviderForFunction('bundle-card-draft')).model`. Writes nothing.
  - **`--draft --out <path> --max-cost <usd>`** (paid; writes ONLY the JSON file, never the DB):
    - for each active bundle in id order: `checkDailyCap()`; if `!ok`, stop. If `spent + estimate > maxCostCents`, stop with `stopped at --max-cost`;
    - otherwise `draftBundleCard`, then `recordSpend(costUsdCents)`;
    - write `{ _approval: "", drafted: { model, promptVersion: BUNDLE_CARD_PROMPT_VERSION, at: new Date().toISOString(), costUsdCents: total }, cards }`, pretty-printed with 2-space indentation, to `--out`;
    - refuses if `--out` already exists, to prevent overwriting an approved file;
    - a stopped run still writes the cards it has and exits 4, so the controller can re-run for the rest with `--only a,b` (also implement `--only <comma ids>`).
  - **`--apply --file <path> --confirmed-by <name>`:**
    - read the file;
    - `parseCardsReviewFile(json, activeIds, { requireApproval: true })`;
    - in one transaction, `upsertConfirmedCards`;
    - print the inserted and updated counts.

  `--expect-db` is required in every mode. Never print `DATABASE_URL`.

- [ ] **Step 8: Write the DB test** `tests/db/p2-cards.test.ts`, scratch-gated, with writes in rolled-back transactions. Check that:
  - `listActiveBundles` returns only `retired = false` rows, and includes the four `gc_authored` business-acumen ids;
  - `upsertConfirmedCards` inserts and then updates (counts `{1,0}` then `{0,1}`), with `status = 'confirmed'` and `confirmed_by` set;
  - `main(['--apply', '--file', <tmp file with empty _approval>, '--confirmed-by', 'x', '--expect-db', SCRATCH_DB], { executor: tx })` returns non-zero and writes nothing;
  - `main` with `--expect-db gc_curriculum` against scratch refuses before any read.

  Inject the executor through `deps`, the same pattern as `LoadDeps` in `scripts/onet/load-onet.ts`.

- [ ] **Step 9:** Run all three test files. Expect PASS. Then run the dry run against scratch and paste its output (bundle count and estimate) into the report. **Do not run `--draft`.** It is paid, and the controller runs it (Task 15 ★2 runs it live, and the controller may run it on scratch to produce the review file).

- [ ] **Step 10: Commit:** `feat(catalog): bundle cards — review-file draft/apply, card embed text`.

---

### Task 6: Embedding cache and `embed-items`

**Tier:** standard.

**Files:**
- Create: `lib/catalog/shortlist.ts` (partial: `taskGroupKey`, `groupTasks`), `scripts/catalog/embed-items.ts`, `tests/lib/catalog/shortlist.test.ts` (partial), `tests/db/p2-embeddings.test.ts`
- Modify: `lib/db/bundle-queries.ts` (`readTaskStatements`, `embedMissing`, `readVectors`)

**Interfaces:**
- Consumes: `embedBatch`, `DEFAULT_EMBEDDING_MODEL` (`lib/ai/embeddings.ts`); `itemEmbeddings`, `onetTaskStatements`; `cardEmbedText`, `textHash`, `readConfirmedCards`, `listActiveBundles`.
- Produces:

```ts
// lib/catalog/shortlist.ts
export interface TaskRow { taskId: string; onetSocCode: string; task: string }
export interface TaskGroup { key: string; label: string; members: Array<{ taskId: string; onetSocCode: string }> }
export function normalizeTaskText(text: string): string;   // lower-case, collapse whitespace, trim, drop one trailing '.'
export function taskGroupKey(text: string): string;        // first 16 hex chars of sha256(normalizeTaskText(text))
export function groupTasks(rows: TaskRow[]): TaskGroup[];  // sorted by key; label = first row's original text in (onetSocCode, taskId) order; members sorted

// lib/db/bundle-queries.ts
export async function readTaskStatements(release: string, ex?: Executor): Promise<TaskRow[]>;
export interface EmbedItem { kind: 'bundle_card' | 'onet_task'; ref: string; text: string }
export async function embedMissing(ex: Executor, items: EmbedItem[], model: string, embed: (texts: string[]) => Promise<number[][]>): Promise<{ cached: number; embedded: number }>;
export async function readVectors(ex: Executor, kind: EmbedItem['kind'], wanted: Array<{ ref: string; text: string }>, model: string): Promise<Map<string, number[]>>; // keyed by ref; only rows whose text_hash matches the CURRENT text
```

- [ ] **Step 1: Write failing tests** in `tests/lib/catalog/shortlist.test.ts`:
  - `normalizeTaskText('  Prepare  Proofs. ')` → `'prepare proofs'`;
  - `taskGroupKey('Prepare proofs.') === taskGroupKey('prepare  proofs')`, and the result has length 16;
  - `groupTasks` merges two rows with the same normalized text under different SOCs into one group with 2 members, and keeps distinct texts apart;
  - the output order is stable (sorted by key);
  - the label is the first row's original text in (soc, taskId) order.

- [ ] **Step 2:** Run. Expect FAIL. **Step 3: Implement:**

```ts
import { createHash } from 'node:crypto';

export interface TaskRow { taskId: string; onetSocCode: string; task: string }
export interface TaskGroup { key: string; label: string; members: Array<{ taskId: string; onetSocCode: string }> }

export function normalizeTaskText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

export function taskGroupKey(text: string): string {
  return createHash('sha256').update(normalizeTaskText(text), 'utf8').digest('hex').slice(0, 16);
}

export function groupTasks(rows: TaskRow[]): TaskGroup[] {
  const sorted = [...rows].sort((a, b) => a.onetSocCode.localeCompare(b.onetSocCode) || a.taskId.localeCompare(b.taskId));
  const byKey = new Map<string, TaskGroup>();
  for (const r of sorted) {
    const key = taskGroupKey(r.task);
    const g = byKey.get(key);
    if (g) g.members.push({ taskId: r.taskId, onetSocCode: r.onetSocCode });
    else byKey.set(key, { key, label: r.task, members: [{ taskId: r.taskId, onetSocCode: r.onetSocCode }] });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
```

  Run. Expect PASS.

- [ ] **Step 4: Add the DB functions** to `lib/db/bundle-queries.ts`:

```ts
import { inArray } from 'drizzle-orm';
import { itemEmbeddings, onetTaskStatements } from '@/lib/db/schema';
import { textHash } from '@/lib/catalog/bundles';
import type { TaskRow } from '@/lib/catalog/shortlist';

export async function readTaskStatements(release: string, ex: Executor = db): Promise<TaskRow[]> {
  return ex.select({ taskId: onetTaskStatements.taskId, onetSocCode: onetTaskStatements.onetSocCode, task: onetTaskStatements.task })
    .from(onetTaskStatements).where(eq(onetTaskStatements.release, release));
}

export interface EmbedItem { kind: 'bundle_card' | 'onet_task'; ref: string; text: string }

/** Embeds only items whose (kind, ref, model, sha256(text)) row is absent. Batches through `embed`. */
export async function embedMissing(ex: Executor, items: EmbedItem[], model: string, embed: (texts: string[]) => Promise<number[][]>): Promise<{ cached: number; embedded: number }> {
  const existing = await ex.select({ kind: itemEmbeddings.kind, ref: itemEmbeddings.ref, textHash: itemEmbeddings.textHash })
    .from(itemEmbeddings).where(eq(itemEmbeddings.model, model));
  const have = new Set(existing.map(r => `${r.kind}|${r.ref}|${r.textHash}`));
  const missing = items.filter(i => !have.has(`${i.kind}|${i.ref}|${textHash(i.text)}`));
  if (missing.length === 0) return { cached: items.length, embedded: 0 };
  const vectors = await embed(missing.map(m => m.text));
  if (vectors.length !== missing.length) throw new Error(`embedMissing: got ${vectors.length} vectors for ${missing.length} texts`);
  for (let i = 0; i < missing.length; i += 200) {
    await ex.insert(itemEmbeddings).values(missing.slice(i, i + 200).map((m, j) => ({
      kind: m.kind, ref: m.ref, model, textHash: textHash(m.text), vector: vectors[i + j]!,
    }))).onConflictDoNothing();
  }
  return { cached: items.length - missing.length, embedded: missing.length };
}

export async function readVectors(ex: Executor, kind: EmbedItem['kind'], wanted: Array<{ ref: string; text: string }>, model: string): Promise<Map<string, number[]>> {
  if (wanted.length === 0) return new Map();
  const hashByRef = new Map(wanted.map(w => [w.ref, textHash(w.text)]));
  const rows = await ex.select({ ref: itemEmbeddings.ref, textHash: itemEmbeddings.textHash, vector: itemEmbeddings.vector })
    .from(itemEmbeddings)
    .where(and(eq(itemEmbeddings.kind, kind), eq(itemEmbeddings.model, model), inArray(itemEmbeddings.ref, [...hashByRef.keys()])));
  const out = new Map<string, number[]>();
  for (const r of rows) if (hashByRef.get(r.ref) === r.textHash) out.set(r.ref, r.vector);
  return out;
}
```

- [ ] **Step 5: Write the CLI** `scripts/catalog/embed-items.ts`. Arguments: `--expect-db <name> [--release 31.0] [--apply]`.
  - **Build items:**
    - for every confirmed card, `{ kind: 'bundle_card', ref: bundle.id, text: cardEmbedText(bundle, card) }`;
    - for every `groupTasks(readTaskStatements(release))` group, `{ kind: 'onet_task', ref: group.key, text: group.label }`.
  - **Refuse** with exit 3 and `no confirmed cards — run draft-bundle-cards --apply first` if any active bundle lacks a confirmed card.
  - **Dry run:** print the item counts by kind and how many are already cached at the current text hash. Calls nothing.
  - **`--apply`:** `embedMissing(db, items, DEFAULT_EMBEDDING_MODEL, (t) => embedBatch(t))`, then print `{cached, embedded}`. Each insert batch is its own statement. A crash mid-run leaves only complete rows, and a rerun embeds the rest.

- [ ] **Step 6: Write the DB test** `tests/db/p2-embeddings.test.ts` (scratch-gated, rolled back), with a fake `embed` that returns `[text.length, 1]` per text and records its calls. Check that:
  1. the first `embedMissing` embeds everything;
  2. the second call with the same items embeds 0 and does not call `embed`;
  3. after one item's text changes, exactly 1 is embedded, and `readVectors` returns the NEW vector for that ref, never the stale one;
  4. a vector-count mismatch from `embed` throws and inserts nothing.

- [ ] **Step 7:** Run the tests. Expect PASS. On scratch, run the dry run only. Real embedding needs confirmed cards; the controller runs it after cards are applied to scratch. Paste the dry-run output, including the number of distinct task groups, into the report.

- [ ] **Step 8: Commit:** `feat(catalog): embedding cache (text-hash keyed) + embed-items`.

---

### Task 7: Shortlist, seeded stratified draw, `draw-golden-sample`

**Tier:** standard.

**Files:**
- Modify: `lib/catalog/shortlist.ts` (`shortlistTasks`), `lib/catalog/bundles.ts` (`seededShuffle`, `drawGoldenSample`), `lib/db/bundle-queries.ts` (`insertGoldenSamples`)
- Create: `scripts/catalog/draw-golden-sample.ts`, `tests/db/p2-draw.test.ts`
- Extend tests: `tests/lib/catalog/shortlist.test.ts`, `tests/lib/catalog/bundles.test.ts`

**Interfaces:**
- Consumes: `cosineSimilarity` (`lib/ai/embeddings.ts`), `readVectors`, `groupTasks`, `readConfirmedCards`, `bundleGoldenSamples`, `GoldenCandidate`.
- Produces:

```ts
// lib/catalog/shortlist.ts
export interface ShortlistEntry { key: string; score: number; rank: number }
export function shortlistTasks(cardVector: number[], taskVectors: Map<string, number[]>, k: number): ShortlistEntry[]; // desc score, ties by key asc; rank 1-based

// lib/catalog/bundles.ts
export const GOLDEN_QUOTAS: Readonly<Record<BundleStratum, number>> = { foundational: 2, technical: 3, business: 2, workflow_ai: 1 };
export const GOLDEN_SIZE = 8;
export function seededShuffle<T>(items: readonly T[], seed: string): T[];
export function drawGoldenSample(bundles: Array<{ id: string; stratum: BundleStratum }>, seed: string): Array<{ id: string; stratum: BundleStratum }>;

// lib/db/bundle-queries.ts
export async function insertGoldenSamples(ex: Executor, rows: Array<{ bundleId: string; stratum: BundleStratum; seed: string; candidates: GoldenCandidate[] }>): Promise<void>;
```

- [ ] **Step 1: Write failing tests.**
  - `shortlistTasks`:
    - with 4 hand-made 2-dimensional vectors, it returns the top k in descending cosine order;
    - an exact tie is ordered by key;
    - ranks are 1..k;
    - `k` larger than the pool returns the whole pool.
  - `seededShuffle`:
    - the same seed gives the same order;
    - a different seed gives a different order on a 20-item list;
    - the input is not mutated.
  - `drawGoldenSample`:
    - takes the quota from each stratum (2/3/2/1);
    - with only 1 workflow_ai bundle, it still contains it;
    - with 0 business bundles, it fills the 2 missing slots from the remaining pool, so the size is still 8;
    - with fewer than 8 bundles in total, it returns them all;
    - the result is deterministic for a seed;
    - no id appears twice.

- [ ] **Step 2:** Run. Expect FAIL. **Step 3: Implement:**

```ts
// lib/catalog/shortlist.ts (append)
import { cosineSimilarity } from '@/lib/ai/embeddings';

export interface ShortlistEntry { key: string; score: number; rank: number }

export function shortlistTasks(cardVector: number[], taskVectors: Map<string, number[]>, k: number): ShortlistEntry[] {
  const scored = [...taskVectors.entries()].map(([key, v]) => ({ key, score: cosineSimilarity(cardVector, v) }));
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored.slice(0, k).map((s, i) => ({ ...s, rank: i + 1 }));
}
```

```ts
// lib/catalog/bundles.ts (append)
export const GOLDEN_QUOTAS: Readonly<Record<BundleStratum, number>> = { foundational: 2, technical: 3, business: 2, workflow_ai: 1 };
export const GOLDEN_SIZE = 8;

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rand = mulberry32(parseInt(textHash(seed).slice(0, 8), 16));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Spec §4: 8 bundles, seeded, spread across strata (Ruling 3 quotas), shortfalls filled from the rest. */
export function drawGoldenSample(bundles: Array<{ id: string; stratum: BundleStratum }>, seed: string): Array<{ id: string; stratum: BundleStratum }> {
  const pool = seededShuffle([...bundles].sort((a, b) => a.id.localeCompare(b.id)), seed);
  const picked: Array<{ id: string; stratum: BundleStratum }> = [];
  for (const stratum of STRATA) {
    picked.push(...pool.filter(b => b.stratum === stratum).slice(0, GOLDEN_QUOTAS[stratum]));
  }
  const pickedIds = new Set(picked.map(p => p.id));
  for (const b of pool) {
    if (picked.length >= Math.min(GOLDEN_SIZE, bundles.length)) break;
    if (!pickedIds.has(b.id)) { picked.push(b); pickedIds.add(b.id); }
  }
  return picked;
}
```

  Run. Expect PASS.

- [ ] **Step 4: Add `insertGoldenSamples`** to `lib/db/bundle-queries.ts`. It is a plain insert of the rows into `bundleGoldenSamples` (`sampleSeed: seed`).

- [ ] **Step 5: Write the CLI** `scripts/catalog/draw-golden-sample.ts`. Arguments: `--seed <text> --expect-db <name> [--release 31.0] [--apply]`.
  - Requires a confirmed card for every active bundle (exit 3 otherwise).
  - Draws with `drawGoldenSample(cards → {id, stratum}, seed)`.
  - **For each sampled bundle:**
    - read its card vector with `readVectors(db, 'bundle_card', [{ref: id, text: cardEmbedText(...)}], DEFAULT_EMBEDDING_MODEL)`;
    - read all task-group vectors with `readVectors(db, 'onet_task', groups.map(g => ({ref: g.key, text: g.label})), model)`;
    - refuse with exit 3 (`run embed-items --apply first`) if the card vector or any group vector is missing;
    - compute `shortlistTasks(cardVec, taskVecs, 50)`, then map each entry to a `GoldenCandidate` (`label` and `members` from the group).
  - **Refusals:** if any `bundle_golden_samples` row exists, refuse unless `--replace` is given. `--replace` refuses with exit 5 if any sample has `submitted_at` set: a submitted blind pick is never redrawn.
  - **Dry run:** print the 8 ids with their strata and each one's top 5 candidate labels. Writes nothing.
  - **`--apply`:** one transaction that, under `--replace`, deletes the unsubmitted samples, then inserts.

- [ ] **Step 6: Write the DB test** `tests/db/p2-draw.test.ts` (scratch-gated, rolled back). Seed in the transaction:
  - 10 synthetic `sub_competencies` rows (ids `p2t-*`, `origin = 'gc_authored'`) plus their identity `sub_competency_map` rows (the 0057 invariant; see `insertBusinessAcumen` in `scripts/catalog/insert-business-acumen.ts`);
  - confirmed cards for them;
  - `item_embeddings` vectors for the cards;
  - 3 synthetic task groups.

  Check that:
  - `main(['--seed','s1','--apply','--expect-db',SCRATCH_DB], { executor: tx, listActiveBundles: () => <the 10> , readTaskStatements: () => <synthetic rows> })` inserts 8 samples whose candidates are ranked by cosine;
  - a second `--apply` without `--replace` refuses;
  - `--replace` after setting one sample's `submitted_at` refuses with exit 5.

  Inject `listActiveBundles` and `readTaskStatements` through `deps` so the real catalog's ~40 bundles don't drive the assertions.

- [ ] **Step 7:** Run. Expect PASS. **Step 8: Commit:** `feat(catalog): task shortlist + seeded stratified golden-sample draw`.

---

### Task 8: Placement call (`bundle-map-onet`)

**Tier:** standard.

**Files:**
- Create: `lib/ai/catalog/map-bundle-onet.ts`, `lib/ai/catalog/__tests__/map-bundle-onet.test.ts`

**Interfaces:**
- Consumes: `getProviderForFunction`, `loadPrompt`, `BundleSummary`, `CardFields`, `TaskGroup`, `ShortlistEntry`.
- Produces:

```ts
export const BUNDLE_MAP_PROMPT_VERSION = 'bundle-map-onet@1';
export const TASK_SHORTLIST_K = 25;
export interface ElementDef { elementId: string; elementName: string; domain: string; description: string }
export interface PlacementInput { bundle: BundleSummary; card: CardFields; elements: ElementDef[]; tasks: Array<TaskGroup & { rank: number }>; release: string }
export interface MemberRow { source: 'onet_element' | 'onet_task'; externalId: string; externalLabel: string; onetSocCode: string | null; release: string; position: BundlePosition; rationale: string }
export interface PlacementResult { rows: MemberRow[]; noCleanMatch: boolean; note: string | null; droppedIds: string[]; model: string; costUsdCents: number }
export function buildPlacementUserMessage(input: PlacementInput): string;
export function interpretPlacements(input: PlacementInput, raw: { placements: Array<{ item_id: string; position: BundlePosition; rationale: string }>; note: string | null }): Omit<PlacementResult, 'model' | 'costUsdCents'>;
export async function placeBundle(input: PlacementInput): Promise<PlacementResult>;
export const PLACEMENT_JSON_SCHEMA: object;
```

- [ ] **Step 1: Write failing tests** (mock the provider as in Task 5 Step 4):
  - **User message:**
    - contains the bundle id, all three descriptors, every card field (including `excludes` and `distinctions`), an element line `E:<id>` with its name and definition for every element, grouped under a heading per domain, and `T1`..`Tn` lines with task text in rank order;
    - contains no O*NET-SOC codes (the model judges task text, not occupations).
  - **`interpretPlacements`:**
    - `E:x` maps to one `onet_element` row (`onetSocCode` null, `release` set);
    - `T2` maps to one row per member of the rank-2 group (`onet_task`, each member's `taskId` and SOC), all carrying the same position and rationale;
    - an unknown id (`E:nope`, `T99`, `X`) is dropped and listed in `droppedIds`;
    - a duplicate `item_id` keeps the first occurrence;
    - `noCleanMatch` is true iff no placement is core or related (Ruling 6): all-fringe gives true, empty gives true, one related gives false;
    - `note` is passed through.
  - **Schema audit:** recursively, `required` equals the property keys and `additionalProperties` is false at every object level, including `placements.items`. `note` is `['string', 'null']`.
  - **`placeBundle`:**
    - calls `getProviderForFunction('bundle-map-onet')`;
    - returns `model` and `costUsdCents` from the provider.

- [ ] **Step 2:** Run. Expect FAIL. **Step 3: Implement:**

```ts
import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { BundlePosition } from '@/lib/db/schema';
import type { BundleSummary, CardFields } from '@/lib/catalog/bundles';
import type { TaskGroup } from '@/lib/catalog/shortlist';

export const BUNDLE_MAP_PROMPT_VERSION = 'bundle-map-onet@1';
export const TASK_SHORTLIST_K = 25;
const POSITIONS = ['core', 'related', 'fringe'] as const;

export interface ElementDef { elementId: string; elementName: string; domain: string; description: string }
export interface PlacementInput { bundle: BundleSummary; card: CardFields; elements: ElementDef[]; tasks: Array<TaskGroup & { rank: number }>; release: string }
export interface MemberRow { source: 'onet_element' | 'onet_task'; externalId: string; externalLabel: string; onetSocCode: string | null; release: string; position: BundlePosition; rationale: string }
export interface PlacementResult { rows: MemberRow[]; noCleanMatch: boolean; note: string | null; droppedIds: string[]; model: string; costUsdCents: number }

const resultSchema = z.object({
  placements: z.array(z.object({ item_id: z.string().min(1), position: z.enum(POSITIONS), rationale: z.string().min(1) })),
  note: z.string().nullable(),
});

export const PLACEMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['placements', 'note'],
  properties: {
    placements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item_id', 'position', 'rationale'],
        properties: {
          item_id: { type: 'string', minLength: 1 },
          position: { type: 'string', enum: [...POSITIONS] },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
    note: { type: ['string', 'null'] },
  },
} as const;

const DOMAIN_ORDER = ['knowledge', 'transferable_skills', 'essential_skills', 'abilities', 'work_activities'];

export function buildPlacementUserMessage(input: PlacementInput): string {
  const { bundle, card } = input;
  const lines: string[] = [
    `**Bundle id:** ${bundle.id}`,
    `**Name:** ${bundle.name}`,
    `**Know:** ${bundle.knowDescriptor}`,
    `**Understand:** ${bundle.understandDescriptor}`,
    `**Do:** ${bundle.doDescriptor}`,
    `**Includes:** ${card.includes}`,
    `**Excludes:** ${card.excludes}`,
    `**Distinctions:** ${card.distinctions}`,
    `**Belongs here (examples):** ${card.positiveExamples.join('; ')}`,
    `**Does not belong here (examples):** ${card.negativeExamples.join('; ')}`,
    '',
    '---',
    '',
    '## O*NET elements (all of them)',
  ];
  const byDomain = new Map<string, ElementDef[]>();
  for (const e of input.elements) byDomain.set(e.domain, [...(byDomain.get(e.domain) ?? []), e]);
  for (const domain of [...byDomain.keys()].sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b))) {
    lines.push('', `### ${domain}`);
    for (const e of [...byDomain.get(domain)!].sort((a, b) => a.elementId.localeCompare(b.elementId))) {
      lines.push(`- E:${e.elementId} — ${e.elementName}: ${e.description}`);
    }
  }
  lines.push('', '## O*NET task statements (shortlisted)');
  for (const t of [...input.tasks].sort((a, b) => a.rank - b.rank)) lines.push(`- T${t.rank} — ${t.label}`);
  lines.push('', 'Place items into this bundle per the system instructions.');
  return lines.join('\n');
}

export function interpretPlacements(
  input: PlacementInput,
  raw: { placements: Array<{ item_id: string; position: BundlePosition; rationale: string }>; note: string | null },
): Omit<PlacementResult, 'model' | 'costUsdCents'> {
  const elements = new Map(input.elements.map(e => [`E:${e.elementId}`, e]));
  const tasks = new Map(input.tasks.map(t => [`T${t.rank}`, t]));
  const seen = new Set<string>();
  const rows: MemberRow[] = [];
  const droppedIds: string[] = [];
  let anyCoreOrRelated = false;
  for (const p of raw.placements) {
    if (seen.has(p.item_id)) continue;
    seen.add(p.item_id);
    const el = elements.get(p.item_id);
    const task = tasks.get(p.item_id);
    if (el) {
      rows.push({ source: 'onet_element', externalId: el.elementId, externalLabel: el.elementName, onetSocCode: null, release: input.release, position: p.position, rationale: p.rationale });
    } else if (task) {
      for (const m of task.members) {
        rows.push({ source: 'onet_task', externalId: m.taskId, externalLabel: task.label, onetSocCode: m.onetSocCode, release: input.release, position: p.position, rationale: p.rationale });
      }
    } else {
      droppedIds.push(p.item_id);
      continue;
    }
    if (p.position !== 'fringe') anyCoreOrRelated = true;
  }
  return { rows, noCleanMatch: !anyCoreOrRelated, note: raw.note, droppedIds };
}

export async function placeBundle(input: PlacementInput): Promise<PlacementResult> {
  const provider = await getProviderForFunction('bundle-map-onet');
  const systemPrompt = await loadPrompt('bundle-map-onet');
  const result = await provider.complete<z.infer<typeof resultSchema>>({
    systemPrompt,
    userMessage: buildPlacementUserMessage(input),
    schemaName: 'bundle_placement_v1',
    jsonSchema: PLACEMENT_JSON_SCHEMA as unknown as object,
    validate: (raw: unknown) => resultSchema.parse(raw),
  });
  return { ...interpretPlacements(input, result.data), model: provider.model, costUsdCents: result.costUsdCents };
}
```

  Run. Expect PASS.

- [ ] **Step 4: Commit:** `feat(ai): bundle-map-onet placement call (strict schema, unknown-id drop, group expansion)`.

---

### Task 9: Reconcile, agreement metrics, κ, report

**Tier:** most capable. Reconcile must be idempotent and must never undo human decisions.

**Files:**
- Create: `lib/catalog/agreement.ts`, `scripts/catalog/bundle-agreement-report.ts`, `tests/lib/catalog/agreement.test.ts`, `tests/db/p2-reconcile.test.ts`
- Modify: `lib/db/bundle-queries.ts` (`reconcileBundle`, `readAgreementInputs`)

**Interfaces:**
- Consumes: `bundleMembers`, `bundleGoldenSamples`, `bundleGoldenPicks`, `bundleMappingOutcomes`, `taskGroupKey`, `GoldenCandidate`.
- Produces:

```ts
// lib/catalog/agreement.ts
export type Pos = 'core' | 'related' | 'fringe';
export interface AgreementInput { bundleId: string; ai: Map<string, Pos>; blind: Map<string, Pos>; blindTaskRanks: Map<string, number>; shortlistK: number }
export interface AgreementRow { bundleId: string; aiCount: number; blindCount: number; both: number; precision: number | null; recall: number | null; exact: number; withinOne: number; blindTasksOutsideShortlist: number }
export function itemKey(source: 'onet_element' | 'onet_task', externalIdOrLabel: string): string; // element: `element:<id>`; task: `task:<taskGroupKey(label)>`
export function computeAgreement(input: AgreementInput): AgreementRow;
export function sumAgreement(rows: AgreementRow[]): AgreementRow;   // bundleId 'ALL', ratios recomputed from summed counts
export function cohenKappa(a: Array<Pos | 'none'>, b: Array<Pos | 'none'>): number | null; // null if lengths differ or are 0, or expected agreement is 1

// lib/db/bundle-queries.ts
export interface ReconcileResult { skipped: boolean; confirmed: number; added: number; disagreements: number }
export async function reconcileBundle(ex: Executor, bundleId: string): Promise<ReconcileResult>;
export async function readAgreementInputs(ex?: Executor): Promise<{ inputs: AgreementInput[]; noMatch: Array<{ bundleId: string; note: string | null }>; secondReviewerPairs: Array<{ bundleId: string; a: Array<Pos | 'none'>; b: Array<Pos | 'none'> }> }>;
```

- [ ] **Step 1: Write the failing pure tests** `tests/lib/catalog/agreement.test.ts`, using a hand-worked fixture:
  - **AI:** `{e1: core, e2: related, t1: fringe}`.
  - **Blind:** `{e1: core, e2: fringe, t2: related}`.
  - **Ranks:** `{t2: 31}`, k = 25.
  - **Expected:** `aiCount 3, blindCount 3, both 2, precision 2/3, recall 2/3, exact 1, withinOne 2` (e1 exact; e2 related/fringe is one step apart), `blindTasksOutsideShortlist 1`.
  - Empty AI gives `precision null`; empty blind gives `recall null`.
  - core/fringe is two steps, so it is not within one.
  - `sumAgreement` recomputes the ratios from summed counts; it never averages the ratios.
  - **`cohenKappa`:**
    - `['core','none','core','none']` vs the same gives 1;
    - `['core','core','none','none']` vs `['core','none','core','none']` gives 0;
    - a textbook 2-category example with po = 0.7 and pe = 0.5 gives 0.4;
    - mismatched lengths give `null`.

- [ ] **Step 2:** Run. Expect FAIL. **Step 3: Implement:**

```ts
import { taskGroupKey } from '@/lib/catalog/shortlist';

export type Pos = 'core' | 'related' | 'fringe';
const RANK: Record<Pos, number> = { core: 0, related: 1, fringe: 2 };

export interface AgreementInput { bundleId: string; ai: Map<string, Pos>; blind: Map<string, Pos>; blindTaskRanks: Map<string, number>; shortlistK: number }
export interface AgreementRow { bundleId: string; aiCount: number; blindCount: number; both: number; precision: number | null; recall: number | null; exact: number; withinOne: number; blindTasksOutsideShortlist: number }

export function itemKey(source: 'onet_element' | 'onet_task', externalIdOrLabel: string): string {
  return source === 'onet_element' ? `element:${externalIdOrLabel}` : `task:${taskGroupKey(externalIdOrLabel)}`;
}

export function computeAgreement(input: AgreementInput): AgreementRow {
  let both = 0, exact = 0, withinOne = 0, outside = 0;
  for (const [key, bp] of input.blind) {
    const ap = input.ai.get(key);
    if (ap !== undefined) {
      both++;
      if (ap === bp) exact++;
      if (Math.abs(RANK[ap] - RANK[bp]) <= 1) withinOne++;
    }
    const rank = input.blindTaskRanks.get(key);
    if (rank !== undefined && rank > input.shortlistK) outside++;
  }
  return {
    bundleId: input.bundleId, aiCount: input.ai.size, blindCount: input.blind.size, both,
    precision: input.ai.size === 0 ? null : both / input.ai.size,
    recall: input.blind.size === 0 ? null : both / input.blind.size,
    exact, withinOne, blindTasksOutsideShortlist: outside,
  };
}

export function sumAgreement(rows: AgreementRow[]): AgreementRow {
  const s = rows.reduce((a, r) => ({
    aiCount: a.aiCount + r.aiCount, blindCount: a.blindCount + r.blindCount, both: a.both + r.both,
    exact: a.exact + r.exact, withinOne: a.withinOne + r.withinOne, out: a.out + r.blindTasksOutsideShortlist,
  }), { aiCount: 0, blindCount: 0, both: 0, exact: 0, withinOne: 0, out: 0 });
  return {
    bundleId: 'ALL', aiCount: s.aiCount, blindCount: s.blindCount, both: s.both,
    precision: s.aiCount === 0 ? null : s.both / s.aiCount, recall: s.blindCount === 0 ? null : s.both / s.blindCount,
    exact: s.exact, withinOne: s.withinOne, blindTasksOutsideShortlist: s.out,
  };
}

export function cohenKappa(a: Array<Pos | 'none'>, b: Array<Pos | 'none'>): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  const n = a.length;
  const cats = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
  const po = agree / n;
  let pe = 0;
  for (const c of cats) pe += (a.filter(x => x === c).length / n) * (b.filter(x => x === c).length / n);
  if (pe === 1) return null;
  return (po - pe) / (1 - pe);
}
```

  Run. Expect PASS.

- [ ] **Step 4: Write the failing DB test** `tests/db/p2-reconcile.test.ts` (scratch-gated, rolled back). Seed:
  - one synthetic bundle;
  - a submitted sample (reviewer `R`) with candidates covering task group `g1` (two members across SOCs `99-0001.00` and `99-0002.00`);
  - **picks:** element `e1` core; element `e2` related; task `g1` both members related;
  - **AI-proposed members:** `e1` core (agrees), `e2` fringe (disagrees), `e3` core (AI-only), with `ai_position` equal to `position`;
  - an already **rejected** member `e4` whose picks say core (a human decision; must stay rejected).

  Assert after `reconcileBundle`:
  - `e1` is confirmed with `confirmed_by = 'R'` and a review note mentioning the blind pick;
  - `e2` stays proposed, with its review note recording `blind pick: related`;
  - both `g1` rows were added as `confirmed`, with `proposed_by = 'reviewer'`, `ai_position` NULL and position related;
  - `e3` stays proposed and untouched;
  - `e4` stays rejected and untouched;
  - the result is `{ skipped: false, confirmed: 1, added: 2, disagreements: 1 }`.

  Then:
  - **idempotence:** a second `reconcileBundle` returns `{confirmed: 0, added: 0, disagreements: 1}` and changes no row. Compare a full `select` snapshot of the bundle's members before and after, including `updated_at`.
  - an unsubmitted sample returns `{ skipped: true }` and changes nothing;
  - a bundle with no sample returns `{ skipped: true }`.

- [ ] **Step 5: Implement** `reconcileBundle` in `lib/db/bundle-queries.ts`:

```ts
export interface ReconcileResult { skipped: boolean; confirmed: number; added: number; disagreements: number }

/** Spec §5 reconcile, Ruling 8. Idempotent; never changes a confirmed or rejected row. */
export async function reconcileBundle(ex: Executor, bundleId: string): Promise<ReconcileResult> {
  const [sample] = await ex.select().from(bundleGoldenSamples).where(eq(bundleGoldenSamples.bundleId, bundleId));
  if (!sample || !sample.submittedAt || !sample.reviewer) return { skipped: true, confirmed: 0, added: 0, disagreements: 0 };
  const reviewer = sample.reviewer;
  const picks = await ex.select().from(bundleGoldenPicks).where(and(
    eq(bundleGoldenPicks.bundleId, bundleId), eq(bundleGoldenPicks.reviewer, reviewer), eq(bundleGoldenPicks.noCleanMatch, false),
  ));
  const members = await ex.select().from(bundleMembers).where(eq(bundleMembers.bundleId, bundleId));
  const k = (s: string, rel: string | null, ext: string, soc: string | null) => `${s}|${rel ?? ''}|${ext}|${soc ?? ''}`;
  const byKey = new Map(members.map(m => [k(m.source, m.release, m.externalId, m.onetSocCode), m]));
  const labelByTask = new Map<string, string>();
  for (const c of sample.candidates) for (const m of c.members) labelByTask.set(`${m.taskId}|${m.onetSocCode}`, c.label);
  let confirmed = 0, added = 0, disagreements = 0;
  for (const p of picks) {
    const m = byKey.get(k(p.source!, p.release, p.externalId!, p.onetSocCode));
    if (!m) {
      const label = p.source === 'onet_task'
        ? (labelByTask.get(`${p.externalId}|${p.onetSocCode}`) ?? p.externalId!)
        : await elementName(ex, p.release!, p.externalId!);
      const inserted = await ex.insert(bundleMembers).values({
        bundleId, source: p.source!, externalId: p.externalId!, externalLabel: label, onetSocCode: p.onetSocCode, release: p.release,
        position: p.position!, aiPosition: null, status: 'confirmed', proposedBy: 'reviewer', rationale: null,
        confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date, reviewNote: 'blind pick (reconcile)',
      }).onConflictDoNothing().returning({ id: bundleMembers.id });
      added += inserted.length;
    } else if (m.status === 'proposed') {
      if (m.position === p.position) {
        await ex.update(bundleMembers).set({ status: 'confirmed', confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date, reviewNote: 'blind pick agreed (reconcile)', updatedAt: sql`now()` as unknown as Date }).where(eq(bundleMembers.id, m.id));
        confirmed++;
      } else {
        disagreements++;
        const note = `blind pick: ${p.position}`;
        if (m.reviewNote !== note) {
          await ex.update(bundleMembers).set({ reviewNote: note, updatedAt: sql`now()` as unknown as Date }).where(eq(bundleMembers.id, m.id));
        }
      }
    }
  }
  return { skipped: false, confirmed, added, disagreements };
}

async function elementName(ex: Executor, release: string, elementId: string): Promise<string> {
  const [d] = await ex.select({ n: onetElementDefinitions.elementName }).from(onetElementDefinitions)
    .where(and(eq(onetElementDefinitions.release, release), eq(onetElementDefinitions.elementId, elementId)));
  return d?.n ?? elementId;
}
```

  Import the schema objects it uses. Run. Expect PASS.

- [ ] **Step 6: Red-proof reconcile's human-decision guard (mandatory).** Temporarily change `else if (m.status === 'proposed')` to `else`, then rerun. The `e4 stays rejected` assertion must FAIL. Paste the red output, then revert.

- [ ] **Step 7: Implement `readAgreementInputs`.** It reads only samples with `submitted_at IS NOT NULL`.
  - **`ai`:** the bundle's members with `proposed_by <> 'reviewer'` (any status), keyed by `itemKey(source, source === 'onet_element' ? externalId : externalLabel)`, with value `aiPosition ?? position`.
  - **`blind`:** the sample reviewer's picks (not `no_clean_match`). An element pick is keyed by `itemKey('onet_element', externalId)`. A task pick is keyed by the candidate label that contains its (taskId, soc), as `itemKey('onet_task', label)`.
  - **`blindTaskRanks`:** for blind task keys, the candidate's `rank`.
  - `shortlistK = TASK_SHORTLIST_K`.
  - **`noMatch`:** per active bundle, the latest `ok` outcome by `created_at` with `no_clean_match = true`. Exclude sampled-unsubmitted bundles.
  - **`secondReviewerPairs`:** for bundles whose picks have two or more distinct reviewers, build a label vector over the union of all elements (from `onet_element_definitions`) and that sample's candidates, `'none'` where unpicked, for the first two reviewers in name order.

  Add one DB assertion to the reconcile test file: `readAgreementInputs` on the seeded data yields `ai` containing `e1, e2, e3` and `blind` containing `e1, e2` plus one task key. That task key counts once even though it has two member rows.

- [ ] **Step 8: Write the read-only report** `scripts/catalog/bundle-agreement-report.ts` (`--expect-db`). It prints:
  1. the header `Bundle agreement report — blind sample (n = <count> bundles; percentages are rough at this size)`;
  2. per bundle: counts first (`AI placed`, `reviewer placed`, `both`, `exact`, `within one`, `reviewer tasks outside top-25`), then precision and recall as percentages with one decimal, or `n/a`;
  3. the `ALL` row from `sumAgreement`;
  4. κ per bundle where `secondReviewerPairs` exist, otherwise the line `Cohen's κ: needs a second blind reviewer`;
  5. the no-clean-match list (the ESCO to-do);
  6. the line `Nothing is auto-confirmed in P2, whatever these figures say.`;
  7. the O*NET attribution, verbatim.

  Export a pure `formatReport(data)` and unit-test that its output contains the attribution, the caveat and the counts line. Add that test to `tests/lib/catalog/agreement.test.ts`.

- [ ] **Step 9:** Run all of it. Expect PASS. **Commit:** `feat(catalog): reconcile (idempotent, never overrides decisions) + agreement metrics, κ, report`.

---

### Task 10: Mapping writer and `map-bundles-onet` CLI

**Tier:** most capable. This is the rerun path that deletes rows, so it is destruction-capable.

**Files:**
- Modify: `lib/db/bundle-queries.ts` (`createRun`, `finishRun`, `writeBundleProposals`, `recordFailedOutcome`, `readElementDefinitions`, `bundlesWithOkOutcome`)
- Create: `scripts/catalog/map-bundles-onet.ts`, `tests/db/p2-proposals.test.ts`

**Interfaces:**
- Consumes: `placeBundle`, `buildPlacementUserMessage`, `TASK_SHORTLIST_K`, `BUNDLE_MAP_PROMPT_VERSION`, `shortlistTasks`, `groupTasks`, `readVectors`, `readConfirmedCards`, `listActiveBundles`, `readTaskStatements`, `reconcileBundle`, `estimateCostCents`, `checkDailyCap`, `recordSpend`.
- Produces:

```ts
export async function readElementDefinitions(release: string, ex?: Executor): Promise<ElementDef[]>;
export async function createRun(ex: Executor, r: { model: string; promptVersion: string; taskShortlistK: number; bundleCount: number }): Promise<string>; // run id
export async function finishRun(ex: Executor, runId: string, costUsdCents: number): Promise<void>;
export async function writeBundleProposals(ex: Executor, args: { runId: string; bundleId: string; rows: MemberRow[]; model: string; noCleanMatch: boolean; note: string | null; costUsdCents: number }): Promise<{ deleted: number; inserted: number; keptDecided: number; reconcile: ReconcileResult }>;
export async function recordFailedOutcome(ex: Executor, args: { runId: string; bundleId: string; note: string; costUsdCents: number }): Promise<void>;
export async function bundlesWithOkOutcome(ex?: Executor): Promise<Set<string>>;
```

- [ ] **Step 1: Write the failing DB test** `tests/db/p2-proposals.test.ts` (scratch-gated, every case in a rolled-back transaction). Seed one synthetic bundle (with its identity `sub_competency_map` row) and a run row.
  - **Case A (first write):** `writeBundleProposals` with 3 rows (2 elements, 1 task row) inserts 3 `proposed` rows with `ai_position = position`, `proposed_by = model`, `run_id` set, plus one `ok` outcome.
  - **Case B (rerun safety, mandatory red-proof):**
    - seed: a `confirmed` member X (an element), a `rejected` member Y (an element), and a `proposed` member Z from an earlier run;
    - the new run's rows contain X at a DIFFERENT position, Y, and a new W, but not Z;
    - assert:
      - X is unchanged (status, position, `confirmed_by`, `updated_at` all equal to before);
      - Y is unchanged;
      - Z is deleted;
      - W is inserted as `proposed`;
      - the result is `{ deleted: 1, inserted: 1, keptDecided: 2 }`.
  - **Case C (no partial rows):** pass a row that violates a CHECK (a `onet_task` row with `onetSocCode: null`) inside an inner `ex.transaction(...)`. Assert that it throws, and that afterward the bundle's members and outcomes equal the pre-call snapshot: Z is still present and no outcome row was written.
  - **Case D (reconcile hook):** with a submitted sample whose pick agrees with a new proposed row, the result's `reconcile.confirmed === 1` and the row is confirmed.
  - **Case E:** `recordFailedOutcome` writes `status = 'failed'`, `no_clean_match = false`, and touches no members.

- [ ] **Step 2:** Run. Expect FAIL. **Step 3: Implement:**

```ts
export async function writeBundleProposals(
  ex: Executor,
  args: { runId: string; bundleId: string; rows: MemberRow[]; model: string; noCleanMatch: boolean; note: string | null; costUsdCents: number },
): Promise<{ deleted: number; inserted: number; keptDecided: number; reconcile: ReconcileResult }> {
  const run = async (tx: Executor) => {
    // Spec §4 D: reruns replace ONLY proposed rows; confirmed/rejected are never touched.
    const deleted = await tx.delete(bundleMembers)
      .where(and(eq(bundleMembers.bundleId, args.bundleId), eq(bundleMembers.status, 'proposed')))
      .returning({ id: bundleMembers.id });
    let inserted = 0;
    if (args.rows.length > 0) {
      const res = await tx.insert(bundleMembers).values(args.rows.map(r => ({
        bundleId: args.bundleId, source: r.source, externalId: r.externalId, externalLabel: r.externalLabel,
        onetSocCode: r.onetSocCode, release: r.release, position: r.position, aiPosition: r.position,
        status: 'proposed' as const, proposedBy: args.model, rationale: r.rationale, runId: args.runId,
      }))).onConflictDoNothing({ target: [bundleMembers.bundleId, bundleMembers.source, bundleMembers.release, bundleMembers.externalId, bundleMembers.onetSocCode] })
        .returning({ id: bundleMembers.id });
      inserted = res.length;
    }
    await tx.insert(bundleMappingOutcomes).values({
      runId: args.runId, bundleId: args.bundleId, status: 'ok', noCleanMatch: args.noCleanMatch, note: args.note, costUsdCents: args.costUsdCents,
    });
    const reconcile = await reconcileBundle(tx, args.bundleId);
    return { deleted: deleted.length, inserted, keptDecided: args.rows.length - inserted, reconcile };
  };
  // One transaction per bundle: a failure leaves no partial rows (spec §4 D).
  return ex === db ? db.transaction(tx => run(tx)) : run(ex);   // a caller-owned tx (tests, routes) is used as-is
}
```

  If the conflict target with `nullsNotDistinct` is rejected by Drizzle, use `.onConflictDoNothing()` with no target. The only unique constraint besides the PK is `bundle_members_item_key`, and the PK is a fresh uuid, so behavior is identical. Note which form you used in the report.

  `keptDecided` counts rows skipped because a confirmed or rejected row already exists for that item. After the delete, the only surviving rows are decided ones, so every conflict is a decided row.

  `createRun` / `finishRun` / `recordFailedOutcome` / `readElementDefinitions` / `bundlesWithOkOutcome` are straightforward inserts and selects on the Task 2 tables. `recordFailedOutcome` uses `onConflictDoUpdate` on (`run_id`, `bundle_id`) so a retry inside the same run overwrites its own failure. `finishRun` sets `finished_at = now()` and `cost_usd_cents`.

  Run. Expect PASS.

- [ ] **Step 4: Red-proof the rerun safety (mandatory).**
  1. Change the delete's `where` to `eq(bundleMembers.bundleId, args.bundleId)`, dropping the status filter. Rerun Case B: it must FAIL on X/Y. Paste the output and revert.
  2. Then remove the `onConflictDoNothing(...)` call. Case B must FAIL with a unique violation. Paste and revert.

- [ ] **Step 5: Write the CLI** `scripts/catalog/map-bundles-onet.ts`.

  **Arguments:** `--expect-db <name> [--release 31.0] [--apply] [--max-cost <usd>] [--missing] [--bundles a,b]`. `--apply` requires `--max-cost`; refuse with exit 2 if it is absent.

  **Setup:**
  - `assertExpectedDb`;
  - load the active bundles and confirmed cards (exit 3 if any card is missing);
  - load the element definitions for the release (exit 3 if there are none: `load-onet --apply first`);
  - load the task groups, the card vectors and the task-group vectors (exit 3 if any are missing: `embed-items --apply first`);
  - `model = (await getProviderForFunction('bundle-map-onet')).model`.

  **Scope:**
  - all active bundles;
  - `--bundles` restricts to those ids (unknown id: exit 2);
  - `--missing` keeps only bundles NOT in `bundlesWithOkOutcome()`.

  **For each bundle in scope:**
  - `tasks = shortlistTasks(cardVec, taskVecs, TASK_SHORTLIST_K)`, mapped to groups with their rank;
  - `input: PlacementInput`;
  - `est = estimateCostCents(model, Math.ceil(buildPlacementUserMessage(input).length / 4) + 1500, 2500)`. The 1500 covers the system prompt and the 2500 the output.

  **Dry run** (default; no calls, no writes):
  - per bundle: id, the number of elements, the top 5 shortlisted task labels, and the estimate;
  - then the total estimate in dollars and the model;
  - exit 0.

  **`--apply`:**
  - `runId = createRun(...)`;
  - for each bundle:
    - if `spent + est > maxCostCents`, print `stopped at --max-cost ($X spent); rerun with --missing to continue`, stop the loop, and use exit code 4;
    - `checkDailyCap()`; if `!ok`, stop the same way, also exit 4;
    - in a try block: `res = await placeBundle(input)`; `recordSpend(res.costUsdCents)`; `spent += res.costUsdCents`; then `writeBundleProposals(db, {...})`. Print per bundle: `OK <id>  placed <n> rows  dropped ids <droppedIds.length>  no-clean-match <bool>  reconcile <confirmed/added/disagreements>`;
    - on catch: `recordFailedOutcome(db, { runId, bundleId, note: formatDbError(err), costUsdCents: 0 })`, print `FAILED <id>: <message>`, and continue;
  - `finishRun(db, runId, spent)`;
  - print the totals: bundles ok, failed, skipped by cap, and the total cost in dollars;
  - exit 0 if no failures and not stopped; exit 4 if stopped by the cap; exit 1 if any bundle failed.

  Never print `DATABASE_URL`, prompts or rationale text in bulk (summary lines only).

- [ ] **Step 6: CLI test,** in `tests/db/p2-proposals.test.ts`. Call `main` with injected deps `{ executor: tx, placeBundle: fake, listActiveBundles, readConfirmedCards, readElementDefinitions, readTaskStatements, readVectors, checkDailyCap: () => ({ok: true, spentCents: 0, overCap: false}), recordSpend: vi.fn(), estimate: () => 100 }`. Assert:
  - `--apply` without `--max-cost` gives exit 2 and no writes;
  - the dry run makes no `placeBundle` calls and no writes;
  - `--max-cost 0.025` (250 units) with 3 bundles at an estimated 100 each, and the fake returning `costUsdCents: 100`, places 2 bundles, stops with exit 4, and writes outcomes for exactly 2;
  - a fake that throws on bundle 2 records a `failed` outcome for it, places bundles 1 and 3, and exits 1;
  - `--missing` then selects only bundle 2.

- [ ] **Step 7:** Run all P2 tests. Expect PASS. Run the CLI dry run on scratch, which needs scratch cards and embeddings; if the controller hasn't produced them yet, say so and skip. **Commit:** `feat(catalog): map-bundles-onet — per-bundle tx, rerun replaces only proposed rows, cost guard`.

---

### Task 11: Admin API routes (blindness enforced)

**Tier:** most capable. Blindness is the measurement's integrity.

**Files:**
- Modify: `lib/db/bundle-queries.ts` (`listBundlesForReview`, `readBundleDetail`, `submitBlindPicks`, `applyMemberAction`, `bulkConfirm`, `resetBlind`, `searchItems`, `isBlindLocked`)
- Create: the eight route files under `app/api/admin/bundles/` (see File Structure), `app/api/admin/bundles/__tests__/blindness.test.ts`, `app/api/admin/bundles/__tests__/routes.test.ts`, `tests/db/p2-review-actions.test.ts`

**Interfaces:**
- Produces (`lib/db/bundle-queries.ts`):

```ts
export const ONET_ATTRIBUTION = 'This product includes information from O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license.';
export function validateReviewer(v: unknown): { reviewer: string } | { error: string }; // trimmed, 1–80 chars
/** True while a bundle is in the blind sample and its pick is not submitted: AI placements must not leave the server. */
export async function isBlindLocked(bundleId: string, ex?: Executor): Promise<boolean>;
export interface BundleListItem { id: string; name: string; stratum: string | null; sampled: boolean; submitted: boolean; counts: { proposed: number; confirmed: number; rejected: number } | null; noCleanMatch: boolean | null }
export async function listBundlesForReview(ex?: Executor): Promise<BundleListItem[]>; // counts & noCleanMatch null while blind-locked
export interface MemberView { id: string; source: string; externalId: string; externalLabel: string; onetSocCode: string | null; position: string; aiPosition: string | null; status: string; proposedBy: string; rationale: string | null; reviewNote: string | null; bulkConfirmed: boolean }
export interface BundleDetail { bundle: BundleSummary; card: CardFields | null; elements: ElementDef[]; sample: { candidates: GoldenCandidate[]; submitted: boolean; reviewer: string | null; picks: Array<{ source: string | null; externalId: string | null; onetSocCode: string | null; position: string | null; noCleanMatch: boolean }> } | null; members: MemberView[] | null; latestOutcome: { noCleanMatch: boolean; note: string | null } | null }
export async function readBundleDetail(bundleId: string, ex?: Executor): Promise<BundleDetail | null>; // members & latestOutcome null while blind-locked
export type BlindPickInput = { kind: 'element'; elementId: string; position: Pos } | { kind: 'task'; groupKey: string; position: Pos };
export async function submitBlindPicks(ex: Executor, bundleId: string, reviewer: string, picks: BlindPickInput[], noCleanMatch: boolean, release: string): Promise<{ ok: true; reconcile: ReconcileResult } | { ok: false; status: 404 | 409 | 400; error: string }>;
export type MemberAction =
  | { action: 'confirm'; memberIds: string[] }
  | { action: 'reject'; memberIds: string[] }
  | { action: 'set_position'; memberIds: string[]; position: Pos }
  | { action: 'add'; item: { kind: 'element'; elementId: string } | { kind: 'task'; taskId: string; onetSocCode: string }; position: Pos };
export async function applyMemberAction(ex: Executor, bundleId: string, reviewer: string, a: MemberAction, release: string): Promise<{ ok: true; changed: number } | { ok: false; status: 400 | 404 | 409; error: string }>;
export async function bulkConfirm(ex: Executor, bundleId: string, reviewer: string): Promise<{ ok: true; changed: number } | { ok: false; status: 404 | 409; error: string }>;
export async function resetBlind(ex: Executor, bundleId: string, reviewer: string, note: string): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; error: string }>;
export async function searchItems(q: string, release: string, ex?: Executor): Promise<{ elements: ElementDef[]; tasks: Array<{ taskId: string; onetSocCode: string; task: string }> }>; // ILIKE, ≤ 30 each; NO membership fields
```

**Rules every route follows** (copy the comment block from `app/api/admin/access/route.ts`):
- `checkAdminAuth` (slug in the query for GET, in the body for POST);
- POSTs check `hasJsonContentType` first (415);
- every response carries `Cache-Control: no-store`;
- `export const dynamic = 'force-dynamic'`;
- the bundle id is validated against `/^[a-z0-9-]{1,80}$/` before any query (400 otherwise);
- `release` comes from a module constant `ONET_RELEASE = '31.0'`;
- every write runs in `db.transaction`.

**Action semantics** (all refuse with 409 `blind sample not submitted` while `isBlindLocked`; the only exceptions are `submitBlindPicks`, which requires the lock, and `resetBlind`, which requires a submitted sample):
- **confirm / reject:** only rows of this bundle with `status = 'proposed'`. Sets status, `confirmed_by = reviewer`, `confirmed_at = now()` and `updated_at`. Ids not in the bundle, or already decided, are not counted; `changed` reports how many changed.
- **set_position:** on `proposed` rows. Sets `position`, keeps `ai_position`, sets `status = 'confirmed'`, `confirmed_by` and `confirmed_at`, and `review_note = 'position changed from <ai_position>'`. Changing a position is a decision.
- **add:** looks up the label (element name, or task text from `onet_task_statements`); 404 if the item doesn't exist. Inserts `proposed_by = 'reviewer'`, `status = 'confirmed'`, `ai_position` NULL. A conflict with an existing row gives 409 `already a member; use confirm or set_position`.
- **bulkConfirm:** every `proposed` row of the bundle becomes `confirmed` with `bulk_confirmed = true`.
- **submitBlindPicks:**
  - 404 if the bundle is not sampled; 409 if already submitted.
  - A task pick's `groupKey` must be one of the sample's candidates, and expands to one pick row per member; an element id must exist in `onet_element_definitions` for the release. Otherwise 400.
  - `noCleanMatch = true` with any picks gives 400.
  - Deletes this reviewer's previous picks for the bundle (picks survive a reset, so a resubmission replaces them), inserts the picks, or one `no_clean_match` row; sets `reviewer` and `submitted_at = now()`; then calls `reconcileBundle`. All in one transaction.
- **resetBlind:** requires a note of 1–500 characters; 409 if not submitted. Sets `submitted_at = NULL` and `reset_note = coalesce(reset_note || E'\n', '') || '<iso time> <reviewer>: <note>'`. Picks are kept, and so are the members that reconcile already confirmed, with no un-confirming. Add a doc comment saying so.

- [ ] **Step 1: Write the failing blindness test (mandatory red-proof).** It goes in `app/api/admin/bundles/__tests__/blindness.test.ts` and is DB-backed (scratch-gated). It seeds in a committed setup and cleans up in `afterAll`, deleting only the synthetic ids it created. The route handlers use the module `db`, so a rolled-back transaction can't wrap them; the cleanup removes members, outcomes, runs, picks, samples, cards, `sub_competency_map` rows and `sub_competencies` rows with ids prefixed `p2blind-`, in FK order. Mock `checkAdminAuth` to return true.
  - **Seed:** a bundle `p2blind-a` with a card, an UNSUBMITTED sample (candidates with one task group), and AI-proposed members whose rationale contains the marker `SECRET-RATIONALE-xyz`, plus an ok outcome with note `SECRET-NOTE-xyz`.
  - **Assert:** the raw response text of each of these contains neither marker, and `members === null` where applicable:
    - `GET /api/admin/bundles`;
    - `GET /api/admin/bundles/p2blind-a`;
    - `GET /api/admin/bundles/agreement`;
    - `GET /api/admin/bundles/search?q=<a word from the seeded task>`.
  - **Writes are refused while locked:** a POST to `members` (confirm), `bulk-confirm` and `reset-blind` each gives 409.
  - **Then:** POST `blind` with one pick gives 200, and a subsequent `GET /api/admin/bundles/p2blind-a` now contains `SECRET-RATIONALE-xyz`.
  - **Red-proof:** temporarily make `isBlindLocked` return `false`, rerun, confirm the marker assertions FAIL, paste the output, revert.

- [ ] **Step 2:** Run. Expect FAIL (routes missing).

- [ ] **Step 3: Implement the query functions** following the semantics above, then the routes. Example: the detail route, which is representative; the other seven follow the same skeleton.

```ts
// app/api/admin/bundles/[id]/route.ts
import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { readBundleDetail, ONET_ATTRIBUTION } from '@/lib/db/bundle-queries';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5).
// Auth: the middleware grant gate (admin kind for /api/admin/**) is primary;
// checkAdminAuth is the in-route second factor (tests/api/admin-routes-gated.test.ts).
// Blindness: readBundleDetail returns members = null while the bundle's blind
// pick is unsubmitted, so AI placements never leave the server (spec §5).
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const ID_RE = /^[a-z0-9-]{1,80}$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400, headers: NO_STORE });
  const detail = await readBundleDetail(id);
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ ...detail, attribution: ONET_ATTRIBUTION }, { headers: NO_STORE });
}
```

```ts
// app/api/admin/bundles/[id]/members/route.ts
import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { db } from '@/lib/db/client';
import { applyMemberAction, validateReviewer, type MemberAction } from '@/lib/db/bundle-queries';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const ID_RE = /^[a-z0-9-]{1,80}$/;
const ONET_RELEASE = '31.0';
const POS = new Set(['core', 'related', 'fringe']);
const UUID_RE = /^[0-9a-f-]{36}$/;

function parseAction(b: Record<string, unknown>): MemberAction | null {
  const ids = Array.isArray(b.memberIds) && b.memberIds.every(x => typeof x === 'string' && UUID_RE.test(x)) ? (b.memberIds as string[]) : null;
  switch (b.action) {
    case 'confirm': case 'reject': return ids && ids.length > 0 && ids.length <= 500 ? { action: b.action, memberIds: ids } : null;
    case 'set_position': return ids && ids.length > 0 && POS.has(String(b.position)) ? { action: 'set_position', memberIds: ids, position: b.position as 'core' } : null;
    case 'add': {
      const it = b.item as Record<string, unknown> | undefined;
      if (!it || !POS.has(String(b.position))) return null;
      if (it.kind === 'element' && typeof it.elementId === 'string') return { action: 'add', item: { kind: 'element', elementId: it.elementId }, position: b.position as 'core' };
      if (it.kind === 'task' && typeof it.taskId === 'string' && typeof it.onetSocCode === 'string') return { action: 'add', item: { kind: 'task', taskId: it.taskId, onetSocCode: it.onetSocCode }, position: b.position as 'core' };
      return null;
    }
    default: return null;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!hasJsonContentType(req)) return NextResponse.json({ error: 'content-type must be application/json' }, { status: 415, headers: NO_STORE });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400, headers: NO_STORE });
  const r = validateReviewer(body.reviewer);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400, headers: NO_STORE });
  const action = parseAction(body);
  if (!action) return NextResponse.json({ error: 'bad action' }, { status: 400, headers: NO_STORE });
  const result = await db.transaction(tx => applyMemberAction(tx, id, r.reviewer, action, ONET_RELEASE));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  return NextResponse.json(result, { headers: NO_STORE });
}
```

  The list route returns `{ bundles, progress: { reviewed, total }, attribution }`, where "reviewed" means the bundle has 0 `proposed` rows and at least one ok outcome. The agreement route returns `readAgreementInputs()` → `computeAgreement` per bundle, plus `sumAgreement`, κ pairs and the no-match list, with the attribution.

- [ ] **Step 4: Write `routes.test.ts`** (mocked queries, like `app/api/admin/access/__tests__/route.test.ts`). For each of the eight routes, check that:
  - a failing second factor gives 401;
  - a POST without JSON content type gives 415;
  - a bad id gives 400;
  - for POSTs, a missing or oversized reviewer gives 400;
  - a bad action shape gives 400;
  - the `no-store` header is present;
  - the query function's `{ok:false, status}` is passed through.

  Also confirm `tests/api/admin-routes-gated.test.ts` still passes; it now covers the eight new route files automatically.

- [ ] **Step 5: Write `tests/db/p2-review-actions.test.ts`** (scratch-gated, rolled back), covering the query semantics:
  - confirm and reject touch only `proposed` rows of THIS bundle;
  - `set_position` keeps `ai_position` and confirms;
  - `add` of an existing item gives 409;
  - `add` of an unknown element gives 404;
  - `bulkConfirm` sets `bulk_confirmed`;
  - `resetBlind` without a note gives 400, and with a note clears `submitted_at`, appends `reset_note`, and keeps picks and confirmed members;
  - `submitBlindPicks`:
    - a second submit gives 409;
    - a task pick outside the candidates gives 400;
    - no-clean-match plus picks gives 400;
    - a group pick expands to one row per member;
    - a resubmission after a reset replaces the previous picks.

- [ ] **Step 6:** Run all of it. Expect PASS. **Commit:** `feat(api): /api/admin/bundles review routes with server-side blindness`.

---

### Task 12: `/admin/bundles` page

**Tier:** standard.

**Files:**
- Create: `app/admin/bundles/page.tsx`, `app/admin/bundles/BundlesPanel.tsx`, `app/admin/bundles/__tests__/BundlesPanel.test.tsx`
- Modify: `app/admin/page.tsx` (link)

**Interfaces:**
- Consumes the Task 11 routes and their JSON shapes (`BundleListItem`, `BundleDetail`, `MemberView`, `GoldenCandidate`), and `ONET_ATTRIBUTION`.

**Page behavior** (spec §5). All copy is US English, sentence case and plain verbs.
- **`page.tsx`:** server component, `dynamic = 'force-dynamic'`. It reads `slug` from `searchParams`, shows "Missing slug query param." when there isn't one (same as `app/admin/access/page.tsx`), and renders the header "Skill bundles", a link back to Admin, and `<BundlesPanel slug={slug} />`. The footer shows the O*NET attribution verbatim in small text.
- **`BundlesPanel.tsx`** (`'use client'`):
  - A reviewer-name field at the top, stored under `localStorage` key `gc-bundles-reviewer`. Wrap every `localStorage` read and write in try/catch, since storage may be unavailable. While the field is empty, every action button is disabled, with the hint "Enter your name to review."
  - Three tabs, plain buttons with `aria-pressed`:
    - **Cards:** each bundle's card, read-only: stratum, includes, excludes, distinctions, examples. If cards don't exist: "No confirmed cards yet."
    - **Blind sample:**
      - the list of sampled bundles, each showing "Submitted" or "Not started";
      - opening an unsubmitted one shows the card; all elements grouped by domain inside `<details>` (collapsed), each with core / related / fringe / not-a-member radio buttons, defaulting to not a member; and the top-50 task candidates with the same radios;
      - a "No clean match" checkbox, which disables the radios;
      - a "Submit blind pick" button with a confirm dialog: "Submit? You can't change it afterward without an admin reset.";
      - after submit, the result shows "Submitted. N confirmed, M added, K sent to the review queue.";
      - a submitted bundle shows its picks read-only, plus a "Reset this blind pick" button that requires a note.
    - **Review queue:**
      - progress "X of Y bundles reviewed";
      - the bundle list (blind-locked bundles show "Blind pick first" and can't be opened);
      - opening a bundle shows its members grouped by position (core, related, fringe), each with its label, rationale, AI position, status and review note. Task rows sharing an `externalLabel` render as one line listing their SOC codes, and act on all of their member ids together;
      - buttons per line: Confirm, Reject, Change position (select);
      - "Add an item" opens a search box (debounced 300 ms, `GET /search`) whose results have an Add button and a position select;
      - "Confirm the rest as proposed" asks to confirm: "Confirm all N remaining items as proposed? They will be marked as bulk-confirmed.";
      - the no-clean-match bundles appear in a separate list with the AI note.
  - **Agreement panel** (under the Review queue tab): the counts table from `/agreement`, with the rough-percentages caveat and the "Nothing is auto-confirmed" line.
  - **Errors:** a failed request shows the API's `error` text inline next to the control, e.g. "Couldn't confirm: blind sample not submitted". No toasts, no silent failure.
  - **Fetch rules:** every fetch uses the slug in the query (GET) or body (POST), never an `Authorization` header (see the comment in `app/admin/access/AccessPanel.tsx`), and POSTs send `content-type: application/json`.
  - **Layout:** Tailwind classes consistent with `AccessPanel.tsx`. Readable at 390 px width, with no horizontal page scroll; wide tables scroll inside their own container.

- [ ] **Step 1: Write failing component tests,** with `fetch` mocked and the same render approach as `app/admin/access/__tests__/AccessPanel.test.tsx`. Check that:
  - action buttons are disabled until a reviewer name is entered;
  - the reviewer name persists to `localStorage` and survives a remount;
  - a blind-locked bundle in the queue can't be opened and shows "Blind pick first";
  - Submit sends `{ slug, reviewer, picks: [{kind:'element', elementId, position}], noCleanMatch: false }` to `/api/admin/bundles/<id>/blind`;
  - "No clean match" disables the radios and sends `picks: []`, `noCleanMatch: true`;
  - grouped task rows send all of their member ids on Confirm;
  - an API 409 shows its error text;
  - the attribution text is rendered.

- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. **Step 4:** Run. Expect PASS.

- [ ] **Step 5:** Add `<Link href={\`/admin/bundles?slug=${encodeURIComponent(slug)}\`} className="text-blue-700 underline">Skill bundles</Link>` next to the other admin links in `app/admin/page.tsx`.

- [ ] **Step 6: Build and smoke-test against scratch.**
  - `DATABASE_URL="$(scripts/migrations/p2-scratch-db.sh url)" pnpm build` must succeed.
  - Pick a port: check `~/.dev-ports.yaml`, choose an unused port (not 3000), and confirm it is free with `lsof -iTCP:<port> -sTCP:LISTEN`.
  - Start `next start -p <port>` with the scratch `DATABASE_URL` in the background, and record the PID.
  - Load `/admin/bundles?slug=<scratch-valid slug>` with Playwright at 1200 px and at 390 px, and take screenshots.
  - Kill exactly that PID.
  - Attach the screenshots to the report. If auth makes this impractical against scratch, say so and give the reason; do not weaken auth to get a screenshot.

- [ ] **Step 7: Commit:** `feat(admin): /admin/bundles review page (cards, blind sample, review queue, agreement)`.

---

### Task 13: Verification, STATE.md, explainer

**Tier:** standard.

- [ ] **Step 1: Run the full gates:**
  - `pnpm exec tsc --noEmit -p .`;
  - eslint on the changed files only (the repo has pre-existing lint debt, so don't fix unrelated files);
  - `env -u DATABASE_URL pnpm vitest run` (full suite);
  - every P2 DB suite against the right clone: `p2-migration` on `url-pre`, everything else on `url`;
  - `next build` with the scratch `DATABASE_URL`.

  Record the pass/skip/fail counts.

- [ ] **Step 2: Scratch end-to-end rehearsal.** The controller runs the paid steps, or authorizes up to $5 of scratch spend in the dispatch; otherwise, skip the paid parts and say so.
  1. `load-onet --apply` (done in Task 3).
  2. `draft-bundle-cards --draft --out <scratchpad>/cards.json --max-cost 2`, then the controller fills `_approval` with "scratch rehearsal only", then `--apply --file ... --confirmed-by rehearsal`.
  3. `embed-items --apply`.
  4. `draw-golden-sample --seed rehearsal --apply`.
  5. `map-bundles-onet` dry run, then `--apply --max-cost 4`.
  6. One blind submit via the API on scratch.
  7. `bundle-agreement-report`.

  Record the counts and cost. **The rehearsal's review file is never committed.** The real review file is drafted against live in Task 15 ★2.

- [ ] **Step 3: Update `docs/STATE.md`:**
  - 0059 built, not applied;
  - the 8 tables;
  - the new AI function ids;
  - the routes `/admin/bundles` and `/api/admin/bundles/*`;
  - the scripts with their exact commands;
  - the attribution requirement;
  - **Deferred/debt:**
    - `centroid_distance` computation (Ruling 11);
    - a second blind reviewer's submission UI (Ruling 12);
    - in-page card editing;
    - course skills (P2b, plus the clustering discovery check already recorded);
    - ESCO;
    - deriving a bundle's depth from its members;
    - P3 weights;
  - the Rulings list, as one line each with a pointer to this plan.

- [ ] **Step 4: Update `docs/competency-catalog-deep-dive.html`,** in its "What comes next" section only. Replace the P2 paragraph with what P2 builds, stated as *built, not yet live* until Task 15 runs:
  - bundle cards;
  - core/related/fringe membership;
  - the blind sample;
  - the review page;
  - nothing auto-confirmed.

  No revision notes on the page. US spelling. The O*NET attribution already appears on the page; keep it.

- [ ] **Step 5: Commit:** `docs(p2): STATE + explainer for bundle membership (built, not applied)`.

---

### Task 14: Hostile adversarial review

**Tier:** most capable (Opus). Fresh context, scratch only, a verify-by-running mandate. Iterate to an honest ACCEPT. Fix rounds go back to the implementer, and each round gets a fresh reviewer.

The reviewer attacks, at minimum:
- **Blindness:** every route, every query and every error path. For example, does a 409 body, a search result or the list's counts leak a sampled-unsubmitted bundle's AI placements? Can a member action be applied to a blind-locked bundle by id?
- **Rerun safety:** can any path delete or alter a confirmed or rejected member, including reconcile, `set_position` on a decided row, a reload of the O*NET store (`load-onet --apply` after members exist: members must survive), and `--replace` on the draw?
- **No partial rows** after a mid-bundle failure (kill the process between the AI call and the write; force a CHECK violation).
- **Cost guard:** can a run exceed `--max-cost` by more than one call's estimate? Is `recordSpend` called for every paid call, including a call whose write then fails?
- **Strict schemas** for both AI functions under `AI_PROVIDER=openai` rules.
- **The migration's additivity claim:** does the currently deployed (pre-P2) code run unaffected against a post-0059 clone? Rehearse with a pre-P2 build if practical. Is the rollback's precondition correct?
- **Constraint-name drift** between SQL and Drizzle.
- **Agreement math:** recompute by hand on the seeded data. Is a task group counted once regardless of its member rows?
- **Attribution present** on the page, the report and the agreement API.

  Record each round's verdict and findings in STATE.md (one line per round, full report path in the SDD workspace), the same way P0b and P1 did. Then run the final whole-branch review (`superpowers:requesting-code-review`, most capable model), with one fix wave and a scoped re-review.

---

### Task 15: STOP: ask owner, then the live runbook

The controller runs this with the owner, not an implementer. **Each ★ is a separate explicit owner yes.** First, write this runbook into STATE.md as the authoritative copy, with absolute paths checked against the real checkouts that day, as P1's was.

Capture the live URL inline, never printed: `LIVE_URL="$(node "$HOME/.claude/dashboard/read-env.mjs" /Users/admin/projects/curriculum_developer-deploy DATABASE_URL)"`.

**Hard rule:** the deploy checkout is not pulled, fast-forwarded or rebuilt before step 4 has applied 0059. Same reasoning as P1, even though the old app is unaffected by 0059: the new build reads the new tables.

1. **Merge.** In the main checkout:

   ```bash
   set -euo pipefail
   cd /Users/admin/projects/curriculum_developer
   git checkout dev && git merge --no-ff feat/competency-catalog-p2 && git push origin dev
   SHA=$(git rev-parse HEAD); [ ${#SHA} -eq 40 ]; git push origin "$SHA:main"   # never `git checkout main` here
   git merge-base --is-ancestor feat/competency-catalog-p2 HEAD && echo OK
   ```

2. **Backup** (absolute path, after the merge):

   ```bash
   DUMP=$(DATABASE_URL="$LIVE_URL" /Users/admin/projects/curriculum_developer/scripts/migrations/p2-backup.sh --expect-db gc_curriculum)
   ```

3. **★1 Apply 0059** while the OLD app is serving:

   ```bash
   /Applications/Postgres.app/Contents/Versions/17/bin/psql "$LIVE_URL" -X -v ON_ERROR_STOP=1 -f /Users/admin/projects/curriculum_developer/drizzle/0059_competency_catalog_p2.sql
   ```

   Retry on a `lock_timeout`.

4. **Verify** (only meaningful immediately after the apply):

   ```bash
   /Applications/Postgres.app/Contents/Versions/17/bin/psql "$LIVE_URL" -X -v ON_ERROR_STOP=1 -f /Users/admin/projects/curriculum_developer/scripts/migrations/2026-10-13-p2-verify.sql
   ```

5. **Deploy:**

   ```bash
   cd /Users/admin/projects/curriculum_developer-deploy && git pull --ff-only && pnpm build && launchctl kickstart -k "gui/$(id -u)/com.gc.curriculum-tool"
   ```

   Confirm that the build ran before the kickstart. Then smoke-test `https://gcworkflow.clemson.edu:8443/admin/bundles?slug=…` (it should show "No confirmed cards yet") and check the app log for errors.

6. **Load element definitions,** from the deploy checkout: a dry run, then `--apply`.

   ```bash
   DATABASE_URL="$LIVE_URL" node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/onet/load-onet.ts --dir /Users/admin/projects/curriculum_developer/scratch/onet/31.0 --release 31.0 --expect-db gc_curriculum --apply
   ```

   Expect 161 definitions, with the occupation, rating and task counts unchanged (91 occupations, 1,961 task statements).

7. **★2 Cards:**
   - `draft-bundle-cards` dry run, then `--draft --out /Users/admin/projects/curriculum_developer/docs/superpowers/specs/<date>-bundle-cards.json --max-cost 2`;
   - commit the file, and the owner reviews it (the owner may edit any card or stratum in the file);
   - the controller records the approval text in `_approval` and commits it;
   - `--apply --file <that path> --confirmed-by <owner name>`.

8. **Embed:** `embed-items` dry run, then `--apply`. Free.

9. **Draw:** `draw-golden-sample --seed <owner-chosen word> --apply`. Record the seed and the 8 ids in STATE.md.

10. **★3 Mapping:**
    - run the `map-bundles-onet` dry run and show the owner the measured estimate;
    - on the owner's go, run `--apply --max-cost <owner-set dollars>`;
    - if it stops at the cap or any bundle fails, `--missing` continues, but only with a new owner go if more spend is needed.

11. **Handover:** the owner does the blind sample on `https://gcworkflow.clemson.edu:8443/admin/bundles?slug=…`, then the review queue, at their own pace. Run `bundle-agreement-report` against live after the blind sample, and record the figures in STATE.md.

12. **STATE.md:** mark P2 applied, with the date, the dump path, every count and the cost. Keep the P1 dump until P2 is verified live (the existing note), and keep the P2 dump until P3 is live.

**Rollback,** if needed after step 5:
1. Revert the deploy checkout to the pre-P2 commit, rebuild, and kickstart.
2. Then run the rollback by absolute path: `psql "$LIVE_URL" -X -v ON_ERROR_STOP=1 -f /Users/admin/projects/curriculum_developer/scripts/migrations/2026-10-13-p2-rollback.sql`. It refuses once any review work exists (Ruling 14). In that case, export first: `pg_dump -Fc -t 'bundle_*' -t item_embeddings -t onet_element_definitions` to a dated file. Then, with the owner's explicit yes, delete the review rows and rerun.

Restoring from the dump is never needed for a P2 rollback, because no pre-existing table is modified.

---

## Self-review

**Spec coverage**

| Spec section | Task(s) |
|---|---|
| §2.1 links only, weights in P3 | Scope (nothing weight-related); Task 13 Deferred/debt |
| §2.2 O*NET now, ESCO later; no-match list | Tasks 8–10 (derived `no_clean_match`), Task 9 report, Task 11/12 no-match list |
| §2.3 hybrid: all elements + task shortlist | Task 3 (definitions), Task 7 (shortlist), Task 8 (message) |
| §2.4 blind sample + review rest; nothing auto-confirmed | Tasks 7, 9, 11, 12; no auto-confirm path exists (reconcile confirms only on human agreement) |
| §2.5 reviewer recorded; second reviewer later | Ruling 2 (typed name); Ruling 12 (κ ready, UI deferred) |
| §2.6 two-level, both sides in the tables | Task 2 (`source` / `kind` enums include `course_skill`, `esco_skill`) |
| §2.7 centrality ≠ weight | No weight fields added; `position` only |
| §2.8 scoring unchanged | No scoring files touched |
| §3 data model (8 tables, fields, unique, no onet FK) | Task 2 (+ Rulings 3, 4, 9, 10, 11) |
| §4 A cards (review file, approval, confirmed only) | Task 5 |
| §4 B embeddings (text-hash cache, tasks + cards) | Task 6 |
| §4 C shortlist (top 25, grouping, top 50 for blind) | Tasks 6, 7 (Rulings 4, 5) |
| §4 D placement (strict schema, unknown drop, rerun safety, max-cost, dry-run estimate, per-bundle failure isolation, blind withheld) | Tasks 8, 10, 11 |
| §4 blind draw (8, seeded, stratified, ≥1 workflow/AI, recorded) | Task 7 (Ruling 3) |
| §4 element definitions through the existing loader | Task 3 |
| §5 page: auth, reviewer, attribution, three tabs, blindness server-side, lock + reset, reconcile, queue actions, bulk tag, progress, no-match list | Tasks 11, 12 (Rulings 1, 2, 8) |
| §6 measurement: precision, recall, position exact/within-one, shortlist recall, no-match, κ, counts first, caveat, no auto-confirm | Task 9 (report + pure lib), Task 11 (agreement route), Task 12 (panel) |
| §7 testing incl. red-proofs + hostile review | Tasks 1–12 tests; mandatory red-proofs in Tasks 9 (Step 6), 10 (Step 4), 11 (Step 1); Task 14 |
| §8 rollout, three owner gates, backup, verify, rollback | Task 15 (+ `p2-backup.sh` in Task 1, verify/rollback in Task 2) |
| §8 STATE.md + explainer update | Task 13 |
| §9 out of scope recorded | Task 13 Step 3 |
| §10 risks | Measured by Task 9; workload handled by per-bundle queue (Task 12) |

**Placeholder scan:** done.
- No "TBD" or "similar to Task N" without the code.
- Task 12's UI is specified by behavior plus tests, not full component code. This is deliberate: it is a standard-tier judgment task, and its contracts (routes and JSON shapes) are fully defined in Task 11.

**Type consistency:** checked across tasks.
- `Pos` / `BundlePosition`, `MemberRow`, `ReconcileResult`, `GoldenCandidate`, `TaskGroup`, `ShortlistEntry`, `CardFields` and `BundleSummary` all have one definition each, imported everywhere else.
- `TASK_SHORTLIST_K` lives in `map-bundle-onet.ts`, and `readAgreementInputs` imports it from there.
