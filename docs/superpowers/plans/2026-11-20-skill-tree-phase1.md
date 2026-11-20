# Skill Tree, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One department-wide skill tree (catalog competencies at the top, parent skills below, captured course skills as leaves) with one weighted-average roll-up at every level. Faculty build it at the end of capture review and on the cluster map. It drives the course, program and career-path readings, which are shown beside the scorer's levels without changing them.

**Architecture:** There are four new tables (0074):
- `skill_nodes`: the tree. Master nodes reuse the competency ids.
- `skill_leaves`: course skill to node, with a share.
- `node_depths`: hand-set depths.
- `skill_tree_events`: an append-only log.

Two columns are added: `string_points.node_id` and `string_points.need_*`. The migration backfills the 47 masters and the existing 740 skill links as leaves. All readings are pure functions in `lib/skill-tree/` over a loaded tree. Writes go through `lib/db/skill-tree-queries.ts`, where each write is one transaction with its event row. Both faculty surfaces share one React component. `competency_levels` (0072), /program and the wiki are untouched.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle on Postgres 17, Vitest, campus embeddings (`lib/ai/embeddings`).

**Spec:** `docs/superpowers/specs/2026-11-20-skill-tree-design.md` (approved by the owner 2026-11-20). Background: `2026-11-18-locked-skill-strings-design.md`, `2026-11-20-links-drive-coverage-design.md`.

## Global Constraints

- One roll-up rule at every level: a parent's K, U and D are each a weighted average of its children's. A missing child counts as 0.
- A faculty-set depth overrides the computed one at that node and is shown as "set by hand". The computed value is then the suggestion.
- Nothing is flattened: every reading can be opened to the skills behind it.
- Same skill arriving at two places: the stronger depth counts, per K, U and D (rule 2). Up the tree: weighted average, never the strongest child (rule 3).
- Foundational nodes read D only. K and U stay `null` (not 0). A foundational node's children contribute only their D.
- A leaf (course skill) may sit under several parents, each with a share. Nodes above the leaves have a single parent.
- A leaf is keyed by course code plus the skill's wording hash: `hashOf(statement)` in `lib/strings/hash.ts`, the same value as `skill_competency_links.skill_ref`.
- Default branch weights are equal among siblings.
- Merged nodes redirect (`merged_into`). A split lists the string stops and hand-set depths on the old node so they can be re-pointed.
- Who edits: any login that passes `authorizeRequest` (as strings and links do). Every change writes a `skill_tree_events` row (who, when, before, after). Last write wins.
- **Day one:** /program, the wiki, `competency_levels` and `target_coverage` read the same numbers as before the migration.
- **No fade or reinforcement** (phase 2). Readings carry no time effects.
- **Live database:** migration 0074 is applied to the live database only after a backup and the owner's explicit yes. Tests run on `gc_curriculum_builder_scratch` only.
- **Writing:** US spelling and plain language in all UI copy.

## Review Focus

1. **A competency with both leaves placed directly on it and child parent-skills** (today's 740 links sit on masters, and faculty then add parents beneath). Expected: the direct leaves act as one implicit child, "Skills placed here", weighted like one sibling, so the number doesn't jump when the first parent is added. Tested in Task 2 (`direct leaves count as one child beside parent nodes`).
2. **A leaf whose skill is no longer in the course's newest capture** (recapture with new wording). Expected: it drops out of readings, is listed as "No longer in the capture" with the closest new wording suggested, and confirming moves the placement. Tested in Task 2 (`gone leaves drop out`) and Task 4 (`retarget keeps parents`).
3. **Re-parenting a node under its own descendant.** Expected: refused with a plain message and nothing written. Tested in Task 3 (`reparent refuses a loop`).
4. **A course with two instructors' captures.** Expected: each version reads from its own snapshot. Hand-set depths are per node, course and instructor. Tested in Task 2 (`two versions read separately`).
5. **The migration run against a database that already has 0074, or lacks 0073.** Expected: it raises and changes nothing. Tested in Task 1.

---

## File Structure

- `drizzle/0074_skill_tree.sql`: tables and backfill (Task 1).
- `lib/db/schema.ts`: Drizzle definitions for the new tables and columns (Task 1).
- `scripts/migrations/2026-11-20-skill-tree-live-apply.sh`: backup, apply, verify, stop on any failure (Task 1).
- `lib/skill-tree/types.ts`, `lib/skill-tree/read.ts`: the pure tree model and readings (Task 2).
- `lib/db/skill-tree-queries.ts`: load and write operations (Task 3).
- `lib/skill-tree/suggest.ts`: parent suggestions and new-wording suggestions (Task 4).
- `app/api/skill-tree/route.ts`: GET tree and readings, POST actions (Task 5).
- `app/build/shared/SkillTreePanel.tsx`: the one shared component (Task 6), mounted in `ProfileReviewPanel.tsx` and `ClusterBuilder.tsx` (Task 7).
- `app/build/[id]/CourseDrawer.tsx`: the tree number beside the scorer's level, with drill-down (Task 8).
- `app/build/tree/page.tsx`: the department tree with program and career-path readings (Task 8).
- `lib/builder/strings/read.ts` plus the strings routes: a `requires` stop that names a node (Task 9).

---

### Task 1: Migration 0074 and schema

**Files:**
- Create: `drizzle/0074_skill_tree.sql`, `scripts/migrations/2026-11-20-skill-tree-live-apply.sh`
- Modify: `lib/db/schema.ts` (after `stringPointResolutions`; plus `stringPoints`)
- Test: `lib/db/__tests__/skill-tree-schema.test.ts`, `lib/db/__tests__/skill-tree-backfill.test.ts` (scratch only)

**Interfaces:**
- Produces: the Drizzle tables `skillNodes`, `skillLeaves`, `nodeDepths` and `skillTreeEvents`, plus the columns `stringPoints.nodeId`, `needK`, `needU` and `needD`.

**Tables:**
- **`skill_nodes`:**
  - `id text PK`;
  - `name text NOT NULL`;
  - `description text`;
  - `parent_id text FK skill_nodes ON DELETE RESTRICT`;
  - `competency_id text UNIQUE FK sub_competencies ON DELETE RESTRICT`;
  - `foundational boolean NOT NULL DEFAULT false`;
  - `weight real NOT NULL DEFAULT 1 CHECK (weight > 0)`;
  - `weight_source text NOT NULL DEFAULT 'default' CHECK IN ('default','faculty','onet','employer')`;
  - `merged_into text FK skill_nodes`;
  - `retired boolean NOT NULL DEFAULT false`;
  - `created_by text NOT NULL`, `created_at`, `updated_at`.
  - CHECK `(competency_id IS NULL) = (parent_id IS NOT NULL) OR retired`: a master has no parent, and every other live node has one.
  - CHECK `merged_into IS NULL OR retired`.
- **`skill_leaves`:**
  - `course_code text`, `skill_ref text`, `node_id text FK skill_nodes`;
  - `statement text NOT NULL`;
  - `share real CHECK (share IS NULL OR share > 0)` (NULL means an equal split among the leaf's counting parents);
  - `source text NOT NULL CHECK IN ('embedding','ai','scoring','faculty')`;
  - `status text NOT NULL DEFAULT 'proposed' CHECK IN ('proposed','confirmed','rejected')`;
  - `decided_by text`, `decided_at timestamptz`, `created_at`;
  - PK `(course_code, skill_ref, node_id)`.
- **`node_depths`:**
  - `node_id text FK`, `course_code text`, `instructor text NOT NULL DEFAULT ''`;
  - `k`, `u`, `d smallint`, each `CHECK BETWEEN 0 AND 5 OR NULL`;
  - `method text NOT NULL CHECK IN ('faculty','ai')`;
  - `leaves_signature text NOT NULL`;
  - `set_by text NOT NULL`, `set_at timestamptz`;
  - PK `(node_id, course_code, instructor)`.
- **`skill_tree_events`:**
  - `id uuid PK`, `node_id text`, `course_code text`, `skill_ref text`;
  - `kind text NOT NULL CHECK IN ('migrated','created','renamed','described','reparented','merged','split','weight','leaf_placed','leaf_confirmed','leaf_rejected','leaf_moved','leaf_share','leaf_retargeted','depth_set','depth_cleared')`;
  - `by text NOT NULL`, `at`, `before jsonb`, `after jsonb`;
  - index `(node_id, at DESC)`.
- **`string_points`:** add `node_id text FK skill_nodes ON DELETE RESTRICT`, plus `need_k`, `need_u` and `need_d smallint` (0–5 or NULL).
  - CHECK `node_id IS NULL OR role = 'requires'`.

**Backfill, in the same transaction:**
- **Masters:** one row per `sub_competencies` row. Copy `id`, `name`, `foundational`, `competency_id = id`. Set `retired` and `merged_into` from the competency's own fields; the description stays null.
- **Leaves:** one row per distinct `(s.course_code, l.skill_ref, l.competency_id)` from `skill_competency_links l JOIN course_capture_snapshots s` where `s.retired_at IS NULL`.
  - Carry `statement`, `source`, `status`, `decided_by` and `decided_at`.
  - On duplicates across snapshots, keep the most decided row: confirmed over rejected over proposed, then the newest.
- **Hand-set depths:** one row per `competency_rollups` row joined to its live snapshot. Use `instructor = coalesce(s.instructor_name,'')`, copy `method` and `leaves_signature = 'migrated'`. Today there are 0 such rows.
- **Log:** one `skill_tree_events` row of kind `migrated` with counts in `after`.

**Guards:**
- `RAISE EXCEPTION '0074: already applied'` if `skill_nodes` exists.
- `'0074: precondition — 0073 not applied'` if `app_settings` is missing.

- [ ] **Step 1: Write the failing schema test**

Follow the pattern of `lib/db/__tests__/strings-schema.test.ts`. Assertions:
- the text is one transaction;
- it contains both guard strings;
- it does `not.toMatch(/^(DROP TABLE|DELETE|TRUNCATE)|DROP COLUMN/m)`;
- the created tables are exactly `['node_depths','skill_leaves','skill_nodes','skill_tree_events']`;
- `ALTER TABLE string_points` adds `node_id`, `need_k`, `need_u` and `need_d`;
- `getTableConfig(skillLeaves)` PK columns equal `['course_code','skill_ref','node_id']`;
- the `nodeDepths` PK equals `['node_id','course_code','instructor']`.

- [ ] **Step 2: Run it**

Run `pnpm vitest run lib/db/__tests__/skill-tree-schema.test.ts`.
Expected: FAIL (file not found).

- [ ] **Step 3: Write `drizzle/0074_skill_tree.sql` and the Drizzle definitions** (exports `skillNodes`, `skillLeaves`, `nodeDepths`, `skillTreeEvents`; `stringPoints` gains `nodeId`, `needK`, `needU`, `needD`).

- [ ] **Step 4: Write the scratch backfill test** (`describe.skipIf(!SCRATCH)` as in `string-queries.test.ts`). After applying 0074 to `gc_curriculum_builder_scratch`:
  - `count(skill_nodes where competency_id is not null) = count(sub_competencies)`;
  - the number of leaves equals the number of distinct `(course_code, skill_ref, competency_id)` over live snapshots;
  - every `competency_levels` row is identical before and after: snapshot the view into a temp table first, then compare with `EXCEPT` both ways and expect 0 rows;
  - a second apply raises `0074: already applied`.

  Apply with `scripts/migrations/p2-scratch-db.sh`-style psql against the scratch DB. Record the command in the test file header.

- [ ] **Step 5: Run both tests**

Run `pnpm vitest run lib/db/__tests__/skill-tree-schema.test.ts lib/db/__tests__/skill-tree-backfill.test.ts`, with `DATABASE_URL` pointing at the scratch DB.
Expected: PASS, and the backfill test is not skipped.

- [ ] **Step 6: Write the live-apply script.** Model it on `scripts/migrations/2026-11-20-levels-live-apply.sh`. Each step ends with an explicit `|| exit 1`:
  - `pg_dump` (the v17 binaries) to `~/Library/Application Support/gc-curriculum-tool/backups/dump-pre-0074-<stamp>.sql.gz`;
  - apply in one psql `-v ON_ERROR_STOP=1`;
  - print the master, leaf and depth counts;
  - run the `competency_levels` before/after `EXCEPT` check, which must print 0.

  Do not run it on live: the owner's yes comes at deploy time.

- [ ] **Step 7: Commit**

```bash
git add drizzle/0074_skill_tree.sql lib/db/schema.ts lib/db/__tests__/skill-tree-schema.test.ts lib/db/__tests__/skill-tree-backfill.test.ts scripts/migrations/2026-11-20-skill-tree-live-apply.sh
git commit -m "feat(skill-tree): 0074 tables, backfill of masters and leaves, live-apply script"
```

---

### Task 2: The pure tree model and readings

**Files:**
- Create: `lib/skill-tree/types.ts`, `lib/skill-tree/read.ts`
- Test: `lib/skill-tree/__tests__/read.test.ts`

**Interfaces:**
- Consumes: `Depth` from `lib/builder/types.ts`.
- Produces:
```ts
// types.ts
export interface TreeNode { id: string; name: string; description: string | null; parentId: string | null; competencyId: string | null;
  foundational: boolean; weight: number; weightSource: 'default' | 'faculty' | 'onet' | 'employer'; mergedInto: string | null; retired: boolean }
export interface TreeLeaf { courseCode: string; skillRef: string; nodeId: string; statement: string; share: number | null;
  source: 'embedding' | 'ai' | 'scoring' | 'faculty'; status: 'proposed' | 'confirmed' | 'rejected' }
export interface HandDepth { nodeId: string; courseCode: string; instructor: string; k: number | null; u: number | null; d: number | null;
  method: 'faculty' | 'ai'; leavesSignature: string; setBy: string }
export interface Tree { nodes: TreeNode[]; leaves: TreeLeaf[]; depths: HandDepth[] }
/** One course version's skills: skillRef -> its K/U/D in that capture. */
export interface VersionSkills { courseCode: string; instructor: string; skills: Map<string, Depth> }
export interface NodeReading extends Depth {
  nodeId: string; byHand: boolean; computed: Depth; needsReview: boolean;
  children: NodeReading[];                // child nodes, in name order
  direct: Array<{ skillRef: string; statement: string; courseCode: string; depth: Depth; weight: number }>;  // leaves placed here that count
  directWeight: number | null;            // the implicit "Skills placed here" child's weight; null when no direct leaves exist in the tree
}
// read.ts
export const counts: (l: TreeLeaf) => boolean;                       // confirmed, or proposed with source !== 'embedding'
export function resolveNode(tree: Tree, id: string): string;         // follows merged_into to the survivor
export function leavesSignature(tree: Tree, nodeId: string, courseCode: string): string;  // sorted counting skillRefs under the node's subtree, hashed
export function readCourse(tree: Tree, v: VersionSkills, nodeId: string): NodeReading;
export function readProgram(tree: Tree, versions: VersionSkills[], nodeId: string): NodeReading;
export function readCareer(tree: Tree, versions: VersionSkills[], weights: Array<{ nodeId: string; weight: number }>): Depth;
export function meets(reading: Depth, need: Depth, foundational: boolean): boolean;
```

**The rule `read.ts` implements:** spec rules 2 and 3, the "missing means missing from this course" call and the foundational rule. A child's weight is its `weight` relative to its siblings.
- **Children of node N:** the live child nodes of N (not retired, not merged), plus one implicit child, "Skills placed here".
  - The implicit child exists when any counting leaf in the whole tree sits directly on N.
  - Its weight is the mean of N's live child-node weights, or 1 when N has no child nodes. Faculty do not set this weight in phase 1.
- **Value of "Skills placed here" for one course version:** per dimension, the weighted average of that version's counting leaves on N that are present in `v.skills`.
  - Each leaf's weight is its `share`, or 1/(the number of counting parents of that leaf).
  - A dimension that is null on every leaf stays null; 0 when the version has no such leaf.
- **N's computed value:** per dimension, Σ(weight × child value) / Σ(weight) over all children. A null child dimension counts as 0, except for foundational nodes.
  - A foundational N, or a node under a foundational ancestor, reports `k = u = null` and computes D only.
  - A node with no children at all reads 0 (D) and K/U as 0, or null if foundational.
- **Hand-set depth:** a matching `(node, course, instructor)` row replaces the value at N for that version (`byHand: true`, `computed` keeps the computed value). Its parents use the hand-set value.
  - `needsReview` is `leavesSignature(...) !== row.leavesSignature`.
- **`readProgram`:** at "Skills placed here", per dimension take the maximum over versions (rule 2: the stronger counts). Average upward exactly as above. Hand-set depths do not apply to program readings.
- **`readCareer`:** the weighted average over the given master nodes of their `readProgram` values, using the same null-as-0 rule.
- **Rounding:** readings are kept unrounded; the UI rounds to one decimal.

- [ ] **Step 1: Write the failing tests** in `read.test.ts`. The fixture is the owner's example:
  - master `color-mgmt`;
  - child `icc` (parent `color-mgmt`) and child `process-control` (parent `color-mgmt`);
  - leaves k1 and k2 of course `GC 3400` on `icc`.

  Cases:
  - `icc averages its two skills`: k1 = {k:3,u:2,d:4} and k2 = {k:1,u:2,d:2} on one version → icc = {k:2,u:2,d:3}.
  - `missing child counts as 0`: color-mgmt for that version = average(icc, process-control = 0) → {k:1,u:1,d:1.5}.
  - `direct leaves count as one child beside parent nodes`: add leaf k3 {k:4,u:4,d:4} directly on color-mgmt → color-mgmt = average(icc, process-control, placed-here) = {k:2,u:2,d:7/3}.
  - `weights shift the average`: process-control weight 3, icc weight 1, no direct leaves → color-mgmt.d = 3/4.
  - `foundational reads D only`: master `agency` foundational with one leaf {k:null,u:null,d:3} → {k:null,u:null,d:3}.
  - `hand-set depth overrides and keeps the suggestion`: a HandDepth on icc {k:5,u:5,d:5} → icc reads 5s, `byHand` true, `computed` {2,2,3}, and color-mgmt uses the 5s.
  - `needs review when the leaves under it change`: the HandDepth's signature is taken with k1 only, then k2 is added → `needsReview` true.
  - `a leaf with two parents splits its share`: k1 on icc and on process-control with share null → in each parent its weight is 0.5 (versus k2's 1 at icc) → icc.d = (0.5·4 + 1·2)/1.5.
  - `gone leaves drop out`: k2 not in `v.skills` → icc = k1 alone.
  - `embedding-only proposals and rejected leaves do not count`.
  - `two versions read separately`: two instructors of GC 3400 with different skill maps give different `readCourse` results; a HandDepth for instructor A does not apply to B.
  - `program takes the stronger version per dimension`: GC 3400 k1 d:4 and GC 4060 k1' (a different skillRef on icc) d:2 → readProgram icc.d = 4 at placed-here before averaging.
  - `merged nodes redirect`: `resolveNode` follows a two-step chain.
  - `career reading weights masters`: two masters at d 4 and 2 with weights 3 and 1 → d 3.5.
  - `meets`: true when every non-null need ≤ the reading; foundational ignores K and U.

- [ ] **Step 2: Run them**

Run `pnpm vitest run lib/skill-tree/__tests__/read.test.ts`.
Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement `types.ts` and `read.ts`** with the signatures above.

- [ ] **Step 4: Run them**

Expected: PASS, all cases.

- [ ] **Step 5: Commit**

Commit `feat(skill-tree): pure tree model and readings (course, program, career)`.

---

### Task 3: Load and write operations

**Files:**
- Create: `lib/db/skill-tree-queries.ts`
- Test: `lib/db/__tests__/skill-tree-queries.test.ts` (scratch only, with tagged rows deleted afterward, as `string-queries.test.ts` does)

**Interfaces:**
- Consumes: the Task 1 tables and Task 2 types.
- Produces:
```ts
export type TreeWrite = { ok: true; tree: Tree; notes?: string[] } | { ok: false; status: 400 | 404 | 409; error: string };
export async function loadTree(): Promise<Tree>;                         // live and retired nodes, all leaves, all depths
export async function createNode(a: { name: string; description?: string | null; parentId: string; by: string }): Promise<TreeWrite>;
export async function renameNode(a: { id: string; name: string; description?: string | null; by: string }): Promise<TreeWrite>;
export async function reparentNode(a: { id: string; parentId: string; by: string }): Promise<TreeWrite>;
export async function mergeNode(a: { from: string; into: string; by: string }): Promise<TreeWrite>;
export async function splitNode(a: { id: string; newName: string; moveNodes: string[]; moveLeaves: Array<{ courseCode: string; skillRef: string }>; by: string }): Promise<TreeWrite & { repoint?: { stringPointIds: string[]; depths: Array<{ courseCode: string; instructor: string }> } }>;
export async function setWeight(a: { id: string; weight: number; by: string }): Promise<TreeWrite>;
export async function placeLeaf(a: { courseCode: string; skillRef: string; statement: string; nodeId: string; by: string }): Promise<TreeWrite>;
export async function decideLeaf(a: { courseCode: string; skillRef: string; nodeId: string; decision: 'confirm' | 'reject'; by: string }): Promise<TreeWrite>;
export async function moveLeaf(a: { courseCode: string; skillRef: string; from: string; to: string; by: string }): Promise<TreeWrite>;
export async function setShare(a: { courseCode: string; skillRef: string; nodeId: string; share: number | null; by: string }): Promise<TreeWrite>;
export async function retargetLeaf(a: { courseCode: string; oldRef: string; newRef: string; newStatement: string; by: string }): Promise<TreeWrite>;
export async function setDepth(a: { nodeId: string; courseCode: string; instructor: string; k: number | null; u: number | null; d: number | null; by: string }): Promise<TreeWrite>;
export async function clearDepth(a: { nodeId: string; courseCode: string; instructor: string; by: string }): Promise<TreeWrite>;
```

**Rules:**
- Every write is one `db.transaction` that writes its row(s) and one `skill_tree_events` row with `before` and `after`, then returns `loadTree()`.
- Masters cannot be created, renamed, reparented, merged or split here. The refusal is "Competencies are edited in the catalog". Weight on a master is allowed.
- **`reparentNode`** refuses a loop with "That would put a skill under itself." (409).
- **`mergeNode`:**
  - sets `from.retired = true` and `merged_into = into`;
  - moves `from`'s child nodes and leaves to `into`. On a leaf PK clash, keep the more decided row;
  - leaves string points pointing at `from` (they resolve via `resolveNode`);
  - refuses merging a master or merging into a descendant.
- **`splitNode`:** creates the new sibling under the same parent and moves the listed children and leaves to it. It returns `repoint` listing the `string_points.node_id = id` rows and the `node_depths` on `id`. Nothing is re-pointed automatically.
- **`placeLeaf`:** inserts a confirmed leaf with source `faculty`, or confirms an existing one.
- **Write-through to links (my call; see the rulings at the end of the plan):** when a leaf becomes confirmed (`placeLeaf` or `decideLeaf` confirm), and its node's master ancestor is competency C, upsert `skill_competency_links` as confirmed with source faculty for each live snapshot of that course whose profile contains the skill. Reject and move do not delete links. This keeps the counting in `competency_levels` in step with what faculty placed.
- **`setDepth`** stores `leavesSignature(tree, nodeId, courseCode)`; its levels are 0–5 or null.
- **`retargetLeaf`** rewrites every leaf `(courseCode, oldRef)` to `newRef` and `newStatement`, keeping nodes, shares and status. If a newRef leaf already exists on a node, the more decided row is kept.

- [ ] **Step 1: Write the failing scratch tests.** One `it` per rule:
  - `create, rename and a logged event`;
  - `reparent refuses a loop` (the tree and the event count are unchanged);
  - `masters refuse structural edits`;
  - `merge moves children and leaves, redirects`;
  - `split returns what to re-point and moves only the listed items`;
  - `confirm writes through to the competency link`: a confirmed leaf under `icc` under master C produces a confirmed link row for C on the course's live snapshot;
  - `reject leaves links alone`;
  - `retarget keeps parents`;
  - `setDepth stores the signature`.

- [ ] **Step 2: Run them on the scratch database**

Run `pnpm vitest run lib/db/__tests__/skill-tree-queries.test.ts`.
Expected: FAIL (module missing), not skipped.

- [ ] **Step 3: Implement `lib/db/skill-tree-queries.ts`.**

- [ ] **Step 4: Run them**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit `feat(skill-tree): load and logged write operations`.

---

### Task 4: Suggestions

**Files:**
- Create: `lib/skill-tree/suggest.ts`
- Test: `lib/skill-tree/__tests__/suggest.test.ts`

**Interfaces:**
- Consumes: `Tree`, `counts`; `embedMissing`, `readVectors` (`lib/db/bundle-queries.ts`, kind `'course_skill'`); `embedBatch`, `DEFAULT_EMBEDDING_MODEL` (`lib/ai/embeddings`); `hashOf`; `cosine` (`lib/builder/candidates.ts`).
- Produces:
```ts
export interface ParentSuggestion { nodeId: string; similarity: number }
/** Pure: top `top` live nodes (masters included) for a skill, scored as the max cosine of the skill against the node's text and its counting leaves. */
export function rankParents(skillVec: number[], tree: Tree, nodeVecs: Map<string, number[]>, leafVecs: Map<string, number[]>, top: number): ParentSuggestion[];
/** Pure: for a leaf gone from the capture, the closest unplaced skill of the same course version, if cosine >= 0.80. */
export function closestNewWording(oldVec: number[], pool: Array<{ skillRef: string; statement: string; vec: number[] }>): { skillRef: string; statement: string; similarity: number } | null;
/** Embeds what is missing (campus, free) and returns suggestions per skillRef; any embedding error returns {} (the UI then shows no suggestion). */
export async function suggestParents(tree: Tree, skills: Array<{ skillRef: string; statement: string }>, top?: number): Promise<Record<string, ParentSuggestion[]>>;
```
- A node's text is `name` plus ` — description` when present, embedded under kind `'course_skill'` with ref `hashOf(text)`. No new embedding kind is needed.
- `top` defaults to 3.
- The 0.80 threshold is my call; see the rulings at the end of the plan.

- [ ] **Step 1: Write the failing tests:**
  - `rankParents orders by best match over name and leaves` (hand-made 3-dimensional vectors);
  - `skips retired and merged nodes`;
  - `closestNewWording returns null below 0.80`;
  - `suggestParents returns {} when embedding throws` (mock `embedBatch` to reject).
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(skill-tree): parent and new-wording suggestions (campus embeddings)`.

---

### Task 5: API

**Files:**
- Create: `app/api/skill-tree/route.ts`
- Test: `app/api/skill-tree/__tests__/route.test.ts` (mock `@/lib/db/skill-tree-queries`, `@/lib/skill-tree/suggest`, `@/lib/auth/route-auth`, as `app/api/settings/search/__tests__/route.test.ts` does)

**Interfaces:**
- Consumes: Tasks 2–4; `authorizeRequest`; `readBody`, `bad`, `authorOf` (`lib/strings/api.ts`); `loadLibrary` for course versions.
- Produces:
  - **`GET /api/skill-tree?course=<code>`** returns `{ tree: Tree, versions: Array<{ instructor: string; snapshotId: string; skills: Array<{ skillRef; statement; k; u; d }>; gone: Array<{ skillRef; statement; suggestion: {skillRef; statement; similarity} | null }> }>, suggestions: Record<string, ParentSuggestion[]> }`.
    - `suggestions` covers only the course's skills with no counting leaf.
    - Without `course`, it returns `{ tree }`.
  - **`POST /api/skill-tree`** takes body `{ action, ...args, authorName? }`. The actions map one-to-one to the Task 3 writes: `create`, `rename`, `reparent`, `merge`, `split`, `weight`, `place`, `confirm`, `reject`, `move`, `share`, `retarget`, `depth`, `depth-clear`.
    - On success it returns 200 `{ tree, notes, repoint? }`.
    - A refusal returns its status and `{ error }`.
    - Missing fields return 400; no author returns 400 "Add your name first.".
  - A version's skills come from `LibraryVersion.skills` (`skillRef`, `statement`, `k`, `u`, `d`).

- [ ] **Step 1: Write the failing tests:**
  - `GET without a course returns the tree`;
  - `GET with a course lists versions, gone leaves and suggestions only for unplaced skills`;
  - `POST place calls placeLeaf with the author`;
  - `POST depth rejects 6 and 1.5 with 400`;
  - `POST refuses an unknown action`;
  - `unauthenticated is refused` (authorizeRequest returns a response).
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(skill-tree): /api/skill-tree read and write`.

---

### Task 6: The shared component

**Files:**
- Create: `app/build/shared/SkillTreePanel.tsx`
- Test: `tests/app/build/skill-tree-panel.test.tsx`

**Interfaces:**
- Consumes: the Task 5 API shapes; `readCourse` from Task 2 (client-side, for instant numbers after each write).
- Produces: `export function SkillTreePanel(props: { courseCode: string | null; mode: 'capture' | 'cluster'; courseCodes?: string[] })`.
  - **`capture`:** one course.
    - **"Place these skills"** comes first. Each unplaced skill shows the three suggested parents as buttons ("Put under ICC profile building"), plus "Somewhere else…" (a searchable node picker) and "New parent skill…" (name plus parent picker).
    - **"No longer in the capture"** shows gone leaves with "Same skill, reworded: <statement>" (Confirm calls `retarget`) or "Remove".
    - **The course's tree** shows only nodes on the path to its leaves.
  - **`cluster`:** the same tree for the given `courseCodes`. Each node row adds Rename, Move under…, Merge into…, Split…, a weight field, and a share field on leaves with more than one parent.
  - **Every node row** shows its K/U/D for the selected version. Foundational rows show "D" only. Hand-set rows read "set by hand", with the computed value as "suggested K2 U2 D3", and show "Review: the skills under it changed" when `needsReview`. Each row expands to its children and placed skills (the drill-down).
  - **"Set by hand"** opens three 0–5 selects and "Clear".
  - Errors show the API's message inline. No optimistic writes: the panel re-renders from the returned tree.
  - **Phone width:** rows wrap and nothing scrolls sideways.

- [ ] **Step 1: Write the failing component tests** (mock `fetch`):
  - `lists unplaced skills with their suggestions and places one` (asserts the POST body `{action:'place', courseCode, skillRef, nodeId}`);
  - `shows a gone skill with its new wording and confirms a retarget`;
  - `foundational nodes show D only`;
  - `hand-set row shows set by hand and the suggestion`;
  - `cluster mode shows structure controls; capture mode does not` (no "Merge into…" in capture mode);
  - `an API refusal shows its message`.
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(skill-tree): shared placement and tree panel`.

---

### Task 7: Mount it in both places

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx`: a "Place skills in the department tree" section after the skill-level review, shown once the profile has competencies.
- Modify: `app/build/clusters/[id]/ClusterBuilder.tsx`: a "Skill tree" side panel or tab with `mode="cluster"` and the cluster's course codes.
- Test: extend `app/build/clusters/__tests__/ClusterBuilder.test.tsx`, and the ProfileReviewPanel test that already renders a profile (find it with `grep -rl ProfileReviewPanel tests app --include=*.test.tsx`).

- [ ] **Step 1: Write the failing tests:**
  - `profile review shows the tree placement for the course`: renders `SkillTreePanel` with the course code in capture mode (mock the module and assert the props);
  - `cluster builder opens the skill tree with its courses`.
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Mount the component.**
- [ ] **Step 4: Run them, plus the existing suites of both files.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(skill-tree): place skills at the end of capture review and on the cluster map`.

---

### Task 8: Readings beside the scorer's, and the department tree page

**Files:**
- Modify: `app/build/[id]/CourseDrawer.tsx`: beside each competency's level, "Tree: K2.0 U1.5 D3.0" (one decimal; D only if foundational) from `readCourse` at that master node. It opens the same drill-down as the panel.
- Create: `app/build/tree/page.tsx` (server; same gate as `/build`), linked from `app/build/page.tsx`. It shows:
  - every master with its program reading over every course's newest version per instructor (`readProgram`), with drill-down;
  - a career-path section: each career target's reading via `readCareer`, using `career_target_requirements` weights for `horizon = 'entry'`.
- **Weight choice per competency:** employer, then faculty, then onet, then ai (spec rule 4). Requirements with a null weight count as 1.
- Test: `tests/app/build/tree-page.test.tsx`, plus an added case in the existing CourseDrawer test.

- [ ] **Step 1: Write the failing tests:**
  - `course drawer shows the tree number beside the scorer's level` (the scorer's number is still present and unchanged);
  - `tree page lists masters with program readings`;
  - `career weight prefers employer over faculty over onet`: a pure helper `careerWeights(rows)` exported from `lib/skill-tree/read.ts` (add it to Task 2's file, with its own test in `read.test.ts`).
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(skill-tree): tree readings beside the scorer's level; department tree page with program and career readings`.

---

### Task 9: A `requires` stop that names a node

**Files:**
- Modify: `lib/db/string-queries.ts` (accept and store `nodeId` and the `need_*` columns on a requires point).
- Modify: `lib/builder/strings/read.ts`: when a requires stop has `nodeId`, its check is `meets(readProgram(tree, upstreamVersions, resolveNode(tree, nodeId)), need, foundational)`. Here `upstreamVersions` are the newest versions of the courses at `develops` stops before it on every string arriving at that stop (rule 1: the whole incoming string is carried). The existing statement-based check is unchanged for stops without a node.
- Modify: `app/build/clusters/StringEdits.tsx`: on a requires stop, "Check against a tree skill…" (node picker plus a K/U/D need).
- Test: `lib/builder/strings/__tests__/read.test.ts` (new cases), `lib/db/__tests__/string-queries.test.ts` (one case).

- [ ] **Step 1: Write the failing tests:**
  - `a node requires stop passes when the arriving courses reach the depth`;
  - `fails when only a non-upstream course reaches it`;
  - `uses the stronger of two arriving strings`;
  - `follows a merged node`;
  - `a requires point stores node and need` (scratch).
- [ ] **Step 2: Run them.**
Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, plus the full strings suites.**
Expected: PASS.
- [ ] **Step 5: Commit**

Commit `feat(skill-tree): requires stops can name a tree skill and a depth`.

---

### Task 10: STATE, the full suite and the deploy hand-off

- [ ] **Step 1:** Run `pnpm vitest run > .superpowers/sdd/skill-tree-suite.log 2>&1; tail -5 .superpowers/sdd/skill-tree-suite.log` and `pnpm tsc --noEmit`.
Expected: all pass and no type errors.

- [ ] **Step 2: Update `docs/STATE.md`:**
  - **What's live:** the tree (`/build/tree`, the panel in capture review and on the cluster map, and the API); migration 0074, NOT applied to live.
  - **Deferred / debt:**
    - fade and reinforcement (phase 2);
    - O*NET bundle starting weights below the masters;
    - the pair judge for parent suggestions;
    - switching the /program cells to the tree (owner decision after comparing);
    - the links write-through ruling.

- [ ] **Step 3: Commit**

Commit `docs(state): skill tree phase 1 built; 0074 awaiting the owner's yes`.

---

## Rulings made in this plan (owner to check)

The spec left these open; each is a call, with what it costs if wrong.

- **Leaves placed directly on a node with child parents count as one implicit child, "Skills placed here", weighted as the siblings' mean.** Without this, the 740 migrated links would read 0 the moment a parent is added under a competency. If wrong, readings shift by up to one sibling's share. This is easy to change in `read.ts`.
- **A confirmed placement writes a confirmed link for its competency** (never deletes), so /program's "links decide whether it counts" stays in step with the tree. If the owner wants the two fully separate until the switch, it's one line removed.
- **Parent suggestions use campus embeddings only** (free); the pair judge is not used for placement in phase 1. If wrong, suggestions are rougher, but faculty confirm every placement.
- **Hand-set depths are per node, course and instructor**, because course versions are per instructor. There are 0 roll-ups live today.
- **Second-level weights start equal; O*NET bundle weights are deferred.** Career readings already use `career_target_requirements` weights.
- **"Reworded" for leaves uses the closest-wording suggestion (cosine ≥ 0.80) plus faculty confirmation,** not the strings' judge cache.
