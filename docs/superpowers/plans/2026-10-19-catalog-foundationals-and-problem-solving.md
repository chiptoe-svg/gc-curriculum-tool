# Catalog foundationals, communication split, and program-level problem solving — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the competency catalog hold D-only foundational competencies and a never-scored "derived" competency, add the 11 owner-approved competencies (10 + problem solving) and 2 descriptor revisions through a gated script, make capture record written and spoken communication separately, and publish problem solving as an evidence-profile wiki page.

**Architecture:** Migration 0060 adds `sub_competencies.foundational` and `.scoring` and makes K/U descriptors nullable under a CHECK. The coverage scorer reads the flags (null K/U for foundational; skips derived) and the stale-snapshot query ignores derived competencies. A new insert script applies the approved additions file. Capture's baseline foundational list becomes six. A pure page builder renders `competencies/problem-solving.md` from data the app already has (Area-7 bands, condition recurrence, D4+ technical coverage).

**Tech Stack:** Next.js 15, TypeScript strict, Drizzle + Postgres 17, Vitest, hand-written SQL migrations, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-10-19-catalog-foundationals-and-problem-solving-design.md`

## Global Constraints

- Never run anything that loads `.env.local` (it points at the LIVE DB). Run tests as `env -u DATABASE_URL DATABASE_URL="$(scripts/migrations/ca-scratch-db.sh url)" npx vitest run <files>`; pure tests as `env -u DATABASE_URL npx vitest run <files>`.
- No live DB write, deploy, or push to `main` in any task. Live steps are in Task 8's runbook and each needs the owner's yes in session.
- Foundational = D only: K and U descriptors and depths are **null**, never `''` and never `0` (KUD+ rule 2).
- `scoring = 'derived'` competencies are never sent to a scorer and never produce coverage rows.
- Stratum (card grouping) and `foundational` (D-only scoring) are independent: `ai-literacy` has stratum `foundational` and `foundational = false`.
- OpenAI strict-schema rule: every property listed in `required`; optional = nullable union.
- Scripts: `--expect-db` required, dry run by default, `--apply` to write, one transaction, never print `DATABASE_URL`.
- US spelling. No `pkill`/`killall` by pattern.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm`.

## Review Focus

1. A null K/U descriptor rendered as the literal text "null" or "undefined" (template strings in prompts, wiki, admin pages) — expected: the dimension is omitted or labeled "Do only". Pinned in Task 3.
2. The derived `problem-solving` competency making every snapshot permanently "stale" (refresh loops, "no competencies to score" failures) — expected: derived ids are invisible to staleness. Pinned in Task 4.
3. The model returning numbers for K/U on a foundational competency — expected: the cell is rejected (validate throws) rather than stored. Pinned in Task 4 (red-proofed).
4. An old snapshot with one "Communication" row next to new snapshots with Written/Spoken rows — expected: both validate and render in the course view and wiki. Pinned in Task 6.
5. New code deployed before 0060 is applied (columns missing) — expected: the runbook applies 0060 first, and old code keeps working on a migrated DB (new columns have defaults; dropped NOT NULL is invisible to old readers). Pinned in Task 2 (old-shape insert test) and Task 8 (runbook order).

## File Structure

| File | Responsibility |
|---|---|
| `scripts/migrations/ca-scratch-db.sh` (create) | Two scratch clones: `gc_curriculum_ca_scratch` (0060 applied) and `gc_curriculum_ca_pre` (kept pre-0060) |
| `tests/db/ca/scratch-guard.ts` (create) | `isCaScratchDb()`, `isCaPreDb()` |
| `drizzle/0060_catalog_foundationals.sql` (create) | The migration |
| `scripts/migrations/2026-10-19-ca-verify.sql`, `2026-10-19-ca-rollback.sql` (create) | Fail-closed verify; rollback |
| `lib/db/schema.ts` (modify) | `foundational`, `scoring`, nullable K/U |
| `lib/catalog/descriptors.ts` (create) | `formatDescriptorsForPrompt`, `isDerived` helpers shared by readers |
| readers found by `tsc` (modify) | null-safe K/U |
| `lib/ai/analyze/program-score-coverage.ts`, `lib/ai/prompts/program-score-coverage.md` (modify) | flag-driven foundational rule; derived skip |
| `lib/db/program-coverage-queries.ts` (modify) | staleness ignores derived |
| `app/api/program/coverage/refresh/route.ts`, `.../[snapshotId]/[targetId]/route.ts` (modify) | pass `foundational`, `scoring` |
| `scripts/catalog/insert-catalog-additions.ts` (create) | gated insert + descriptor revisions |
| `lib/ai/capture/schema.ts` + capture/explore prompts + `lib/ai/explore/scenario.ts` + `app/wiki/HowToRead.tsx` + `CLAUDE.md` (modify) | six baseline foundationals |
| `lib/program/problem-solving-profile.ts` (create) | pure evidence-profile builder + markdown renderer |
| `lib/db/problem-solving-queries.ts` (create) | loads the profile inputs |
| `scripts/wiki/write-problem-solving-page.ts` (create) | dry run / `--apply` writes the wiki page via `writeAndPush` |
| `lib/ai/wiki/refresh-all.ts` (modify) | regenerate the page on a full refresh |
| `scripts/migrations/2026-10-19-ca-live-apply.sh` (create) | owner-run live runbook |
| `lib/domain/seed-targets.ts`, `docs/STATE.md` (modify) | seed consistency; record |

---

### Task 1: Data files and scratch databases

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-catalog-additions.json`
- Modify: `docs/superpowers/specs/2026-10-15-bundle-cards.json`
- Create: `scripts/migrations/ca-scratch-db.sh`, `tests/db/ca/scratch-guard.ts`, `tests/db/ca/scratch-guard.test.ts`

**Interfaces:**
- Produces: additions file shape used by Task 5 (below); scratch DB names `gc_curriculum_ca_scratch`, `gc_curriculum_ca_pre`; `isCaScratchDb(): boolean`, `isCaPreDb(): boolean`, `CA_SCRATCH_DB`, `CA_PRE_DB`.

- [ ] **Step 1: Add expected prior text to each descriptor revision.** For `ai-tool-direction` and `quality-frameworks`, copy the current `knowDescriptor`, `understandDescriptor`, `doDescriptor` strings verbatim from `lib/domain/seed-targets.ts` (ids at lines ~294 and ~401) into new fields `priorKnowDescriptor`, `priorUnderstandDescriptor`, `priorDoDescriptor` on that revision object. Do not change any approved text.

- [ ] **Step 2: Promote problem solving.** Move the `proposedProgramLevel[0]` object into `newCompetencies` with these exact fields (keep its `name`, `doDescriptor`, `rationale`, `derivedFrom`):

```json
{ "id": "problem-solving", "name": "Problem solving in the discipline", "foundational": true, "scoring": "derived",
  "stratum": "foundational", "knowDescriptor": null, "understandDescriptor": null, "doDescriptor": "<unchanged>",
  "derivedFrom": "<unchanged>", "rationale": "<unchanged>" }
```
Add `"scoring": "direct"` to every other `newCompetencies` entry. Delete the now-empty `proposedProgramLevel` key. Append to `_note`: `"Problem solving approved for insert as scoring = derived (owner, 2026-10-19, \"2 yes\")."`

- [ ] **Step 3: Draft the problem-solving card** and insert it (sorted by `competencyId`) into the bundle-cards file. Set `_approval` in that file to `""` and add a top-level `"_pendingOwnerApproval": "problem-solving card drafted 2026-10-19 after the 45-card approval; the other 45 cards were approved (\"1 - approved\")."`. Card text:

```json
{
  "competencyId": "problem-solving",
  "name": "Problem solving in the discipline",
  "stratum": "foundational",
  "includes": "This bundle covers solving unfamiliar production, design and business problems in graphic communications by bringing organized domain knowledge to bear: diagnosing what is wrong, attempting a solution, learning from failed attempts and revising, across varied conditions. It is a program-level outcome, developed through repeated cycles of productive failure and structured reflection at increasing depth, and is not scored course by course.",
  "excludes": "Following a known procedure correctly belongs in the technical bundle for that procedure. Persisting through setbacks as a personal habit belongs in resilience, and going beyond requirements to find out how things work belongs in curiosity.",
  "distinctions": "Unlike the technical bundles, which each describe one area of skill, problem solving is what those skills become when students deploy them on unfamiliar problems. Unlike resilience and curiosity, which are habits, it is the capability those habits help build. Unlike a generic reasoning skill, it does not transfer apart from domain knowledge.",
  "positiveExamples": [
    "Diagnose why a packaging run shows an unfamiliar defect, test likely causes, and fix it.",
    "Work out a production approach for a job no standard workflow fits, learning from a failed first attempt.",
    "Reframe a client's problem after an initial solution fails and develop one that works."
  ],
  "negativeExamples": [
    "Calibrate a press to a known color target by following the standard procedure (belongs in color-management)",
    "Keep revising a design after several rounds of critique (belongs in resilience)",
    "Research how a printing process works beyond what the lab required (belongs in curiosity)"
  ]
}
```

- [ ] **Step 4: Write the scratch guard test** (`tests/db/ca/scratch-guard.test.ts`), mirroring `tests/db/p2/scratch-guard.test.ts`: with `DATABASE_URL` set to `.../gc_curriculum_ca_scratch`, `isCaScratchDb()` is true and `isCaPreDb()` false; with `.../gc_curriculum` (live name) both false; with an unparsable URL both false. Run it, see it fail (module missing).

- [ ] **Step 5: Implement** `tests/db/ca/scratch-guard.ts` by copying `tests/db/p2/scratch-guard.ts` with names `CA_SCRATCH_DB = 'gc_curriculum_ca_scratch'`, `CA_PRE_DB = 'gc_curriculum_ca_pre'`, functions `isCaScratchDb`, `isCaPreDb`. Run the test: PASS.

- [ ] **Step 6: Create** `scripts/migrations/ca-scratch-db.sh` by copying `scripts/migrations/p2-scratch-db.sh` and replacing the two DB names and the allowed-name check. Keep the drop-refusing `create`. Run `scripts/migrations/ca-scratch-db.sh create` and `create-pre` (reads live via pg_dump only).

- [ ] **Step 7: Validate both JSON files** with the app parser (new 46-card file must parse with `requireApproval: false`; ids = the file's own card ids):

```bash
cat > scripts/.tmp-validate.ts <<'EOF'
import { readFileSync } from 'node:fs';
import { parseCardsReviewFile } from '@/lib/catalog/bundles';
const j = JSON.parse(readFileSync('docs/superpowers/specs/2026-10-15-bundle-cards.json', 'utf8'));
const r = parseCardsReviewFile(j, new Set<string>(j.cards.map((c: any) => c.competencyId)), { requireApproval: false });
console.log('parsed', r.cards.length);
EOF
env -u DATABASE_URL node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/.tmp-validate.ts; rm -f scripts/.tmp-validate.ts
```
Expected: `parsed 46`.

- [ ] **Step 8: Commit** (`docs(catalog): additions file ready for insert; problem-solving card draft; ca scratch DBs`).

---

### Task 2: Migration 0060 and Drizzle schema

**Files:**
- Create: `drizzle/0060_catalog_foundationals.sql`, `scripts/migrations/2026-10-19-ca-verify.sql`, `scripts/migrations/2026-10-19-ca-rollback.sql`, `tests/db/ca-migration.test.ts`
- Modify: `lib/db/schema.ts:21-47`

**Interfaces:**
- Produces: columns `sub_competencies.foundational boolean NOT NULL DEFAULT false`, `sub_competencies.scoring text NOT NULL DEFAULT 'direct'`; constraints `sub_competencies_foundational_ku_check`, `sub_competencies_scoring_check`; Drizzle fields `foundational: boolean`, `scoring: 'direct' | 'derived'`, `knowDescriptor: string | null`, `understandDescriptor: string | null`.

- [ ] **Step 1: Write the migration test** (`tests/db/ca-migration.test.ts`), modeled on `tests/db/p2-migration.test.ts` (static file-exists tests always run; DB tests only when `isCaPreDb()`; each DB test runs migration body inside a client transaction and ROLLBACKs). Cases:
  - after the body: both columns exist; every pre-existing row has `foundational = false`, `scoring = 'direct'`; verify body runs without raising.
  - insert `foundational = true` with `know_descriptor = 'x'` → violates `sub_competencies_foundational_ku_check`.
  - insert `foundational = false` with `know_descriptor = NULL` → violates the same check.
  - insert `scoring = 'other'` → violates `sub_competencies_scoring_check`.
  - **old-shape insert** (Review Focus 5): `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor) VALUES ('ca-old-shape','n','k','u','d')` succeeds and reads back `foundational = false, scoring = 'direct'`.
  - rollback body after migration body: both columns gone, K/U NOT NULL again, and a second run of the migration body raises `0060: already applied` (run it twice in one tx using a SAVEPOINT).
  - rollback refuses (raises) when any row has `foundational = true` or `scoring = 'derived'` (it cannot restore NOT NULL over null descriptors).

Run: `env -u DATABASE_URL DATABASE_URL="$(scripts/migrations/ca-scratch-db.sh url-pre)" npx vitest run tests/db/ca-migration.test.ts` → FAIL (files missing).

- [ ] **Step 2: Write the migration:**

```sql
-- 0060_catalog_foundationals.sql — catalog learns D-only foundationals and derived (never-scored) competencies.
-- Spec: docs/superpowers/specs/2026-10-19-catalog-foundationals-and-problem-solving-design.md
-- Live order: backup -> apply (this file) -> verify -> THEN deploy the build that names the new columns.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sub_competencies' AND column_name = 'foundational') THEN
    RAISE EXCEPTION '0060: already applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sub_competencies' AND column_name = 'origin') THEN
    RAISE EXCEPTION '0060: precondition — 0058 is not applied';
  END IF;
END $$;
ALTER TABLE sub_competencies ADD COLUMN foundational boolean NOT NULL DEFAULT false;
ALTER TABLE sub_competencies ADD COLUMN scoring text NOT NULL DEFAULT 'direct';
ALTER TABLE sub_competencies ADD CONSTRAINT sub_competencies_scoring_check CHECK (scoring IN ('direct', 'derived'));
ALTER TABLE sub_competencies ALTER COLUMN know_descriptor DROP NOT NULL;
ALTER TABLE sub_competencies ALTER COLUMN understand_descriptor DROP NOT NULL;
ALTER TABLE sub_competencies ADD CONSTRAINT sub_competencies_foundational_ku_check
  CHECK (foundational = (know_descriptor IS NULL AND understand_descriptor IS NULL));
COMMIT;
```

- [ ] **Step 3: Write verify** (`2026-10-19-ca-verify.sql`) in the style of `2026-10-12-p1-verify.sql`: printed rows (columns exist; rows with `foundational` true; rows with `scoring` derived; both constraints present) then a `DO $$` block that RAISEs if a column or constraint is missing or any row violates `foundational = (know IS NULL AND understand IS NULL)`.

- [ ] **Step 4: Write rollback** (`2026-10-19-ca-rollback.sql`): one transaction; RAISE `rollback: 0060 is not applied` if `foundational` column is absent; RAISE `rollback: foundational or derived rows exist — delete the 2026-10-19 additions first` if any row has `foundational OR scoring = 'derived'`; then drop both constraints, `SET NOT NULL` on both descriptors, drop both columns. Header comment: revert the app to the pre-0060 build before running live (same reason as the P1 rollback's I-1 note).

- [ ] **Step 5: Update Drizzle** `lib/db/schema.ts` `subCompetencies`:

```ts
  knowDescriptor: text('know_descriptor'),            // null for foundational (D-only) rows — 0060
  understandDescriptor: text('understand_descriptor'), // null for foundational (D-only) rows — 0060
  ...
  foundational: boolean('foundational').notNull().default(false),
  scoring: text('scoring', { enum: ['direct', 'derived'] }).notNull().default('direct'),
```
and add to the table's constraint list:
```ts
  check('sub_competencies_scoring_check', sql`${t.scoring} IN ('direct', 'derived')`),
  check('sub_competencies_foundational_ku_check', sql`${t.foundational} = (${t.knowDescriptor} IS NULL AND ${t.understandDescriptor} IS NULL)`),
```

- [ ] **Step 6:** Apply 0060 to the main scratch: `psql "$(scripts/migrations/ca-scratch-db.sh url)" -v ON_ERROR_STOP=1 -f drizzle/0060_catalog_foundationals.sql` then the verify file (psql from `/Applications/Postgres.app/Contents/Versions/17/bin`). Run the migration test against `url-pre`: PASS.

- [ ] **Step 7: Commit** (`feat(catalog): migration 0060 — foundational flag, derived scoring, nullable K/U descriptors`). `pnpm tsc --noEmit` will now fail in readers; that is Task 3.

---

### Task 3: Null-safe descriptor readers

**Files:**
- Create: `lib/catalog/descriptors.ts`, `lib/catalog/__tests__/descriptors.test.ts`
- Modify: every file `pnpm tsc --noEmit` reports after Task 2 (expected set, from a grep of `knowDescriptor|understandDescriptor`: `lib/ai/analyze/{program-score-coverage,target-context,intended-skills-extract,prereq-edge-seed}.ts`, `lib/ai/synthesis/{prompt-builder,orchestrator}.ts`, `lib/ai/catalog/{draft-bundle-card,map-bundle-onet}.ts`, `lib/ai/schemas.ts`, `lib/catalog/bundles.ts`, `lib/db/{competency-catalog-queries,bundle-queries,career-targets-queries,scaffolding-queries}.ts`, `lib/domain/{types,target-batch}.ts`, `app/admin/bundles/BundlesPanel.tsx`, `app/admin/synthesis/targets/[targetId]/*`, `app/api/targets/[id]/**`, `app/api/program/coverage/refresh/**`, `scripts/{seed-career-targets,catalog/insert-business-acumen,reliability/*}.ts`).

**Interfaces:**
- Produces:
```ts
export type KudDescriptors = { knowDescriptor: string | null; understandDescriptor: string | null; doDescriptor: string };
/** Prompt/text lines for a competency's descriptors; null K/U are omitted and the competency is marked "Do only". Never emits "null"/"undefined". */
export function formatDescriptorLines(d: KudDescriptors): string[];
/** True when K and U are both null (a foundational, D-only competency). */
export function isDoOnly(d: Pick<KudDescriptors, 'knowDescriptor' | 'understandDescriptor'>): boolean;
```

- [ ] **Step 1: Failing tests** for `formatDescriptorLines`:
```ts
expect(formatDescriptorLines({ knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D' }))
  .toEqual(['Know: K', 'Understand: U', 'Do: D']);
const lines = formatDescriptorLines({ knowDescriptor: null, understandDescriptor: null, doDescriptor: 'D' });
expect(lines).toEqual(['Do only (foundational): D']);
expect(lines.join('\n')).not.toMatch(/null|undefined/);
expect(isDoOnly({ knowDescriptor: null, understandDescriptor: null })).toBe(true);
expect(isDoOnly({ knowDescriptor: 'K', understandDescriptor: null })).toBe(false);
```
Run: FAIL.

- [ ] **Step 2: Implement** `lib/catalog/descriptors.ts` to pass.

- [ ] **Step 3: Fix each tsc error.** Rules: widen types to `string | null` where data flows from the catalog; in prompts and text, use `formatDescriptorLines` or omit null fields; in JSON sent to a model, send `null` (not `""`); in React, render nothing for a null K/U (no "null", no empty label). Do not change behavior for non-null rows. `insert-business-acumen.ts` keeps requiring non-empty K/U for its own entries (its file has none null).

- [ ] **Step 4: Render test for one admin surface** (Review Focus 1): add a case to the existing BundlesPanel test (or create `app/admin/bundles/__tests__/BundlesPanel.test.tsx` if none) rendering a bundle with null K/U and asserting the rendered text contains neither "null" nor "undefined" and contains the D descriptor.

- [ ] **Step 5:** `pnpm tsc --noEmit` clean; `env -u DATABASE_URL npx vitest run lib tests/lib tests/ai app` green (DB-gated suites skip). Commit (`refactor(catalog): null-safe K/U descriptor readers`).

---

### Task 4: Scorer reads the flags; staleness ignores derived

**Files:**
- Modify: `lib/ai/analyze/program-score-coverage.ts`, `lib/ai/prompts/program-score-coverage.md:68-82`, `lib/db/program-coverage-queries.ts:256-260`, `app/api/program/coverage/refresh/route.ts:59-68`, `app/api/program/coverage/refresh/[snapshotId]/[targetId]/route.ts`, `scripts/reliability/{check,model-eval}.ts` (pass the new fields)
- Test: `lib/ai/analyze/__tests__/program-score-coverage.test.ts`, `lib/db/__tests__/program-coverage-queries.test.ts`

**Interfaces:**
- Consumes: Task 2 columns; Task 3 `string | null` descriptors.
- Produces: `ScoreCompetenciesInput.competencies[i]` gains `foundational: boolean; scoring: 'direct' | 'derived'`. `scoreSnapshotCompetencies` returns `{ result: { ...cells: [] }, model: provider.model, costUsdCents: 0 }` **without calling the provider** when no direct competencies remain.

- [ ] **Step 1: Failing tests** (fake provider, as the existing test file does):
  - derived competency is not in the user message and gets no cell; with only derived input, the provider is **never called** and cost is 0.
  - each competency in the user message carries `"foundational": true|false`.
  - a provider response giving `k_depth: 2` for a foundational competency makes `validate` throw (message contains the competency id and "foundational"); the same response for a non-foundational competency validates.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement:** filter `scoring === 'derived'` out first; include `foundational` in `competencyContext`; wrap `validate`:
```ts
const foundationalIds = new Set(direct.filter(c => c.foundational).map(c => c.id));
validate: (raw: unknown) => {
  const parsed = coverageResultSchema.parse(raw);
  for (const cell of parsed.cells) {
    if (foundationalIds.has(cell.competency_id) && (cell.k_depth !== null || cell.u_depth !== null)) {
      throw new Error(`coverage: foundational competency ${cell.competency_id} must have null k_depth and u_depth`);
    }
  }
  return parsed;
},
```
- [ ] **Step 4: Prompt** (`program-score-coverage.md`): replace the name-list rule with: "Each competency carries `foundational`. If `foundational` is true, score D only and return `k_depth` and `u_depth` as null (Agency, Attention to Detail, Resilience, Curiosity, Written Communication, Spoken Communication, Collaboration and Professional responsibility are examples). A snapshot row named plain **Communication** (captures before 2026-10-19) can match Written or Spoken Communication only as **Partial**, and the rationale says the capture did not separate the two." Keep the foundational-is-not-technical-supply paragraph.
- [ ] **Step 5: Staleness** — failing DB test (scratch, rolled-back tx): insert a derived competency; a snapshot with cells for every direct active competency is NOT returned by `listStaleSnapshots`, and no `missingCompetencyIds` ever contains the derived id. Implement: `.where(and(eq(subCompetencies.retired, false), eq(subCompetencies.scoring, 'direct')))`.
- [ ] **Step 6: Red-proof:** revert the derived filter and the validate wrapper one at a time; show the matching tests fail; restore. Record the red runs in the task report.
- [ ] **Step 7:** Routes and reliability scripts pass `foundational` and `scoring` from the catalog row. All tests green. Commit (`feat(coverage): scorer uses foundational flag, skips derived competencies`).

---

### Task 5: `insert-catalog-additions` script

**Files:**
- Create: `scripts/catalog/insert-catalog-additions.ts`, `tests/db/ca-insert-additions.test.ts`

**Interfaces:**
- Consumes: the additions file from Task 1; Task 2 columns.
- Produces: CLI `node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/catalog/insert-catalog-additions.ts --file <abs path> --expect-db <name> [--apply]`; exports `parseAdditions(json: unknown): Additions`, `applyAdditions(tx: Tx, a: Additions): Promise<{ inserted: string[]; revised: string[] }>`, `main(argv, deps)`. Exit codes follow `insert-business-acumen.ts`.

- [ ] **Step 1: Failing pure tests** for `parseAdditions`: refuses empty `_approval`; refuses a foundational entry with non-null K or U; refuses a non-foundational entry with null K or U; refuses `scoring` outside direct/derived; refuses a revision without all three `prior*` fields; accepts the real file (`docs/superpowers/specs/2026-10-19-catalog-additions.json`, 11 new, 2 revisions).
- [ ] **Step 2: Failing DB tests** (scratch, rolled-back tx, `isCaScratchDb()`): `applyAdditions` inserts all 11 with `origin = 'gc_authored'`, flags as in the file, and one identity `sub_competency_map` row each (old = new, `merge_note` null — same as `insertBusinessAcumen`); applies both revisions; refuses (throws, nothing written) when any new id already exists; refuses when a revision's current DB text differs from its `prior*` text, and the error prints both texts; no `career_target_requirements` rows are created.
- [ ] **Step 3: Implement**, reusing `assertExpectedDb`, `loadAppEnv`, `formatDbError` from `scripts/catalog/catalog-source.ts` and the arg/exit-code structure of `insert-business-acumen.ts`. Dry run prints what would be inserted/revised and writes nothing.
- [ ] **Step 4:** Run against the scratch for real: dry run, then `--apply --expect-db gc_curriculum_ca_scratch`; then `draft-bundle-cards --apply --file <cards file> --confirmed-by rehearsal --expect-db gc_curriculum_ca_scratch` with a temp copy of the cards file whose `_approval` is `"scratch rehearsal only"` (never commit that copy) → 46 cards upserted. Record outputs in the task report.
- [ ] **Step 5:** Commit (`feat(catalog): insert-catalog-additions script (gated, dry run default)`).

---

### Task 6: Capture records written and spoken communication separately

**Files:**
- Modify: `lib/ai/capture/schema.ts:81-87`, `lib/ai/analyze/capture-chat.ts:212` (list renders from the constant — verify), `lib/ai/analyze/capture-scores.ts:405-415`, `lib/ai/prompts/{capture-chat-agent,capture-synthesis,intended-skills-extract,explore-local-delta}.md`, `lib/ai/prompts/shared/depth-scale.md`, `lib/ai/explore/scenario.ts`, `app/wiki/HowToRead.tsx`, `CLAUDE.md` (Framework rule 2 list)
- Test: `lib/ai/capture/__tests__/schema.test.ts` (or the existing capture schema test file), `lib/ai/analyze/__tests__/capture-chat*.test.ts`

**Interfaces:**
- Produces: `baselineFoundationalCompetencies = ['Agency', 'Attention to Detail', 'Resilience', 'Curiosity', 'Written Communication', 'Spoken Communication'] as const`.

- [ ] **Step 1: Failing tests:** the constant has six entries including both communication names and not plain `Communication`; the capture chat system prompt lists both; a pre-2026-10-19 profile fixture with one foundational `Communication` row still parses with `captureProfileSchema` (Review Focus 4); `grep -rn "Curiosity, Communication" lib/ai/prompts` returns nothing (assert via reading the prompt files in the test).
- [ ] **Step 2: Implement.** In `capture-chat-agent.md` §6 replace the Communication probe with two:
  - *Written Communication:* "What graded writing do students produce — briefs, reports, specifications, reflections — and does the rubric assess the writing itself, not only the content?"
  - *Spoken Communication:* "Where do students present, critique or explain out loud, and is that speaking graded on its own criteria?"
  Everywhere a prompt says "five baseline foundationals", say "six". `capture-synthesis.md` item 2 lists all six as required.
- [ ] **Step 3: Rendering check** (Review Focus 4): add a test for the course view component used by `/view/[code]` (`app/view/[code]/CapturedView.tsx`) rendering one old snapshot (plain Communication) and one new (Written + Spoken): all rows appear, none blank.
- [ ] **Step 4:** Tests green; commit (`feat(capture): record written and spoken communication separately`).

---

### Task 7: Problem-solving evidence-profile page

**Files:**
- Create: `lib/program/problem-solving-profile.ts`, `lib/program/__tests__/problem-solving-profile.test.ts`, `lib/db/problem-solving-queries.ts`, `scripts/wiki/write-problem-solving-page.ts`
- Modify: `lib/ai/wiki/refresh-all.ts` (call the writer once per full refresh)

**Interfaces:**
- Consumes: `problemSolvingBand(block: Area7Block)` from `lib/program/problem-solving-band.ts`; `pfForSnapshot(createdAt, block)` from `lib/db/scaffolding-queries.ts`; `writeAndPush` from `lib/wiki/git-ops.ts`.
- Produces:
```ts
export interface PsCourseInput { courseCode: string; courseTitle: string; level: number; area7: Area7Block | null }
export interface PsDepthInput { competencyId: string; competencyName: string; courseCode: string; dDepth: number }
export interface ProblemSolvingProfile {
  bands: Record<'none' | 'slight' | 'moderate' | 'significant' | 'no_data', string[]>; // course codes
  conditionCounts: Record<'generate_then_consolidate' | 'open_ended_problems' | 'revision_cycles' | 'structured_post_mortem' | 'abstraction_bridging',
    { present: number; partial: number; absent: number; unassessed: number }>;
  d4ByCompetency: Array<{ competencyId: string; competencyName: string; courses: string[] }>; // dDepth >= 4, technical (non-foundational, direct) only
  coursesWithData: number;
}
export function buildProblemSolvingProfile(courses: PsCourseInput[], depths: PsDepthInput[]): ProblemSolvingProfile;
export function renderProblemSolvingPage(p: ProblemSolvingProfile, generatedAt: Date): string; // markdown with frontmatter type: competency, slug: problem-solving
```

- [ ] **Step 1: Failing tests:** band bucketing (a null `area7` → `no_data`, never `none`); condition counts (missing `abstraction_bridging` → `unassessed`, never `absent`); D4 list excludes `dDepth` 3 and groups by competency; the rendered page contains the frontmatter `slug: problem-solving`, says "program-level" and "not scored course by course", contains **no** `K\d|U\d|D\d` score token for problem solving itself, and names courses as wikilinks (`[[gc-3460]]`); an empty input renders a page that says no captured course has condition data yet (not an error).
- [ ] **Step 2: Implement** the pure builder and renderer. Page sections: Definition (the D descriptor and the derivedFrom text), How the program builds it (band counts with course links), Which conditions recur (a table of the five conditions with present/partial counts), Where students reach adaptive depth (D4+ by technical competency), How to read this (one paragraph: an evidence profile, no single score, link to `/program/scaffolding`).
- [ ] **Step 3: Query** `loadProblemSolvingInputs(executor = db)`: latest non-retired snapshot per course, `PROGRAM_VISIBLE_SQL` scope (same as `listStaleSnapshots`), `area7 = pfForSnapshot(created_at, profile.audit_notes?.productive_failure_conditions ?? null)`; depths from `snapshot_competency_coverage` joined to `sub_competencies` where `foundational = false AND scoring = 'direct' AND retired = false AND d_depth >= 4` for those snapshots. DB test on scratch (read-only).
- [ ] **Step 4: Script** `write-problem-solving-page.ts`: dry run prints the markdown; `--apply` calls `writeAndPush({ pages: [{ path: 'competencies/problem-solving.md', content }], logEntry, commitMessage })`. Hook the same writer into `refresh-all.ts` after the competency pages (guarded: skip with a log line when the catalog has no `problem-solving` row).
- [ ] **Step 5:** Tests green; commit (`feat(wiki): problem-solving evidence-profile page`).

---

### Task 8: Seed, STATE, live runbook

**Files:**
- Modify: `lib/domain/seed-targets.ts` (the two revised AI descriptors, verbatim from the additions file), `docs/STATE.md`
- Create: `scripts/migrations/2026-10-19-ca-live-apply.sh`

- [ ] **Step 1:** Update the two descriptors in `seed-targets.ts`; run its tests.
- [ ] **Step 2: Runbook** (`set -euo pipefail`, each step prints what it will do and waits for `read -r -p "type yes: "`; never prints the DB URL):
  1. `pg_dump -Fc` backup to `~/.local/share/gc-curriculum-tool/ca/pre-apply-<UTC>.dump` and `pg_restore --list` check.
  2. Apply `drizzle/0060_catalog_foundationals.sql`; run the verify file.
  3. Stop: "Deploy the build now (deploy chain), then press enter."
  4. `insert-catalog-additions` dry run, then `--apply --expect-db gc_curriculum`.
  5. `draft-bundle-cards --apply --file docs/superpowers/specs/2026-10-15-bundle-cards.json --confirmed-by <owner> --expect-db gc_curriculum` (refuses unless the file's `_approval` is set — the problem-solving card needs the owner's approval first).
  6. `write-problem-solving-page.ts --apply`.
  7. Print: "Coverage rescoring for the new competencies is a separate paid step — estimate first."
- [ ] **Step 3: STATE.md:** Schema (0060), scripts, AI behavior (`program-score-coverage` flag rule, derived skip), capture change (six baseline foundationals), the new wiki page, and **Deferred/debt**: (a) numeric problem-solving score deferred to P3; (b) `/program` matrices do not yet show unlinked catalog competencies — derived handling there comes with P3 links; (c) `docs/background.html` still names five foundationals — update in the next research-page revision; (d) existing snapshots keep a single Communication row until recaptured.
- [ ] **Step 4:** Commit (`docs(state): catalog foundationals, communication split, problem-solving page; live runbook`).

---

## After all tasks

Hostile adversarial review of the whole branch (fresh context, verify-by-running) to an honest ACCEPT — the migration alters NOT NULL on a live table and the scorer gate guards stored data — then the final whole-branch review, then merge to `dev`. Live steps only through Task 8's runbook with the owner's yes.
