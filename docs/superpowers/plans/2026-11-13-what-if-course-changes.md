# What-If Course Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** draft for the owner's review, 2026-11-13. Design approved by the owner 2026-11-13. Nothing built.

**Goal:** A faculty member sketches a change to an approved course in conversation (with attached documents and images) and gets a what-if page — the course as it would be, with predicted ratings and the effect on neighboring courses — without touching anything that describes the real course. The Explore chat page is retired in the same release.

**Architecture:** A what-if lives in three new tables (record, messages, attachments) and one new code area, `lib/what-if/`. One AI call estimates what moves; code builds the what-if profile from the approved snapshot plus that estimate, and code computes the effects on later courses, earlier courses and career targets. A second AI call writes prose only; every rating and effect line on the page is rendered from the stored record. All writes go through one new access rule and a per-what-if owner check.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle on Postgres 17, Zod, Vitest, the existing provider layer (`lib/ai/provider.ts`), `extractText` + Docling for attachments.

**Spec:** [`docs/superpowers/specs/2026-11-13-what-if-course-changes-design.md`](../specs/2026-11-13-what-if-course-changes-design.md) — read it before any task; it is the authority where this plan is silent.

## Global Constraints

- **The invariant:** "At every instant, the stores that describe the real course are byte-for-byte what they would have been had no what-if ever existed." The stores: approved snapshots, the working draft, the saved interview conversation and its messages, course materials and their search index entries, coverage and prerequisite data, the wiki repository and its public copy.
- A what-if never writes a row to an existing course table and is never added to the shared search index. What-if code must not call `insertMaterial`, `supersedeOlderSyllabi`, `enqueue`, `finalizeExtraction`, `saveTurn`, `saveScenario`, `persistAnalyzeRun`, or anything in `lib/capture/vector-store.ts` or `lib/wiki/git-ops.ts` other than `readWikiPage`. Reading is unrestricted.
- Every rating, table and effect line shown comes from the stored what-if record. The AI writes prose only and never states a rating.
- Untouched ratings keep the approved values exactly. Moved and new ratings are predictions and are marked as such in words, not by color alone.
- OpenAI strict schemas: every property listed in `required`, `additionalProperties: false`, optional fields as nullable unions — recursively, including array `items`.
- No destructive migration. `course_explore_scenarios` stays in place, unused.
- Tests run as `env -u DATABASE_URL pnpm vitest run <path>`. Database tests run only against the scratch database: `DATABASE_URL="$(scripts/migrations/whatif-scratch-db.sh url)" pnpm vitest run tests/db/whatif` (the `url` output is used only inside `$(...)`, never printed). Nothing in the build touches the live database.
- No paid AI call during the build: tests use the `fake` provider or a mocked `getProviderForFunction`.
- Work happens on branch `feat/what-if` in its own git worktree. No push, merge, deploy or live migration without the owner's yes.
- A commit that adds a route, table, AI function id or access rule updates `docs/STATE.md` in the same commit. A decision to defer something goes into STATE.md **Deferred / debt** in that commit.
- US spelling and plain language in all copy. The wording of the start control, the banner and the "predicted" label is drafted in the build and shown to the owner before shipping.
- Public pages (`/`, `/view/*`, `/wiki/*` without faculty access) and the wiki repository are not changed. `/ask` and the wiki chat panel behave exactly as before.
- Retiring Explore is the last code task.

## Builder's calls (the spec left these open)

- **Names:** tables `course_what_ifs`, `course_what_if_messages`, `course_what_if_attachments`; routes under `/api/explore/[code]/what-ifs`; pages `/explore/[code]` (list), `/explore/[code]/what-ifs/[id]` (page), `/explore/[code]/what-ifs/[id]/talk` (conversation); AI functions `what-if-agent` (role `converse`), `what-if-estimate` (`judge`), `what-if-page` (`write`).
- **A new assistant**, not a mode of the interview assistant, and **a new thin chat panel**, not a mode of `CaptureChatPanel` — the interview's panel and route write the real course's conversation.
- **`base_snapshot_id` is `ON DELETE SET NULL`.** A course reset deletes snapshot rows (`lib/capture/run-course-reset.ts:96`); a blocking key would make a what-if change real-course behavior. A what-if whose base is gone stays readable with a notice and refuses update.
- **The estimate never supplies "before" values.** Code reads them from the approved profile.
- **Attachment text reaches the assistant and the estimate in full** (bounded at 120,000 characters across a what-if, oldest first, truncation stated), not by lookup and never through the shared search index. Attachments are read inside the upload request.
- **Effects are a new module** (`lib/what-if/knock-on.ts`), not edits to `lib/ai/explore/ripple.ts` and `career-fit.ts`, so the Explore tests stay green until retirement. Each later course is checked with **all** of its confirmed prerequisites, so a gap is not reported as opened while another prerequisite still delivers it. Career-target moves are reported in both directions (the existing engine reports upward only; a what-if rating can go down).
- **Department-login ownership** is stored as `builtin:<role>` without the credential fingerprint, so a password change does not orphan what-ifs.
- **The assistant's opening line is fixed copy** shown by the panel, not an AI call.
- **Cost** is recorded with `recordSpend` (daily cap) and summed on the what-if record's `usage` column. No write to any existing run table.

## Review Focus

1. **A later course with a second prerequisite that still delivers the competency** — the page must not say the what-if opens a gap there. Pinned in Task 6.
2. **The department password changes after a what-if was started** — anyone on the department login can still continue, rename and delete it. Pinned in Task 2.
3. **An attachment that screening holds back or that cannot be read** — its text never reaches the assistant or the estimate; the author sees why; the assistant is told a file failed. Pinned in Tasks 4 and 7.
4. **The base version is deleted by a course reset** (not merely withdrawn) — the reset succeeds, the what-if still opens with a notice, update is refused. Pinned in Tasks 1 and 8.
5. **The daily cap is reached, or the writing call fails, between the estimate and the page text** — no half-written page; the previous page stays exactly as it was. Pinned in Task 8.

## File map

| Path | Responsibility |
|---|---|
| `drizzle/0066_what_ifs.sql`, `lib/db/schema.ts` | the three tables |
| `lib/what-if/types.ts` | shared types (below) |
| `lib/db/what-if-queries.ts` | every read and write of the three tables |
| `lib/auth/authorize.ts` | the `what-if-write` rule |
| `lib/what-if/ownership.ts`, `lib/what-if/route-guard.ts` | who owns, who may manage or read; one guard every route calls |
| `lib/what-if/attachments.ts` | read, screen and store an attachment |
| `lib/what-if/estimate-schema.ts`, `lib/what-if/estimate.ts`, `lib/ai/prompts/what-if-estimate.md` | the estimate AI function |
| `lib/what-if/profile.ts` | approved profile + estimate → what-if profile |
| `lib/what-if/knock-on.ts`, `lib/what-if/neighbors.ts` | effects on later courses, earlier courses, career targets |
| `lib/what-if/agent.ts`, `lib/what-if/agent-tools.ts`, `lib/ai/prompts/what-if-agent.md` | the assistant |
| `lib/what-if/page-prose.ts`, `lib/ai/prompts/what-if-page.md`, `lib/what-if/create-page.ts` | page text and the create/update sequence |
| `app/api/explore/[code]/what-ifs/**` | routes |
| `app/explore/[code]/**` | list, page, conversation |

### Shared types — `lib/what-if/types.ts` (created in Task 1; every later task imports from here)

```ts
export type Kud = { k: number | null; u: number | null; d: number | null };
export type Confidence = 'low' | 'medium' | 'high';
export type OwnerKind = 'personal' | 'department';
export interface PredictedSubCompDepth { subCompetencyId: string; k: number | null; u: number | null; d: number | null }

export interface WhatIfEstimate {
  changeItems: Array<{ kind: 'added' | 'removed' | 'changed'; description: string }>;
  movedRatings: Array<{ statement: string; after: Kud; confidence: Confidence; reason: string }>;
  newCompetencies: Array<{ statement: string; type: 'technical' | 'foundational'; predicted: Kud;
    subCompetencyId: string | null; confidence: Confidence; reason: string }>;
  incomingChanges: Array<{ kind: 'new' | 'raised' | 'dropped'; statement: string;
    expected: Kud | null; subCompetencyId: string | null }>;
}

export interface WhatIfRating {
  statement: string;
  type: 'technical' | 'foundational';
  status: 'approved' | 'moved' | 'new';
  kud: Kud;                        // what the page shows
  before: Kud | null;              // approved values; null when status is 'new'
  confidence: Confidence | null;   // null when status is 'approved'
  reason: string | null;
  subCompetencyId: string | null;  // set only for a linked 'new' rating
  linked: boolean;                 // false for a 'new' rating with no valid catalog link
}
export interface WhatIfProfile {
  ratings: WhatIfRating[];
  incomingChanges: Array<WhatIfEstimate['incomingChanges'][number] & { linked: boolean }>;
}

export interface KnockOn {
  laterCourses: Array<{ courseCode: string; subCompetencyId: string; label: string; effect: 'closed' | 'opened' }>;
  earlierCourses: Array<{ statement: string; label: string | null;
    status: 'met' | 'not_met' | 'not_known'; deliveredBy: string[] }>;
  careerTargets: Array<{ targetName: string; label: string; before: string; after: string; direction: 'up' | 'down' }>;
  notComputed: string[];           // statements for which no effects could be computed
}
export interface WhatIfProse { description: string; whatChanges: string; neighbors: string; questions: string[] }

export type UsageKind = 'chat' | 'quick_estimate' | 'estimate' | 'page';
export type WhatIfUsage = Partial<Record<UsageKind,
  { calls: number; costUsdCents: number; promptTokens: number; completionTokens: number }>>;
```

---

### Task 1: Tables, queries and the scratch database

**Files:**
- Create: `drizzle/0066_what_ifs.sql`, `lib/what-if/types.ts`, `lib/db/what-if-queries.ts`, `scripts/migrations/whatif-scratch-db.sh`, `tests/db/whatif/scratch-guard.ts`
- Modify: `lib/db/schema.ts` (add after `courseExploreScenarios`, ~1303)
- Test: `tests/db/whatif/what-if-queries.test.ts`

**Interfaces — Produces** (every function takes a last parameter `ex: Tx | typeof db = db`, as `getMatrixData` does):

```ts
export type WhatIfRow = typeof courseWhatIfs.$inferSelect;
export type WhatIfMessageRow = typeof courseWhatIfMessages.$inferSelect;
export type WhatIfAttachmentRow = typeof courseWhatIfAttachments.$inferSelect;
createWhatIf(input: { courseCode: string; baseSnapshotId: string; ownerGrantId: string; ownerKind: OwnerKind; authorName: string }): Promise<WhatIfRow>
getWhatIf(id: string): Promise<WhatIfRow | null>
listWhatIfsForCourse(courseCode: string): Promise<WhatIfRow[]>            // newest first, with and without a page
countWhatIfsByCourse(): Promise<Map<string, number>>                      // only those with a page
renameWhatIf(id: string, title: string): Promise<void>
saveWhatIfPage(id: string, page: { title: string | null; summary: string; estimate: WhatIfEstimate; profile: WhatIfProfile; knockOn: KnockOn; prose: WhatIfProse }): Promise<void>
addWhatIfUsage(id: string, kind: UsageKind, t: { costUsdCents: number; promptTokens: number; completionTokens: number }): Promise<void>
deleteWhatIf(id: string): Promise<WhatIfAttachmentRow[]>                  // returns the attachment rows so the caller can remove files
appendWhatIfMessage(whatIfId: string, role: 'user' | 'assistant', content: string, meta?: Record<string, unknown>): Promise<WhatIfMessageRow>
listWhatIfMessages(whatIfId: string): Promise<WhatIfMessageRow[]>         // oldest first
insertWhatIfAttachment(row: Omit<WhatIfAttachmentRow, 'id' | 'createdAt'>): Promise<WhatIfAttachmentRow>
listWhatIfAttachments(whatIfId: string): Promise<WhatIfAttachmentRow[]>
listActiveSubCompetencies(): Promise<Array<{ id: string; name: string }>> // sub_competencies where retired = false
```

**Columns.** `course_what_ifs`: `id` uuid pk default random; `course_code` text not null → `courses.code` ON DELETE CASCADE; `base_snapshot_id` uuid null → `course_capture_snapshots.id` ON DELETE SET NULL; `owner_grant_id` text not null; `owner_kind` text not null check in (`personal`, `department`); `author_name` text not null; `title` text; `summary` text; `estimate`, `profile`, `knock_on`, `prose` jsonb null (typed with the shared types); `usage` jsonb not null default `'{}'`; `page_created_at` timestamptz; `created_at`, `updated_at` timestamptz not null default now(). Index on `course_code`.
`course_what_if_messages`: `id` uuid pk; `what_if_id` uuid not null → cascade; `role` text check in (`user`, `assistant`); `content` text not null; `meta` jsonb; `created_at`. Index on `(what_if_id, created_at)`.
`course_what_if_attachments`: `id` uuid pk; `what_if_id` uuid not null → cascade; `file_name`, `mime_type` text not null; `size_bytes` integer not null; `blob_url` text not null; `status` text check in (`ok`, `failed`, `held_back`); `held_back_reason` text; `ferpa_risk` text; `extracted_text` text; `created_at`.

- [ ] **Step 1:** Write `scripts/migrations/whatif-scratch-db.sh` (`create` / `url` / `drop` for database `gc_curriculum_whatif_scratch`) by copying `scripts/migrations/p2-scratch-db.sh` and changing only the database name. `create` reads live with `pg_dump` only and refuses if the database exists. Write `tests/db/whatif/scratch-guard.ts` exporting `isWhatIfScratchDb()` on the pattern of `tests/db/p2/scratch-guard.ts`.
- [ ] **Step 2:** Write the failing test (`// @vitest-environment node`, `describe.runIf(isWhatIfScratchDb())`, each case inside a rolled-back transaction as in `tests/db/blind-list-detail.test.ts`):

```ts
it('a new what-if has no page and is not counted', async () => {
  const w = await createWhatIf({ courseCode, baseSnapshotId, ownerGrantId: 'g1', ownerKind: 'personal', authorName: 'A' }, tx);
  expect(w.pageCreatedAt).toBeNull();
  expect((await countWhatIfsByCourse(tx)).get(courseCode) ?? 0).toBe(0);
});
it('saving a page sets page_created_at and counts it', …toBe(1));
it('addWhatIfUsage sums calls, cost and tokens per kind', … usage.estimate → { calls: 2, costUsdCents: 7, promptTokens: 300, completionTokens: 40 });
it('deleting the base snapshot succeeds and leaves the what-if with no base', async () => {
  await tx.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.id, baseSnapshotId));
  expect((await getWhatIf(w.id, tx))!.baseSnapshotId).toBeNull();
});
it('deleteWhatIf removes messages and attachments and returns the attachment rows', …);
it('deleting the course removes its what-ifs', …);
```

- [ ] **Step 3:** Run `scripts/migrations/whatif-scratch-db.sh create`, then the database test command. Expected: FAIL — `relation "course_what_ifs" does not exist` (or the module is missing).
- [ ] **Step 4:** Write `drizzle/0066_what_ifs.sql` in the style of `0065_interview_loop.sql`: header comment with the live order ("backup -> apply (this file) -> verify the three tables -> deploy the build"), `BEGIN; SET LOCAL lock_timeout = '5s';`, a `DO $$` guard raising `'0066: already applied'` if `course_what_ifs` exists, the three `CREATE TABLE`s and indexes, `COMMIT;`. Add the Drizzle definitions, `lib/what-if/types.ts` (the block above, verbatim) and the query module.
- [ ] **Step 5:** Apply to scratch only: `psql "$(scripts/migrations/whatif-scratch-db.sh url)" -v ON_ERROR_STOP=1 -f drizzle/0066_what_ifs.sql`. Run it a second time. Expected: second run fails with `0066: already applied`.
- [ ] **Step 6:** Run the database test command. Expected: PASS. Run `env -u DATABASE_URL pnpm test`. Expected: the whole suite green (the new file skips).
- [ ] **Step 7:** Add the three tables and migration 0066 ("written, not applied live") to `docs/STATE.md`. Commit: `feat(what-if): tables, queries and scratch database (migration 0066, not applied live)`.

### Task 2: The access rule and ownership

**Files:**
- Modify: `lib/auth/authorize.ts`; `docs/STATE.md:345` (scope table: add the what-if row)
- Create: `lib/what-if/ownership.ts`, `lib/what-if/route-guard.ts`
- Test: `tests/auth/authorize.test.ts` (add cases), `tests/lib/what-if/ownership.test.ts`, `tests/lib/what-if/route-guard.test.ts`

**Interfaces:**
- Consumes: `Grant`, `classify`, `authorize` (`lib/auth/authorize.ts`); `authorizeRequest` (`lib/auth/route-auth.ts`); `getWhatIf`, `WhatIfRow` (Task 1).
- Produces:

```ts
// authorize.ts — Kind gains: | { kind: 'what-if-write' }
// ownership.ts
ownerOf(grant: Grant): { ownerGrantId: string; ownerKind: OwnerKind }
canManageWhatIf(grant: Grant, w: Pick<WhatIfRow, 'ownerGrantId' | 'ownerKind'>): boolean
canReadWhatIf(grant: Grant, w: Pick<WhatIfRow, 'ownerGrantId' | 'ownerKind' | 'pageCreatedAt'>): boolean
// route-guard.ts
guardWhatIf(req: Request, code: string, id: string, need: 'read' | 'manage'):
  Promise<{ grant: Grant; whatIf: WhatIfRow; response?: undefined } | { response: Response }>
```

- [ ] **Step 1:** Add the failing cases to `tests/auth/authorize.test.ts` (fixtures `scoped`, `creator`, `admin` already exist; add `noCourses = { id: 'p2', label: 'x', scope: [], can: ['capture'] }`):

```ts
const W = '/api/explore/GC%203730/what-ifs';
const ID = `${W}/8b1f0c2e-0000-4000-8000-000000000001`;
it.each([['POST', W], ['PATCH', ID], ['DELETE', ID], ['POST', `${ID}/chat`], ['POST', `${ID}/attachments`], ['POST', `${ID}/page`]])(
  '%s %s is a what-if write', (m, p) => expect(classify(m, p)).toEqual({ kind: 'what-if-write' }));
it.each([['GET', W], ['GET', ID], ['GET', `${ID}/messages`]])('%s %s is a read', (m, p) => expect(classify(m, p)).toEqual({ kind: 'read' }));
it('a login scoped to one course may start a what-if on another', () =>
  expect(authorize(scoped, 'POST', '/api/explore/GC%204400/what-ifs')).toEqual({ ok: true }));
it.each([creator, noCourses])('a create-only or no-course login is refused', g =>
  expect(authorize(g, 'POST', W)).toEqual({ ok: false, reason: 'needs-capture' }));
it.each([['POST', '/api/explore/GC%203730/chat'], ['POST', `${ID}/anything-else`], ['POST', `${W}x`]])(
  '%s %s keeps the course-write rule', (m, p) => expect(classify(m, p)).toEqual({ kind: 'course-write', code: 'GC 3730' }));
```

- [ ] **Step 2:** Write `ownership.test.ts`:

```ts
const dept = (fp: string): Grant => ({ id: `builtin:faculty:${fp}`, label: 'Department login', scope: ['*'], can: ['capture', 'create'] });
expect(ownerOf(dept('aaaaaaaaaaaaaaaa'))).toEqual({ ownerGrantId: 'builtin:faculty', ownerKind: 'department' });
expect(ownerOf(scoped)).toEqual({ ownerGrantId: scoped.id, ownerKind: 'personal' });
const w = { ...ownerOf(dept('aaaaaaaaaaaaaaaa')) };
expect(canManageWhatIf(dept('bbbbbbbbbbbbbbbb'), w)).toBe(true);    // Review Focus 2
expect(canManageWhatIf(scoped, w)).toBe(false);
expect(canManageWhatIf(admin, w)).toBe(true);
expect(canManageWhatIf({ ...scoped, id: 'other' }, { ownerGrantId: scoped.id, ownerKind: 'personal' })).toBe(false);
expect(canReadWhatIf(scoped, { ...w, pageCreatedAt: new Date() })).toBe(true);
expect(canReadWhatIf(scoped, { ...w, pageCreatedAt: null })).toBe(false);
```

- [ ] **Step 3:** Write `route-guard.test.ts` (mock `authorizeRequest` and `getWhatIf`): no grant → the 401 response passed through; what-if missing, or its `courseCode` differs from `code` → 404; `need: 'manage'` and not manager → 403; `need: 'read'`, no page, not manager → 404; otherwise `{ grant, whatIf }`.
- [ ] **Step 4:** Run `env -u DATABASE_URL pnpm vitest run tests/auth/authorize.test.ts tests/lib/what-if`. Expected: FAIL (new cases only; every existing case still passes).
- [ ] **Step 5:** Implement. In `classify()`, before the `COURSE_WRITE_PREFIXES` fall-through, a non-GET path matching `^/api/explore/[^/]+/what-ifs(?:/[^/]+(?:/(?:chat|attachments|page))?)?$` returns `{ kind: 'what-if-write' }`. In `authorize()`, that kind is allowed when `grant.can.includes('capture') && grant.scope.length > 0`, else `{ ok: false, reason: 'needs-capture' }`; the course is not checked against scope. `ownerOf`: an id starting `builtin:` keeps its first two segments and is `department`; anything else is `personal` with the full id. Nothing else in the table changes.
- [ ] **Step 6:** Run the same command, then `env -u DATABASE_URL pnpm vitest run tests/auth tests/middleware.test.ts`. Expected: PASS, no existing case changed.
- [ ] **Step 7:** Commit: `feat(what-if): access rule for what-if writes, ownership and the route guard`.
- [ ] **Step 8 (gate):** Hostile review of this task's diff by a fresh-context agent that runs things rather than reads them (mandate: find any existing route whose classification changed, any path that reaches a what-if write without capture, any way a non-owner reads an unfinished what-if). Iterate to an honest accept before Task 3 starts.

### Task 3: Start, list, read, rename, delete

**Files:**
- Create: `app/api/explore/[code]/what-ifs/route.ts` (POST, GET), `app/api/explore/[code]/what-ifs/[id]/route.ts` (GET, PATCH, DELETE), `app/api/explore/[code]/what-ifs/[id]/messages/route.ts` (GET)
- Test: `tests/app/api/what-if-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 queries; `guardWhatIf`, `ownerOf`, `canManageWhatIf` (Task 2); `authorizeRequest`; `personalName` (`lib/auth/viewer.ts`); `getCourseByCode`; `getLatestSnapshotByCourse`; `deleteLocal`, `keyFromLocalUrl` (`lib/storage/local-storage.ts`).
- Produces: `POST …/what-ifs` body `{ authorName?: string }` → 201 `{ id }`. `GET …/what-ifs` → `{ whatIfs: Array<{ id; title; authorName; summary; pageCreatedAt; createdAt; hasPage: boolean; mine: boolean }> }`. `GET …/[id]` → `{ whatIf: WhatIfRow; canManage: boolean }`. `PATCH …/[id]` body `{ title: string }` (1–120 characters). `DELETE …/[id]` → 204. `GET …/[id]/messages` → `{ messages: WhatIfMessageRow[] }`.

- [ ] **Step 1:** Write the failing test (mock the query module, `authorizeRequest`, the snapshot query and `deleteLocal`):
  - start, personal link: stores `authorName` from `personalName(grant)` and ignores the body's name; `baseSnapshotId` is the id from `getLatestSnapshotByCourse`.
  - start, department login with no `authorName` → 400 `{ error: 'A name is required.' }`.
  - start on a course with no approved version → 409 `{ error: 'This course has no approved version yet.' }`; unknown course → 404.
  - list: returns what-ifs with a page plus the caller's own without one; another person's unfinished what-if is absent.
  - read an unfinished what-if as a non-owner → 404; `GET …/messages` as a non-owner of a what-if **that has a page** → 403.
  - rename and delete as a non-owner → 403; delete as owner calls `deleteLocal` once per attachment row returned by `deleteWhatIf` and returns 204; a `deleteLocal` failure does not turn the response into an error.
- [ ] **Step 2:** Run `env -u DATABASE_URL pnpm vitest run tests/app/api/what-if-routes.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the three route files. Every handler except start and list goes through `guardWhatIf` (`messages`, PATCH and DELETE with `'manage'`; GET `[id]` with `'read'`). Start and list call `authorizeRequest`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Add the routes to STATE.md. Commit: `feat(what-if): start, list, read, rename and delete routes`.

### Task 4: Attachments

**Files:**
- Create: `lib/what-if/attachments.ts`, `app/api/explore/[code]/what-ifs/[id]/attachments/route.ts`
- Modify: `middleware.ts:296` — add `api/explore/[^/]+/what-ifs/[^/]+/attachments` to the matcher's exclusion list (large multipart bodies, same reason as the materials upload); the route therefore gates itself.
- Test: `tests/lib/what-if/attachments.test.ts`, `tests/app/api/what-if-attachments-route.test.ts`

**Interfaces:**
- Consumes: `extractText` (`lib/courses/extract-text.ts`); `scrubForRecord` (`lib/privacy/scrub.ts`); `evaluateMaterialsPolicy` (`lib/capture/materials-policy.ts`); `detectFerpaRisk` (`lib/capture/ferpa-detect.ts`); `putLocal` (`lib/storage/local-storage.ts`); `SUPPORTED_MIME_TYPES`, `LEGACY_OFFICE_MIME_TYPES`; `checkDailyCap`, `recordSpend`; `checkIpRateLimit`, `hashIp`; `guardWhatIf`; `insertWhatIfAttachment`, `listWhatIfAttachments`.
- Produces:

```ts
export const WHAT_IF_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
export const WHAT_IF_ATTACHMENT_TEXT_BUDGET = 120_000;
ingestWhatIfAttachment(input: { whatIfId: string; fileName: string; mimeType: string; bytes: Buffer }): Promise<WhatIfAttachmentRow>
attachmentsForAi(whatIfId: string): Promise<Array<{ fileName: string; status: 'ok' | 'failed' | 'held_back'; text: string | null; truncated: boolean }>>
// POST …/attachments (multipart, field "file") → 201 { attachment: { id, fileName, status, heldBackReason } }
```

- [ ] **Step 1:** Write the failing unit test (mock `extractText`, `putLocal`, `scrubForRecord`, the query module; let the real policy and risk functions run):

```ts
it('stores scrubbed text for a readable file', … status 'ok', extractedText === 'SCRUBBED', putLocal key starts 'what-ifs/<id>/');
it('holds back a file the materials step would hold back', async () => {   // Review Focus 3
  const row = await ingestWhatIfAttachment({ whatIfId, fileName: 'Canvas File: gradebook.xlsx', mimeType: XLSX, bytes });
  expect(row).toMatchObject({ status: 'held_back', heldBackReason: 'Filename looks like grades/roster data' });
});
it('marks an unreadable file failed', … extractText → { status: 'failed' } → status 'failed', extractedText null);
it('attachmentsForAi gives text only for ok files', … held_back and failed rows have text === null);
it('attachmentsForAi stops at the text budget and says so', … truncated === true on the cut file, later files text === null);
it('never touches the real course stores', () => {
  const src = readFileSync('lib/what-if/attachments.ts', 'utf8');
  for (const name of ['insertMaterial', 'supersedeOlderSyllabi', 'finalizeExtraction', 'enqueue', 'vector-store'])
    expect(src).not.toContain(name);
});
```

- [ ] **Step 2:** Write the failing route test: no grant → 401; non-owner → 403; `video/mp4` → 400; over the size limit → 400; daily cap reached → 503 `{ error: 'daily cost cap reached — service paused for today' }`; a good file → 201 and `ingestWhatIfAttachment` called once; `recordSpend` called with the vision cost when `extractText` reports one.
- [ ] **Step 3:** Run `env -u DATABASE_URL pnpm vitest run tests/lib/what-if/attachments.test.ts tests/app/api/what-if-attachments-route.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement. Order inside `ingestWhatIfAttachment`: `putLocal` → `extractText` (skip nothing; legacy Office is converted inside it) → on `failed` or empty text store `failed` → `scrubForRecord(text, { fileName, isSyllabus: false })` → `evaluateMaterialsPolicy({ fileName, extractedText: scrubbed, courseHasLearningObjectives: true })`; `included: false` stores `held_back` with the policy's reason → `detectFerpaRisk` level recorded on the row. Accepted types: `SUPPORTED_MIME_TYPES` plus `LEGACY_OFFICE_MIME_TYPES`. Route: `guardWhatIf(…, 'manage')`, rate limit, cap check, the materials route's own 400 messages, `export const maxDuration = 300`.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(what-if): attachments read, screened and stored with the what-if`.

### Task 5: The estimate and the what-if profile

**Files:**
- Create: `lib/what-if/estimate-schema.ts`, `lib/what-if/estimate.ts`, `lib/what-if/profile.ts`, `lib/ai/prompts/what-if-estimate.md`
- Modify: `lib/ai/function-settings.ts` (`AI_FUNCTION_IDS`, `DEFAULT_ROLES` → `'what-if-estimate': 'judge'`, `FUNCTION_LABELS`, `FUNCTION_DESCRIPTIONS`), `lib/ai/provider.ts` (`COURSE_SCOPED_FUNCTIONS`), `lib/ai/prompts/load.ts` (`PromptName`)
- Test: `tests/lib/what-if/estimate-schema.test.ts`, `tests/lib/what-if/estimate.test.ts`, `tests/lib/what-if/profile.test.ts`

**Interfaces:**
- Consumes: `CaptureProfile` (`lib/ai/capture/schema.ts`); `NeighborContext` (`lib/ai/explore/neighbor-context.ts`); `normalizeCompetencyKey` (`lib/ai/explore/run-impact.ts`); the pattern in `lib/ai/analyze/explore-local-delta.ts`.
- Produces:

```ts
export const whatIfEstimateSchema: z.ZodType<WhatIfEstimate>;
export const WHAT_IF_ESTIMATE_JSON_SCHEMA: Record<string, unknown>;
export interface EstimateInput {
  courseCode: string; approved: CaptureProfile;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments: Array<{ fileName: string; text: string }>;
  neighborContext: NeighborContext; catalog: Array<{ id: string; name: string }>;
  candidate?: string;   // quick estimate: one candidate change, one or two sentences
}
estimateWhatIf(input: EstimateInput): Promise<{ estimate: WhatIfEstimate; telemetry: CompletionTelemetry }>
buildWhatIfProfile(approved: CaptureProfile, estimate: WhatIfEstimate, activeCatalogIds: Set<string>): WhatIfProfile
```

- [ ] **Step 1:** Write `profile.test.ts` (approved profile from `baseProfile([...])` in `tests/helpers/capture-profile-fixture.ts`: a technical "Prepare print-ready files" K3 U2 D3 and a foundational "Attention to detail" D2):

```ts
it('copies untouched ratings exactly', … status 'approved', kud equals approved, before equals kud, confidence null);
it('applies a moved rating, taking "before" from the approved profile', () => {
  const p = buildWhatIfProfile(approved, est({ movedRatings: [{ statement: 'prepare  print-ready files.', after: { k: 3, u: 3, d: 2 }, confidence: 'medium', reason: 'r' }] }), new Set());
  expect(p.ratings[0]).toMatchObject({ status: 'moved', before: { k: 3, u: 2, d: 3 }, kud: { k: 3, u: 3, d: 2 }, confidence: 'medium' });
});
it('a "moved" rating equal to the approved values stays approved', …);
it('a moved statement that matches nothing becomes a new, unlinked rating', … status 'new', before null, linked false);
it('forces K and U to null on a foundational competency, moved or new', …);
it('drops an invented catalog id', … newCompetencies[0].subCompetencyId 'made-up' → rating.subCompetencyId null, linked false);
it('keeps a real catalog id', … new Set(['color-management']) → linked true);
it('first entry wins when one statement is moved twice', …);
it('marks an incoming change with an unknown catalog id as not linked', …);
```

- [ ] **Step 2:** Write `estimate-schema.test.ts`: a recursive walk of `WHAT_IF_ESTIMATE_JSON_SCHEMA` asserting, for every object node, `additionalProperties === false` and `required` equal to the keys of `properties`; depths are integers 0–5 or null; a sample object parses with `whatIfEstimateSchema`; a depth of 6 is rejected.
- [ ] **Step 3:** Write `estimate.test.ts` (mock `getProviderForFunction` to capture the call): the user message contains the approved statements with their ratings, every conversation turn, each attachment's text under its file name, and the catalog ids; with `candidate` set, the message says to estimate only that candidate; the function id is `'what-if-estimate'`.
- [ ] **Step 4:** Run `env -u DATABASE_URL pnpm vitest run tests/lib/what-if`. Expected: FAIL.
- [ ] **Step 5:** Implement. The prompt (`what-if-estimate.md`) includes `shared/depth-scale.md` the way the scoring prompts do and states: ratings can go down; say nothing about a competency the change does not touch; foundational competencies are rated on Do only; a catalog id must come from the supplied list or be null; these are predictions, so the evidence rule does not gate them. `buildWhatIfProfile` is pure and matches statements with `normalizeCompetencyKey`.
- [ ] **Step 6:** Run the tests. Expected: PASS.
- [ ] **Step 7:** Add `what-if-estimate` to the model-roles table in STATE.md. Commit: `feat(what-if): estimate function and the what-if profile builder`.

### Task 6: Effects on neighboring courses and career targets

**Files:**
- Modify: `lib/program/prereq-gaps.ts` (extract two loaders, no behavior change); `lib/ai/explore/run-impact.ts` (export `snapshotToNeighborProfile` — the only change)
- Create: `lib/what-if/knock-on.ts`, `lib/what-if/neighbors.ts`
- Test: `tests/lib/what-if/knock-on.test.ts`; `tests/program/prereq-gaps.test.ts` must pass **unedited**

**Interfaces:**
- Consumes: `computeGapsFromInputs`, `RelyEdge`, `DeliveredAttainment` (`lib/program/prereq-gaps.ts`); `buildBaselineDelivered`, `normalizeCompetencyKey` (`run-impact.ts`); `depthBand` (`lib/program/depth-band.ts`); `MatrixData`, `getMatrixData`; `listConfirmedEdgePairs`; `assembleNeighborContext`; `getSnapshotById`.
- Produces:

```ts
// prereq-gaps.ts
loadDelivered(pairs: Array<{ prereqCourseCode: string; subCompetencyId: string }>): Promise<DeliveredAttainment[]>
loadPrereqGapInputs(focalCourseCode: string): Promise<{ edges: RelyEdge[]; delivered: DeliveredAttainment[] }>
// knock-on.ts
resolveWhatIfDepths(baseSnapshotId: string, profile: WhatIfProfile): Promise<{ resolved: PredictedSubCompDepth[]; notComputed: string[] }>
laterCourseLines(input: { focalCourseCode: string; focalBaseline: DeliveredAttainment[]; predicted: PredictedSubCompDepth[];
  perCourse: Array<{ courseCode: string; edges: RelyEdge[]; delivered: DeliveredAttainment[] }>; label: (id: string) => string }): KnockOn['laterCourses']
earlierCourseLines(input: { incomingChanges: WhatIfProfile['incomingChanges']; prereqCodes: string[];
  delivered: DeliveredAttainment[]; label: (id: string) => string }): KnockOn['earlierCourses']
careerLines(input: { focalSnapshotId: string; predicted: PredictedSubCompDepth[]; matrix: MatrixData }): KnockOn['careerTargets']
computeKnockOn(w: { courseCode: string; baseSnapshotId: string }, profile: WhatIfProfile): Promise<KnockOn>
// neighbors.ts
loadWhatIfNeighborContext(courseCode: string, baseSnapshotId: string): Promise<NeighborContext>   // focal = the base snapshot, neighbors as they are now
```

- [ ] **Step 1:** Write the failing test for the three pure functions (focal `GC 3400`, later course `GC 4400` expecting D3 on `color-management`):

```ts
it('reports a gap the change would open', … focal delivered D3 → predicted D1, GC 4400 has only this prerequisite
   → [{ courseCode: 'GC 4400', subCompetencyId: 'color-management', effect: 'opened', label }]);
it('does not report an opened gap when another prerequisite still delivers it', … same, plus GC 2400 delivering D3 measured
   with a confirmed GC 4400 → GC 2400 edge → []);                                   // Review Focus 1
it('reports a gap the change would close', … D1 → D3 → effect 'closed');
it('never reports "opened" when there was no data before', …);
it('uses the predicted row instead of every focal row for that sub-competency', … two focal measured rows D3 and D4, predicted D1 → opened);
it('checks a new walking-in expectation against earlier courses', … expected D2; GC 1040 delivers D3 → status 'met', deliveredBy ['GC 1040'];
   delivers D1 → 'not_met'; no row → 'not_known'; incoming change with linked false → 'not_known', label null);
it('ignores a dropped expectation', …);
it('reports a career target moving down as well as up', … cell dDepth 4 → predicted d 1 → direction 'down'; 1 → 4 → 'up'; same band → no line);
```

  and for `resolveWhatIfDepths` (mock the coverage query): a moved rating resolves through the base snapshot's coverage rows; a new linked rating through its `subCompetencyId`; a moved rating with no coverage row and a new unlinked rating both land in `notComputed` by statement; two statements on one sub-competency give one entry with the per-dimension maximum; `approved` ratings are not resolved at all.
- [ ] **Step 2:** Run `env -u DATABASE_URL pnpm vitest run tests/lib/what-if/knock-on.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Extract `loadDelivered` and `loadPrereqGapInputs` from `computePrereqGaps` so that `computePrereqGaps` becomes "load inputs, call `computeGapsFromInputs`". Run `env -u DATABASE_URL pnpm vitest run tests/program/prereq-gaps.test.ts tests/db`. Expected: PASS with no test edited.
- [ ] **Step 4:** Implement `knock-on.ts` and `neighbors.ts`. `laterCourseLines`: for each later course, "before" = its delivered rows with the focal's rows replaced by `focalBaseline`; "after" = the same with, for each predicted sub-competency, every focal row replaced by one row carrying the predicted depths and `basis: 'intended'`; compare `computeGapsFromInputs` statuses; `gap → met` is `closed`, `met → gap` is `opened`, nothing else is reported. `earlierCourseLines`: for each `new` or `raised` change that is linked and has `expected`, build one edge per prerequisite course with that expectation and read the status; `deliveredBy` lists the courses whose own rows meet it. `careerLines`: as `computeCareerFit`, but any band change is reported with its direction. `computeKnockOn` loads: confirmed later courses from `listConfirmedEdgePairs()` where `prereq` is the focal, each through `loadPrereqGapInputs`; `focalBaseline` from `buildBaselineDelivered(courseCode, baseSnapshotId)`; earlier courses from the pairs where `focal` is the focal, through `loadDelivered`; the matrix from `getMatrixData()`. Only confirmed prerequisite links are used.
- [ ] **Step 5:** Run `env -u DATABASE_URL pnpm vitest run tests/lib/what-if tests/program tests/lib/ai/explore`. Expected: PASS (Explore tests untouched and green).
- [ ] **Step 6:** Commit: `feat(what-if): effects on later courses, earlier courses and career targets`.

### Task 7: The assistant and the conversation route

**Files:**
- Create: `lib/what-if/agent.ts`, `lib/what-if/agent-tools.ts`, `lib/what-if/agent-response-schema.ts`, `lib/ai/prompts/what-if-agent.md`, `app/api/explore/[code]/what-ifs/[id]/chat/route.ts`
- Modify: `lib/ai/function-settings.ts`, `lib/ai/provider.ts`, `lib/ai/prompts/load.ts` (add `what-if-agent`, role `converse`)
- Test: `tests/lib/what-if/agent.test.ts`, `tests/lib/what-if/agent-tools.test.ts`, `tests/app/api/what-if-chat-route.test.ts`

**Interfaces:**
- Consumes: `streamWithTools` via `getProviderForFunction('what-if-agent', { courseCode })`; `buildCurriculumChatTools`, `buildCurriculumGraphTools`, `buildCurriculumSearchTools` (`lib/ai/wiki/*`); `buildAuditTools(courseCode)`; `estimateWhatIf`, `buildWhatIfProfile` (Task 5); `computeKnockOn`, `loadWhatIfNeighborContext` (Task 6); `attachmentsForAi` (Task 4); `readWikiPage`; Task 1 message queries; `guardWhatIf`; the structure of `app/api/capture/[code]/chat/route.ts` and `lib/ai/explore/agent.ts`.
- Produces:

```ts
export const whatIfAgentResponseSchema  // { response: string (min 1), citations: [...] } — same shape as the Explore agent's
export type WhatIfAgentResponse = z.infer<typeof whatIfAgentResponseSchema>
export interface QuickEstimate { candidate: string; estimate: WhatIfEstimate; profile: WhatIfProfile; knockOn: KnockOn }
export type WhatIfAgentStreamEvent =
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'estimate'; estimate: QuickEstimate }
  | { kind: 'final'; response: WhatIfAgentResponse; toolCallsUsed: number }
  | { kind: 'error'; message: string };   // defined here, not imported from lib/ai/explore (deleted in Task 11); CompletionTelemetry is from lib/ai/provider.ts
buildWhatIfTools(ctx: { whatIf: WhatIfRow; approved: CaptureProfile; onEstimate: (q: QuickEstimate, telemetry: CompletionTelemetry) => Promise<void> }): ToolDefinition[]   // one tool: quick_estimate({ candidate: string })
streamWhatIfAgent(input: { whatIf: WhatIfRow; approved: CaptureProfile; history: Array<{ role: 'user' | 'assistant'; content: string }>;
  message: string; attachments: Awaited<ReturnType<typeof attachmentsForAi>>; onEstimate: … }): AsyncGenerator<WhatIfAgentStreamEvent, void, unknown>
// POST …/chat  body { message: string }  → NDJSON, one WhatIfAgentStreamEvent per line
```

- [ ] **Step 1:** Write the failing tests.
  - `agent-tools.test.ts`: `quick_estimate` calls `estimateWhatIf` with `candidate` set, builds the profile and effects, calls `onEstimate` once, and returns to the model only the moved and new ratings and the effect lines of that result.
  - `agent.test.ts` (mock the provider): the tool names include `quick_estimate`, `list_materials`, `fetch_material_section`, `search_materials` and none named `save_scenario`, `list_scenarios`, `compare_scenarios` or `run_impact`; the context holds the approved profile, the course's wiki page when one exists, and attachment text for `ok` files only; a `failed` attachment appears as "could not be read" and a `held_back` one as "held back" with no text (Review Focus 3); `maxToolCalls` is 8.
  - `what-if-chat-route.test.ts`: non-owner → 403; base snapshot gone or withdrawn → still answers (talking is allowed; only page creation is refused); daily cap reached → 503 `{ error: 'daily cost cap reached — service paused for today' }` and no message stored; a normal turn stores exactly two rows through `appendWhatIfMessage` (user, then assistant with citations in `meta`), calls `recordSpend` and `addWhatIfUsage(id, 'chat', …)`; a quick estimate adds `addWhatIfUsage(id, 'quick_estimate', …)` and puts the result in the assistant message's `meta.quickEstimates`; `AiCreditsExhaustedError` yields the interview's `ai_credits_exhausted` event; the route file contains neither `saveTurn` nor `captureConversations`.
- [ ] **Step 2:** Run `env -u DATABASE_URL pnpm vitest run tests/lib/what-if tests/app/api/what-if-chat-route.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write `what-if-agent.md`. Start from the Role, Grounding rules, Output discipline and Voice sections of `explore-agent.md` and its SUGGEST mode; drop the Scenario tools section. It must state: the two starts (a change, or a wanted result); **ideas** — offer candidate changes, say what each would displace, offer a quick estimate, do not pick a winner; **pinning down** — one question at a time until it knows what is added or changed (what students do, what they produce, how it is graded, roughly how much time), what is removed or cut back (ask if not mentioned), what students newly need walking in, and what they would leave with or no longer leave with; every claim about another course comes from a lookup; never state a rating — numbers come only from a quick estimate's result; when the four things are known, tell the author they can create the page (and that they can at any time).
- [ ] **Step 4:** Implement the tools, the agent (history comes from the server's stored messages, never from the client) and the route (`maxDuration = 120`).
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** STATE.md: route and `what-if-agent`. Commit: `feat(what-if): the assistant and the conversation route`.

### Task 8: Creating and updating the page

**Files:**
- Create: `lib/what-if/page-prose.ts`, `lib/what-if/create-page.ts`, `lib/ai/prompts/what-if-page.md`, `app/api/explore/[code]/what-ifs/[id]/page/route.ts`
- Modify: `lib/ai/function-settings.ts`, `lib/ai/provider.ts`, `lib/ai/prompts/load.ts` (add `what-if-page`, role `write`)
- Test: `tests/lib/what-if/page-prose.test.ts`, `tests/lib/what-if/create-page.test.ts`, `tests/app/api/what-if-page-route.test.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1, 4, 5, 6; `getSnapshotById`; `readWikiPage`; `checkDailyCap`, `recordSpend`; the withdrawn-baseline response at `app/api/capture/[code]/scores/route.ts:102`.
- Produces:

```ts
export const RATING_IN_PROSE = /\b[KUD]\s?[0-5]\b/;
writeWhatIfProse(input: { courseCode: string; courseTitle: string; currentDescription: string; estimate: WhatIfEstimate;
  profile: WhatIfProfile; knockOn: KnockOn; needsTitle: boolean }): Promise<{ prose: WhatIfProse; title: string | null; summary: string; telemetry: CompletionTelemetry }>
export type CreatePageResult = { ok: true } | { ok: false; reason: 'baseline_withdrawn' | 'daily_cap' | 'prose_failed' };
createWhatIfPage(whatIf: WhatIfRow): Promise<CreatePageResult>
// POST …/page → 200 { ok: true } | the scores route's baseline_withdrawn response | 503 daily cap | 502 { error: 'The page text could not be written. Try again.' }
```

- [ ] **Step 1:** Write the failing tests.
  - `page-prose.test.ts`: the strict JSON schema passes the same recursive check as Task 5; a response whose prose contains "D3" or "K 2" is rejected by `validate`; `currentDescription` and the change items are in the user message; ratings are given to the model in words ("goes up", "goes down", "new") and never as K/U/D numbers.
  - `create-page.test.ts` (mock the AI functions and queries):

```ts
it('refuses when the base version was withdrawn', … getSnapshotById → { retiredAt: new Date() } → { ok: false, reason: 'baseline_withdrawn' }, no AI call);
it('refuses when the base version no longer exists', … whatIf.baseSnapshotId null → same);                         // Review Focus 4
it('writes the page in one save, last', … saveWhatIfPage called once, after both AI calls and both recordSpend calls);
it('keeps the previous page when the cap is reached after the estimate', … checkDailyCap ok then overCap
   → { ok: false, reason: 'daily_cap' }, saveWhatIfPage not called, usage for the estimate still recorded);         // Review Focus 5
it('keeps the previous page when the page text fails', … writeWhatIfProse throws → 'prose_failed', saveWhatIfPage not called);
it('still creates a page when nothing moved', … estimate with empty arrays → { ok: true });
it('asks for a title only the first time', … whatIf.title 'Mine' → needsTitle false and saveWhatIfPage title null);
it('writes from the approved description when the course has no wiki page', … readWikiPage → null → currentDescription === approved.description);
it('never writes to the wiki', … source of create-page.ts and page-prose.ts contains no git-ops name other than readWikiPage);
```

  - `what-if-page-route.test.ts`: non-owner → 403; each `CreatePageResult` maps to the status and body listed above, with the withdrawn message matching the scores route's text and `code: 'baseline_withdrawn'` exactly.
- [ ] **Step 2:** Run `env -u DATABASE_URL pnpm vitest run tests/lib/what-if tests/app/api/what-if-page-route.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `createWhatIfPage` sequence: base check → `checkDailyCap` → load messages, `attachmentsForAi`, `loadWhatIfNeighborContext`, `listActiveSubCompetencies` → `estimateWhatIf` → `recordSpend` + `addWhatIfUsage('estimate')` → `buildWhatIfProfile` → `computeKnockOn` → `checkDailyCap` → `writeWhatIfProse` → `recordSpend` + `addWhatIfUsage('page')` → `saveWhatIfPage` (the only write of page content; it replaces the previous page and sets `page_created_at`). The prompt (`what-if-page.md`) asks for four pieces — the rewritten course description, the wording of "what changes", the wording for neighboring courses, three to five questions for discussion — plus a short title when asked and a one-line summary; it forbids stating any rating. `saveWhatIfPage` keeps the existing title when `title` is null.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** STATE.md: route and `what-if-page`. Commit: `feat(what-if): create and update the what-if page`.

### Task 9: The invariant test

**Files:**
- Create: `tests/db/whatif/invariant.test.ts`, `tests/db/whatif/real-course-fingerprint.ts`

**Interfaces:**
- Consumes: the whole server side (Tasks 1–8) with the AI calls and `extractText` mocked.
- Produces: `fingerprintRealCourse(courseCode: string, wikiPath: string): Promise<Record<string, string>>` — one SHA-256 per store: for each of `course_capture_snapshots`, `course_capture_profiles`, `capture_conversations`, `capture_messages`, `capture_sessions`, `course_materials`, `item_embeddings`, `snapshot_competency_coverage`, `course_intended_coverage`, `prerequisite_edges`, `course_explore_scenarios`, `prototype_runs`, a hash of `SELECT … ORDER BY` primary key `::text` over the rows for that course (whole table where it has no course column); plus a hash of the file listing (path, size, mtime) of the course's material directory under `STORAGE_ROOT`; plus `git -C <wikiPath> rev-parse HEAD` and `git -C <wikiPath> status --porcelain`.

- [ ] **Step 1:** Write the test (scratch database only; not in a rolled-back transaction — it cleans up with `deleteWhatIf` and asserts the three what-if tables end empty for the course). Set `WIKI_REPO_PATH` to a temporary `git clone` of the wiki repository before importing any app module. Pick a course in the scratch copy that has an approved snapshot and give it a real revision in progress (a draft row and a saved interview conversation — inserted by the test, removed after). Then: fingerprint → start a what-if → two conversation turns → one attachment → a quick estimate → create the page → update the page → rename → delete → fingerprint. Assert the two fingerprints are deeply equal, key by key.
- [ ] **Step 2:** Show it red, once per leak class, each time reverting before the next: (a) add `await insertMaterial(...)` to `ingestWhatIfAttachment`; (b) add a `saveTurn(...)` call to the what-if chat route; (c) make `createWhatIfPage` write the description back with the wiki writer. Run `DATABASE_URL="$(scripts/migrations/whatif-scratch-db.sh url)" pnpm vitest run tests/db/whatif/invariant.test.ts` each time. Expected: FAIL naming `course_materials`, then `capture_messages`, then the wiki status key. Record the three failure lines in the commit message.
- [ ] **Step 3:** With all three reverted (`git diff --stat` shows only the test files), run it again. Expected: PASS.
- [ ] **Step 4:** Commit: `test(what-if): the real course is unchanged by a full what-if (red-proofed three ways)`.
- [ ] **Step 5 (gate):** Hostile review of Tasks 3–9 as a whole by a fresh-context agent that runs things: look for any write outside the three tables, any reader of what-if data from the real capture, program view, matrix, Ask or wiki, and any route that returns a conversation or an unfinished what-if without the owner check. Iterate to an honest accept.

### Task 10: The pages and the links to them

**Files:**
- Create: `app/explore/[code]/WhatIfList.tsx`, `app/explore/[code]/what-ifs/[id]/page.tsx`, `app/explore/[code]/what-ifs/[id]/WhatIfPageLayout.tsx`, `app/explore/[code]/what-ifs/[id]/WhatIfActions.tsx`, `app/explore/[code]/what-ifs/[id]/talk/page.tsx`, `app/explore/[code]/what-ifs/[id]/talk/WhatIfChatPanel.tsx`, `app/explore/[code]/StartWhatIf.tsx`, `lib/client/read-ndjson.ts`, `lib/what-if/copy.ts`
- Modify: `app/capture/[code]/CaptureChatPanel.tsx` (import `readNdjson` from `lib/client/read-ndjson.ts` instead of defining it — a move, no change); `app/capture/[code]/CaptureHero.tsx` and `CaptureClient.tsx` (render `StartWhatIf`); `app/courses/CoursesIndex.tsx:155` and `app/courses/page.tsx` (link + count); `app/courses/[code]/page.tsx:261`; `app/wiki/[type]/[slug]/page.tsx`
- Test: `tests/app/explore/what-if-page-layout.test.tsx`, `what-if-list.test.tsx`, `what-if-chat-panel.test.tsx`, `start-what-if.test.tsx`; `app/wiki/__tests__/` and `tests/app/courses/` cases for the links

**Interfaces:**
- Consumes: the routes of Tasks 3, 4, 7, 8; `WhatIfRow` and the shared types; `countWhatIfsByCourse`; `InstructorSelect`; `VoiceRecorder`; the wiki CSS classes (`wiki-index wiki-page`, `wiki-page__body`, `wiki-prose`, `wiki-page__aside`); `ReactMarkdown` + `remarkGfm`.
- Produces: `WHAT_IF_COPY` in `lib/what-if/copy.ts` — every user-facing string for this feature in one object (start control, opening line, banner, the "predicted" label, notices, delete confirmation), so the owner can review the wording in one place.

**Draft wording (in `WHAT_IF_COPY`; shown to the owner before shipping):** start control "Try a what-if instead" with the line "Sketch a change and see what it would mean. Nothing here changes the course."; opening line "What would you like to change in this course — or what result are you after?"; banner "What-if — not the current course."; label "predicted"; removal fallback "Removed: not discussed"; effects note "Only confirmed prerequisite links are checked."

- [ ] **Step 1:** Write the failing layout test. Given a stored record with one approved, one moved (D3 → D2, medium) and one new unlinked rating:

```tsx
expect(screen.getByText(WHAT_IF_COPY.banner)).toBeInTheDocument();
expect(within(row('Prepare print-ready files')).getByText('predicted')).toBeInTheDocument();
expect(within(row('Prepare print-ready files')).getByText(/D3\s*→\s*D2/)).toBeInTheDocument();
expect(within(row('Attention to detail')).queryByText('predicted')).toBeNull();           // approved rating unmarked
expect(screen.getByText(/no effects on other courses could be computed/i)).toBeInTheDocument();  // notComputed
expect(screen.getByRole('link', { name: 'GC 4400' })).toHaveAttribute('href', expect.stringContaining('/wiki/courses/gc-4400'));
```

  plus: the six sections appear in the spec's order; "Removed: not discussed" when no `removed` change item exists; base version withdrawn or gone shows the notice and no Update button; a newer approved version shows "a newer version has been approved since"; nothing moved shows a sentence saying so; a reader who cannot manage sees no Update, Rename, Delete or conversation link; the ratings in the table are the record's `profile.ratings`, not parsed from prose.
- [ ] **Step 2:** Write the other failing tests. List: shows title, author, date and summary for what-ifs with a page; shows the caller's own unfinished ones marked as such; no start control when the course has no approved version. Chat panel: posts to `…/chat`; shows the fixed opening line when there are no messages; loads earlier messages from `…/messages`; file picker, drop and image paste each post to `…/attachments`; a `held_back` or `failed` attachment shows its reason; an `estimate` event renders ratings from the event's data; "Create the what-if page" posts to `…/page` and is enabled from the first message. Start control: under the department login the name picker must be filled before the start request is sent; with a personal link no picker appears. Delete: confirmation is rendered in the page (no `window.confirm`). Links: the course list shows "What-ifs (2)" pointing at `/explore/<code>`; the wiki course page shows "What-ifs (2)" beside Ask only with a valid faculty access parameter and not at all without it; the interview page shows the start control only when an approved version exists.
- [ ] **Step 3:** Run `env -u DATABASE_URL pnpm vitest run tests/app/explore app/wiki/__tests__ tests/app/courses`. Expected: FAIL (new cases).
- [ ] **Step 4:** Implement. Pages use the same gate as today's `app/explore/[code]/page.tsx` (`isValidSlug(slug)`, then `getRequestGrant(await headers())`); the what-if page returns `notFound()` when `canReadWhatIf` is false; the talk page when `canManageWhatIf` is false. Never forward the faculty access parameter to a scoped tester's client (same rule as the capture page). `WhatIfPageLayout` renders prose with `ReactMarkdown` and every table and effect line from the record.
- [ ] **Step 5:** Run the tests, then `env -u DATABASE_URL pnpm test` and `pnpm build`. Expected: all green; build succeeds.
- [ ] **Step 6:** Commit: `feat(what-if): the what-if page, conversation, list and links`.

### Task 11: Retire Explore

**Files:**
- Modify: `app/explore/[code]/page.tsx` (render `WhatIfList`; keep the Guide link); `components/AskTab.tsx` (remove the `courseCode` mode: scenario and comparison events, save, compare, adopt, the "Asking about" header, card rendering, the `/api/explore/…/chat` endpoint); `lib/ai/function-settings.ts`, `lib/ai/provider.ts`, `lib/ai/prompts/load.ts` (remove `explore-agent`, `explore-local-delta`); `tests/auth/authorize.test.ts` (drop the Adopt case; keep the `/explore/<code>` read case)
- Delete: `app/api/explore/[code]/chat/`, `app/api/explore/[code]/scenarios/`, `app/explore/[code]/ScenarioCard.tsx`, `ComparisonCard.tsx`, `lib/ai/analyze/explore-local-delta.ts`, `lib/db/explore-scenario-queries.ts`, `lib/ai/prompts/explore-agent.md`, `explore-local-delta.md`, and in `lib/ai/explore/`: `agent.ts`, `agent-tools.ts`, `agent-response-schema.ts`, `adopt.ts`, `compare.ts`, `ripple.ts`, `career-fit.ts`, the `runImpact`/`saveScenario` parts of `run-impact.ts`; and the tests of each deleted file
- Test: add `tests/components/ask-tab-plain.test.tsx` and `tests/app/explore/explore-page-list.test.tsx`; delete `tests/components/ask-tab-scenario.test.tsx`, `tests/app/explore/explore-page-chat.test.tsx`, `scenario-card.test.tsx`, `comparison-card.test.tsx`; the wiki suites (`tests/lib/ai/wiki`, `tests/ai/wiki`, `tests/wiki`, `app/wiki/__tests__`) must pass unedited

- [ ] **Step 1:** Write the failing test: `/explore/GC 3730` renders the what-if list and no chat input. Run it. Expected: FAIL.
- [ ] **Step 2:** Before deleting anything, pin the behavior that must survive. `AskTab` without `courseCode` (used by `/ask` and the wiki page) has no test today, so write `tests/components/ask-tab-plain.test.tsx` against the current component: `<AskTab slug="s" />` posts to `/api/ask/chat?slug=s`, renders streamed `text-delta` text, renders a citation line, and shows no "Asking about" header. Run it. Expected: PASS now (it describes existing behavior; it would fail if the endpoint or the stream rendering changed). Also run `env -u DATABASE_URL pnpm vitest run tests/lib/ai/wiki tests/ai/wiki tests/wiki app/wiki/__tests__` and keep the pass count.
- [ ] **Step 3:** Swap the page, strip `AskTab`, delete the files listed. Then `grep -rn "@/lib/ai/explore/" lib app components tests` and resolve every remaining import: helpers still used by `lib/what-if/` or `lib/capture/adopt-overlay.ts` (`normalizeCompetencyKey`, `buildBaselineDelivered`, `snapshotToNeighborProfile`, `assembleNeighborContext` and their types) move to `lib/what-if/neighbors.ts` with their tests; everything else goes. Expected: the grep prints nothing and `lib/ai/explore/` no longer exists.
- [ ] **Step 4:** Leave in place, and record each in STATE.md **Deferred / debt** in this commit: the `course_explore_scenarios` table and its rows (unused; dropping it is a later, owner-approved migration); the `intended_target` field and its readers (`lib/capture/adopt-overlay.ts`, `CompetencyPortrait.tsx`, the scores route) because existing drafts and snapshots may carry it; looser matching for effects that could not be computed; faculty comments on what-ifs.
- [ ] **Step 5:** Run `env -u DATABASE_URL pnpm test` and `pnpm build`. Expected: green; `ask-tab-plain.test.tsx` and the Step 2 wiki suites pass with the same count and no edits; `tests/auth` green.
- [ ] **Step 6:** STATE.md: the `/explore/[code]` row (line 64), the model-roles rows (remove `explore-agent`, `explore-local-delta`; reconcile the stale `explore-draft-target`, `explore-compare`, `explore-what-if` rows at 184–186), the Adopt note (773). Commit: `feat(what-if): the Explore chat page, its tools and Adopt are retired; /explore is the what-if list`.

### Task 12: Guide, wording, final review, first live what-if

**Files:**
- Modify: `docs/using-coursecapture-and-explore.html` § 9 (lines 351–376; keep `id="explore"`), `docs/STATE.md` (line 525 and "What's live"), `docs/ROADMAP.md` (it does not mention Explore today; add the spec's "Later phases" under possible)

- [ ] **Step 1:** Rewrite the guide's § 9 for what-ifs in plain language: what a what-if is, the two ways to start, attaching files, creating and updating the page, who can see it, that nothing in the course changes, what "predicted" means. No revision note. Commit: `docs(guide): what-ifs replace the Explore section`.
- [ ] **Step 2 (owner):** Show the owner `lib/what-if/copy.ts` and a screenshot of a what-if page built from fixture data. Apply their wording changes.
- [ ] **Step 3 (gate):** Whole-branch review on the most capable model, with this plan's Review Focus section and the spec's Anti-goals handed over verbatim. One fix pass, each fix red then green.
- [ ] **Step 4 (owner's yes required for each):** merge to `dev`; fresh backup; apply `drizzle/0066_what_ifs.sql` to live; deploy with the fail-fast chain (per-step `|| exit`, 40-character SHA guard, fresh `.next/BUILD_ID` check before the restart).
- [ ] **Step 5 (owner):** The owner runs one what-if on one course at `https://gcworkflow.clemson.edu:8443`. Report back from the stored record: cost and tokens per call kind (`usage`), how many ratings moved, and how many statements landed in `notComputed`. Nobody else is pointed at it before the owner has read the page.
- [ ] **Step 6:** STATE.md: what-ifs live, the measured cost of the first one, the `notComputed` count. Drop the scratch database (`scripts/migrations/whatif-scratch-db.sh drop`). Commit.

---

## Suggested model per task (subagent-driven execution)

| Task | Implementer | Why |
|---|---|---|
| 1, 3 | Haiku-class or Sonnet | mechanical: tables, queries, thin routes from exact signatures |
| 2 | Sonnet; **Opus for the hostile review** | small diff, but it is the access rule |
| 4, 5, 6, 7, 8, 10, 11 | Sonnet | multi-file integration with existing patterns |
| 9 | Sonnet; **Opus for the hostile review** | the test that protects the real course |
| 12 step 3 | **Opus** | whole-branch judgment |

## Spec coverage

| Spec section | Task |
|---|---|
| The invariant; own tables | 1, 9 (and the source checks in 4, 7, 8) |
| Flow: start, talk, create, refine, share | 3, 7, 8, 10 |
| Conversation: ideas and pinning down; two rules; quick estimates kept in the conversation | 7 |
| Attachments | 4 |
| Predicted ratings; the estimate; code builds the profile | 5 |
| Effects on later and earlier courses and career targets; "not known"; confirmed links only | 6 |
| The what-if page, six sections; prose versus code-rendered numbers; title | 8, 10 |
| Where reached: list, course list, wiki (faculty view), interview page | 10, 11 |
| Permissions; the access rule; ownership under the department login | 2, 3 |
| Delete | 1, 3, 10 |
| Explore retirement; `/ask` and wiki chat unchanged | 11 |
| Edge cases: newer version, withdrawn base, no approved version, two people, daily cap, nothing moved | 3, 8, 10 |
| Cost: cap, per-what-if logging, first live run | 4, 7, 8, 12 |
| Constraints: migration, strict schemas, model roles, STATE.md, wording | 1, 5, 7, 8, 10, 12 |
