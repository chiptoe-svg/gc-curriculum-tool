# Project → Skill → Competency → O*NET Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the public wiki, show for each course project which course skills it builds, which catalog competency each skill feeds, and which O*NET items in that competency's bundle the skill is closest to; and the reverse view on each competency page.

**Architecture:** Links 1–2 are an exact join (normalized statement text) between `CaptureProfile.major_projects[].competencies`, `CaptureProfile.competencies[].statement` and `snapshot_competency_coverage.matched_competency`. Link 3 embeds each course statement once (`item_embeddings` kind `course_skill`, campus embeddings) and picks the nearest core/related bundle items of the matched competency by cosine. A pure module does the joining and ranking; a query module reads rows and vectors; the wiki substrates carry the result and the wiki prompt renders two new sections.

**Tech Stack:** Next.js 15, TypeScript strict, Drizzle/Postgres 17, Vitest; campus embeddings via `lib/ai/embeddings.ts`.

**Spec:** `docs/superpowers/specs/2026-10-22-project-skill-trail-design.md` (approved 2026-10-22).

Work in a new worktree: `git worktree add /Users/admin/projects/curriculum_developer-wt-trail -b feat/project-skill-trail dev`, then `pnpm install` there.

## Global Constraints

- No new judgment about what a course develops: competencies come only from coverage cells' `matched_competency`.
- Join key: `normalizeStatement(s) = s.trim().toLowerCase().replace(/\s+/g, ' ')`.
- Nearest items: within the matched competency only; `bundle_members.status IN ('confirmed','proposed')` and `position IN ('core','related')`; top **3**; cosine ≥ `TRAIL_SIMILARITY_FLOOR` (start **0.5**; Task 5 fixes the final value from real pairs and ledgers it); `proposed` → `provisional: true`.
- An unmatched course statement is listed as "not yet linked to a catalog competency".
- Embedding failures never fail capture or wiki generation: the trail is built without O*NET items.
- No migration (`item_embeddings.kind` already allows `course_skill`). No AI calls except campus embeddings and existing wiki writing.
- Tests: unit/route `env -u DATABASE_URL pnpm -s vitest run <file>`; DB `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run <file>`. Never load `.env.local` against live in tests.
- US spelling; plain-language wiki copy. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm`.

## Review Focus

1. **A statement that two competencies matched** (the scorer can credit one statement to several competencies): the trail must list every competency, not just the first. Test in Task 1.
2. **A project naming a statement that is not in the profile's competencies** (capture drift): it must appear as unlinked text, not vanish or throw. Test in Task 1.
3. **A course with no projects, or `major_projects` null/not an array**: no section, no crash. Test in Task 1.
4. **A competency whose bundle has no embedded items, or a task member whose group key has no vector**: no O*NET line for that skill, no crash. Test in Task 2.
5. **Embedding endpoint down during wiki generation**: the course page is still written, trail without O*NET items. Test in Task 4.

---

## File Structure

- Create `lib/catalog/project-trail.ts` — pure: `normalizeStatement`, `buildProjectTrail`, `nearestItems`, `TRAIL_SIMILARITY_FLOOR`, types.
- Create `lib/db/project-trail-queries.ts` — `courseSkillItems`, `ensureCourseSkillEmbeddings`, `loadProjectTrail`, `loadBuildingProjects`.
- Modify `lib/db/bundle-queries.ts` — `EmbedItem.kind` adds `'course_skill'`.
- Modify `scripts/catalog/embed-items.ts` — also embeds course statements of every latest snapshot.
- Modify `lib/ai/wiki/update.ts` — course message gets `projectTrail`; competency substrate gets `buildingProjects`.
- Modify `lib/ai/prompts/wiki-update.md` — course §"How the projects connect"; competency §"Where students build this".
- Create `scripts/catalog/project-trail-report.ts` — read-only report of similarity pairs, for the floor check.
- Modify `docs/STATE.md`, `docs/architecture.html`, `docs/superpowers/vision/gc-curriculum-tool-vision.html`.

---

### Task 1: Pure trail builder

**Files:**
- Create: `lib/catalog/project-trail.ts`
- Test: `lib/catalog/__tests__/project-trail.test.ts`

**Interfaces:**
- Produces:
  - `export const TRAIL_SIMILARITY_FLOOR = 0.5; export const TRAIL_TOP_N = 3;`
  - `normalizeStatement(s: string): string`
  - `interface TrailCell { competencyId: string; competencyName: string; matched: string; k: number | null; u: number | null; d: number }`
  - `interface TrailItem { label: string; source: 'onet_element' | 'onet_task'; provisional: boolean; similarity: number }`
  - `interface TrailSkill { statement: string; competencies: Array<{ id: string; name: string; k: number | null; u: number | null; d: number; onet: TrailItem[] }> }`
  - `interface TrailProject { title: string; skills: TrailSkill[] }`
  - `buildProjectTrail(input: { projects: unknown; statements: string[]; cells: TrailCell[]; nearest: (statement: string, competencyId: string) => TrailItem[] }): TrailProject[]`
  - `interface Candidate { label: string; source: 'onet_element' | 'onet_task'; provisional: boolean; vector: number[] }`
  - `nearestItems(vector: number[] | undefined, candidates: Candidate[], floor?: number, n?: number): TrailItem[]`

- [ ] **Step 1: Write the failing test**

```ts
// lib/catalog/__tests__/project-trail.test.ts
import { describe, it, expect } from 'vitest';
import { buildProjectTrail, nearestItems, normalizeStatement, type TrailCell } from '@/lib/catalog/project-trail';

const cell = (competencyId: string, matched: string, d = 3): TrailCell => ({ competencyId, competencyName: competencyId.toUpperCase(), matched, k: 2, u: 2, d });
const none = () => [];

describe('normalizeStatement', () => {
  it('trims, lowercases and collapses spaces', () => expect(normalizeStatement('  Color   Proofing ')).toBe('color proofing'));
});

describe('buildProjectTrail', () => {
  const statements = ['Color proofing', 'Press makeready'];
  it('joins project → statement → every competency that matched it, case/space-insensitively', () => {
    const trail = buildProjectTrail({
      projects: [{ title: 'Proof lab', competencies: ['color  proofing'] }],
      statements,
      cells: [cell('color-management', 'Color proofing'), cell('quality-control', 'COLOR PROOFING', 2)],
      nearest: none,
    });
    expect(trail).toEqual([{ title: 'Proof lab', skills: [{ statement: 'Color proofing', competencies: [
      { id: 'color-management', name: 'COLOR-MANAGEMENT', k: 2, u: 2, d: 3, onet: [] },
      { id: 'quality-control', name: 'QUALITY-CONTROL', k: 2, u: 2, d: 2, onet: [] },
    ] }] }]);
  });

  it('keeps an unmatched statement and a statement missing from the profile, with no competencies', () => {
    const trail = buildProjectTrail({ projects: [{ title: 'P', competencies: ['Press makeready', 'Not in profile'] }], statements, cells: [], nearest: none });
    expect(trail[0]!.skills).toEqual([
      { statement: 'Press makeready', competencies: [] },
      { statement: 'Not in profile', competencies: [] },
    ]);
  });

  it('no projects, null or a non-array gives an empty trail', () => {
    for (const projects of [[], null, undefined, 'x', { a: 1 }]) {
      expect(buildProjectTrail({ projects, statements, cells: [], nearest: none })).toEqual([]);
    }
  });

  it('asks nearest() for each (statement, competency) pair', () => {
    const asked: string[] = [];
    buildProjectTrail({ projects: [{ title: 'P', competencies: ['Color proofing'] }], statements, cells: [cell('color-management', 'Color proofing')],
      nearest: (s, c) => { asked.push(`${s}|${c}`); return []; } });
    expect(asked).toEqual(['Color proofing|color-management']);
  });
});

describe('nearestItems', () => {
  const c = (label: string, vector: number[], provisional = false) => ({ label, source: 'onet_element' as const, provisional, vector });
  it('returns the top 3 at or above the floor, best first, with the provisional flag', () => {
    const out = nearestItems([1, 0], [c('a', [1, 0]), c('b', [0.8, 0.6], true), c('c', [0.6, 0.8]), c('d', [0.5, 0.866]), c('far', [0, 1])], 0.5, 3);
    expect(out.map(i => [i.label, i.provisional])).toEqual([['a', false], ['b', true], ['c', false]]);
    expect(out[0]!.similarity).toBeCloseTo(1);
  });
  it('drops pairs below the floor and returns [] with no vector', () => {
    expect(nearestItems([1, 0], [c('far', [0, 1])], 0.5)).toEqual([]);
    expect(nearestItems(undefined, [c('a', [1, 0])])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `env -u DATABASE_URL pnpm -s vitest run lib/catalog/__tests__/project-trail.test.ts`
Expected: FAIL, cannot resolve `@/lib/catalog/project-trail`.

- [ ] **Step 3: Implement**

```ts
// lib/catalog/project-trail.ts
/**
 * Project → course skill → catalog competency → O*NET items (spec
 * docs/superpowers/specs/2026-10-22-project-skill-trail-design.md). Pure.
 * Links 1–2 are an exact join on normalized statement text; which competency a
 * statement feeds is the coverage scorer's decision (matched_competency).
 */
import { cosineSimilarity } from '@/lib/ai/embeddings';

export const TRAIL_SIMILARITY_FLOOR = 0.5;
export const TRAIL_TOP_N = 3;

export function normalizeStatement(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface TrailCell { competencyId: string; competencyName: string; matched: string; k: number | null; u: number | null; d: number }
export interface TrailItem { label: string; source: 'onet_element' | 'onet_task'; provisional: boolean; similarity: number }
export interface TrailSkill { statement: string; competencies: Array<{ id: string; name: string; k: number | null; u: number | null; d: number; onet: TrailItem[] }> }
export interface TrailProject { title: string; skills: TrailSkill[] }
export interface Candidate { label: string; source: 'onet_element' | 'onet_task'; provisional: boolean; vector: number[] }

export function buildProjectTrail(input: {
  projects: unknown; statements: string[]; cells: TrailCell[];
  nearest: (statement: string, competencyId: string) => TrailItem[];
}): TrailProject[] {
  if (!Array.isArray(input.projects)) return [];
  const canonical = new Map(input.statements.map(s => [normalizeStatement(s), s]));
  const cellsBy = new Map<string, TrailCell[]>();
  for (const c of input.cells) {
    const k = normalizeStatement(c.matched);
    const a = cellsBy.get(k);
    if (a) a.push(c); else cellsBy.set(k, [c]);
  }
  const out: TrailProject[] = [];
  for (const p of input.projects as Array<{ title?: unknown; competencies?: unknown }>) {
    if (!p || typeof p.title !== 'string') continue;
    const named = Array.isArray(p.competencies) ? p.competencies.filter((x): x is string => typeof x === 'string') : [];
    const skills: TrailSkill[] = named.map(raw => {
      const key = normalizeStatement(raw);
      const statement = canonical.get(key) ?? raw.trim();
      const competencies = (cellsBy.get(key) ?? [])
        .slice().sort((a, b) => a.competencyId.localeCompare(b.competencyId))
        .map(c => ({ id: c.competencyId, name: c.competencyName, k: c.k, u: c.u, d: c.d, onet: input.nearest(statement, c.competencyId) }));
      return { statement, competencies };
    });
    out.push({ title: p.title, skills });
  }
  return out;
}

export function nearestItems(vector: number[] | undefined, candidates: Candidate[], floor = TRAIL_SIMILARITY_FLOOR, n = TRAIL_TOP_N): TrailItem[] {
  if (!vector) return [];
  return candidates
    .map(c => ({ label: c.label, source: c.source, provisional: c.provisional, similarity: cosineSimilarity(vector, c.vector) }))
    .filter(i => i.similarity >= floor)
    .sort((a, b) => b.similarity - a.similarity || a.label.localeCompare(b.label))
    .slice(0, n);
}
```

- [ ] **Step 4: Run it to verify it passes**

Same command. Expected: PASS (7 tests). Red-proof: change `>= floor` to `> floor + 0.4`, see `nearestItems` fail, restore and `cmp` against a saved copy.

- [ ] **Step 5: Commit**

```bash
git add lib/catalog/project-trail.ts lib/catalog/__tests__/project-trail.test.ts
git commit -m "feat(catalog): pure project → skill → competency → O*NET trail builder"
```

---

### Task 2: Queries — embed course statements, load the trail, load building projects

**Files:**
- Create: `lib/db/project-trail-queries.ts`
- Modify: `lib/db/bundle-queries.ts:60` (`EmbedItem.kind` adds `'course_skill'`)
- Test: `tests/db/project-trail.test.ts` (scratch)

**Interfaces:**
- Consumes: Task 1; `embedMissing`, `readVectors`, `EmbedItem` (`lib/db/bundle-queries.ts`); `textHash` (`lib/catalog/bundles.ts`); `taskGroupKey` (`lib/catalog/shortlist.ts`); `embedBatch`, `DEFAULT_EMBEDDING_MODEL` (`lib/ai/embeddings.ts`).
- Produces:
  - `courseSkillItems(statements: string[]): EmbedItem[]` — kind `course_skill`, `ref = textHash(normalizeStatement(s))`, `text = s.trim()`; de-duplicated by ref.
  - `ensureCourseSkillEmbeddings(ex, snapshotId: string, embed?: (texts: string[]) => Promise<number[][]>): Promise<{ ok: boolean; embedded: number }>` — never throws; `ok: false` on any error (logs `[project-trail]`).
  - `loadProjectTrail(ex, snapshotId: string): Promise<TrailProject[]>`
  - `interface BuildingProject { courseCode: string; project: string; statement: string; onet: TrailItem[] }`
  - `loadBuildingProjects(ex, competencyId: string): Promise<BuildingProject[]>` — over every program-visible course's latest non-retired snapshot.

Rules for `loadProjectTrail`:
- Snapshot row: `course_capture_snapshots` by id (profile jsonb).
- `statements` = `profile.competencies[].statement`; `projects` = `profile.major_projects`.
- `cells` = `snapshot_competency_coverage` rows of that snapshot with `matched_competency IS NOT NULL`, joined to `sub_competencies` (not retired) for the name.
- Candidates per competency: `bundle_members` where `bundle_id = competency`, `status IN ('confirmed','proposed')`, `position IN ('core','related')`, `source IN ('onet_element','onet_task')`; vector: element → `readVectors(ex, 'onet_element', [{ ref: external_id, text }])`. The element's embed text is `elementEmbedText` of its definition; to avoid re-deriving text, read vectors by ref only for this purpose (add `readVectorsByRef(ex, kind, refs, model)` in `lib/db/project-trail-queries.ts`, newest row per ref); task → ref `taskGroupKey(external_label)`. `provisional = status === 'proposed'`; `label = external_label`.
- Statement vector: `readVectorsByRef(ex, 'course_skill', [textHash(normalizeStatement(s))], model)`.
- Load all candidates and vectors once per call, not per pair.

`loadBuildingProjects`: for each latest program-visible snapshot (use `PROGRAM_VISIBLE_SQL` from `lib/courses/program-visibility.ts`, as `getMatrixData` does), build the trail with `loadProjectTrail` and keep every (project, skill) whose competencies include `competencyId`, with that competency's `onet`. Sort by course code, project, statement.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/project-trail.test.ts
/** Read-only against the scratch clone's real snapshots; one rolled-back write for embeddings. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseSkillItems, ensureCourseSkillEmbeddings, loadProjectTrail, loadBuildingProjects } from '@/lib/db/project-trail-queries';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { isP2ScratchDb } from './p2/scratch-guard';

class Rollback extends Error {}

async function aSnapshotWithProjects(): Promise<string | null> {
  const r = (await db.execute(sql`SELECT id FROM course_capture_snapshots WHERE retired_at IS NULL
    AND jsonb_typeof(profile->'major_projects') = 'array' AND jsonb_array_length(profile->'major_projects') > 0 ORDER BY created_at DESC LIMIT 1`)).rows[0] as { id: string } | undefined;
  return r?.id ?? null;
}

describe('courseSkillItems', () => {
  it('de-duplicates by normalized text and uses kind course_skill', () => {
    const items = courseSkillItems(['Color proofing', ' color  PROOFING', 'Press']);
    expect(items.map(i => [i.kind, i.text])).toEqual([['course_skill', 'Color proofing'], ['course_skill', 'Press']]);
  });
});

describe.skipIf(!isP2ScratchDb())('project trail queries (scratch)', () => {
  it('every trail competency is a coverage cell the scorer matched to that statement', async () => {
    const id = await aSnapshotWithProjects();
    expect(id).not.toBeNull();
    const trail = await loadProjectTrail(db, id!);
    expect(trail.length).toBeGreaterThan(0);
    const cells = (await db.execute(sql`SELECT competency_id AS c, matched_competency AS m FROM snapshot_competency_coverage WHERE snapshot_id = ${id} AND matched_competency IS NOT NULL`)).rows as Array<{ c: string; m: string }>;
    const ok = new Set(cells.map(x => `${normalizeStatement(x.m)}|${x.c}`));
    for (const p of trail) for (const s of p.skills) for (const c of s.competencies) expect(ok.has(`${normalizeStatement(s.statement)}|${c.id}`)).toBe(true);
  });

  it('with no course_skill embeddings, skills carry no O*NET items and nothing throws', async () => {
    const id = await aSnapshotWithProjects();
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM item_embeddings WHERE kind = 'course_skill'`);
      const trail = await loadProjectTrail(tx, id!);
      for (const p of trail) for (const s of p.skills) for (const c of s.competencies) expect(c.onet).toEqual([]);
      throw new Rollback('rollback');
    }).catch(e => { if (!(e instanceof Rollback)) throw e; });
  });

  it('ensureCourseSkillEmbeddings embeds missing statements once and reports failure without throwing', async () => {
    const id = await aSnapshotWithProjects();
    await db.transaction(async (tx) => {
      let calls = 0;
      const fake = async (texts: string[]) => { calls++; return texts.map(() => [1, 0, 0]); };
      const first = await ensureCourseSkillEmbeddings(tx, id!, fake);
      expect(first.ok).toBe(true);
      expect(first.embedded).toBeGreaterThan(0);
      const second = await ensureCourseSkillEmbeddings(tx, id!, fake);
      expect(second).toEqual({ ok: true, embedded: 0 });
      expect(calls).toBe(1);
      const failed = await ensureCourseSkillEmbeddings(tx, 'not-a-real-snapshot-0000', async () => { throw new Error('endpoint down'); });
      expect(failed.ok).toBe(true); // nothing to embed for an unknown snapshot
      await tx.execute(sql`DELETE FROM item_embeddings WHERE kind = 'course_skill'`);
      const down = await ensureCourseSkillEmbeddings(tx, id!, async () => { throw new Error('endpoint down'); });
      expect(down.ok).toBe(false);
      throw new Rollback('rollback');
    }).catch(e => { if (!(e instanceof Rollback)) throw e; });
  });

  it('loadBuildingProjects returns only skills that feed the competency', async () => {
    const id = await aSnapshotWithProjects();
    const trail = await loadProjectTrail(db, id!);
    const comp = trail.flatMap(p => p.skills.flatMap(s => s.competencies.map(c => c.id)))[0];
    if (!comp) return; // that snapshot has no matched project skills on this clone
    const rows = await loadBuildingProjects(db, comp);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(typeof r.project).toBe('string');
  });
});
```

`'not-a-real-snapshot-0000'` must be a valid uuid if the id column is uuid; if it is, use `'00000000-0000-0000-0000-000000000000'` and ledger it.

- [ ] **Step 2: Run to verify they fail**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/project-trail.test.ts`
Expected: FAIL, cannot resolve `@/lib/db/project-trail-queries`.

- [ ] **Step 3: Implement** `lib/db/project-trail-queries.ts` per the rules above, and change `EmbedItem` to `kind: 'bundle_card' | 'onet_task' | 'onet_element' | 'course_skill'`. `ensureCourseSkillEmbeddings`: read the snapshot's statements and project-named statements (union), `courseSkillItems`, then `embedMissing(ex, items, DEFAULT_EMBEDDING_MODEL, embed ?? (t => embedBatch(t)))` inside `try`; return `{ ok: true, embedded }` or log and return `{ ok: false, embedded: 0 }`. An unknown snapshot returns `{ ok: true, embedded: 0 }`.

- [ ] **Step 4: Run to verify they pass**

Same command, then `pnpm -s tsc --noEmit`. Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/project-trail-queries.ts lib/db/bundle-queries.ts tests/db/project-trail.test.ts
git commit -m "feat(catalog): project trail queries — course skill embeddings, trail, building projects"
```

---

### Task 3: `embed-items` backfills course statements

**Files:**
- Modify: `scripts/catalog/embed-items.ts` (`buildItems`)
- Test: the existing embed-items test file (find it with `grep -rln "embed-items" tests lib | grep test`)

**Interfaces:**
- Consumes: `courseSkillItems` (Task 2).

- [ ] **Step 1: Write the failing test** in the existing embed-items test: with a fake executor/`buildItems` dependency that returns one latest snapshot whose profile has statements `['A', 'a ', 'B']`, the dry-run report counts `course_skill: 2`. Follow that file's existing fake-executor pattern exactly; if `buildItems` is not injectable there, add a `readLatestStatements?: (ex) => Promise<string[]>` field to `CliDeps` and use it in the test.

- [ ] **Step 2: Run, verify it fails.** Expected: no `course_skill` count.

- [ ] **Step 3: Implement**: in `buildItems`, read every latest non-retired snapshot's `profile.competencies[].statement` plus every `profile.major_projects[].competencies[]` string (SQL with `jsonb_array_elements`, guarding `jsonb_typeof = 'array'`), and append `courseSkillItems(statements)`. Update the header comment (kinds embedded) and the dry-run report so it prints a `course_skill` count.

- [ ] **Step 4: Run, verify it passes.**

- [ ] **Step 5: Commit**: `feat(catalog): embed-items also embeds course skill statements (kind course_skill)`.

---

### Task 4: Wiki substrates and prompt

**Files:**
- Modify: `lib/ai/wiki/update.ts` — course message (`buildMessage`, near the `competencyLinks` field) and `loadCompetencySubstrate`
- Modify: `lib/ai/prompts/wiki-update.md` — course page structure (after item 9 Signature projects) and competency page structure (after "Across the program")
- Test: `tests/db/project-trail.test.ts` (substrate), and the wiki prompt/update unit tests that snapshot the message shape (find with `grep -rln "competencyLinks" lib/ai/wiki/__tests__ tests/lib/ai/wiki`)

**Interfaces:**
- Consumes: `ensureCourseSkillEmbeddings`, `loadProjectTrail`, `loadBuildingProjects` (Task 2).
- Produces: course message field `projectTrail: TrailProject[]`; competency substrate field `buildingProjects: BuildingProject[]`.

- [ ] **Step 1: Write the failing tests**
  - Scratch DB: `loadCompetencySubstrate(<a competency from the trail>)` returns `buildingProjects` with at least one row (reuse `aSnapshotWithProjects` + `loadProjectTrail` to pick the competency; skip when none, as in Task 2).
  - Unit (wiki update tests, existing mocks): when `ensureCourseSkillEmbeddings` is mocked to resolve `{ ok: false, embedded: 0 }` and `loadProjectTrail` to return one project, the message JSON sent to the provider contains `projectTrail` with that project (Review Focus 5: page still generated).

- [ ] **Step 2: Run, verify they fail.**

- [ ] **Step 3: Implement**
  - In `updateWikiForSnapshot`, before building messages: `await ensureCourseSkillEmbeddings(db, snapshot.id)` (best effort; ignore the result), then `const projectTrail = await loadProjectTrail(db, snapshot.id).catch(() => [])`; add `projectTrail` next to `competencyLinks` in `buildMessage`.
  - In `loadCompetencySubstrate`: add `buildingProjects: await loadBuildingProjects(db, subCompetencyId).catch(() => [])` to the returned object and its type.
  - Prompt, course page structure, insert after item 9:

```markdown
9b. **How the projects connect** — render from `projectTrail` when non-empty; omit the section otherwise. One `### {project.title}` per project, then one bullet per skill:
   `{skill.statement} → [[{competency.id}|{competency.name}]] (K{k}/U{u}/D{d}) → closest O*NET: "{onet[0].label}", "{onet[1].label}"`
   Write `null` K or U as a dash. Add ` (provisional)` after an O*NET item whose `provisional` is true. If a skill has several competencies, give one bullet per competency. If `onet` is empty, end the bullet after the depth. If `competencies` is empty, write `{skill.statement} — not yet linked to a catalog competency`. End the section with one plain sentence: the competency link is the coverage scorer's match, and the O*NET items are the closest items in that competency's O*NET bundle by meaning; provisional items have not been reviewed by faculty.
```

  - Prompt, competency page structure, insert after "Across the program":

```markdown
3b. **Where students build this** — render from `substrate.buildingProjects` when non-empty; omit otherwise. Group by course (`[[course-slug|COURSE CODE]]`), then one bullet per project skill: `{project}: {statement}`, followed by ` — closest O*NET: "{label}", "{label}"` when `onet` is non-empty (` (provisional)` where flagged). Then one sentence naming which of this competency's O*NET items appear most often across those bullets.
```

  - Add both fields to the example JSON blocks in the prompt (`"projectTrail": []`, `"buildingProjects": []`).

- [ ] **Step 4: Run, verify they pass**, then `env -u DATABASE_URL pnpm -s vitest run lib/ai/wiki tests/lib/ai/wiki` and `pnpm -s tsc --noEmit`.

- [ ] **Step 5: Commit**: `feat(wiki): course pages show how projects connect; competency pages show where students build it`.

---

### Task 5: Floor check report

**Files:**
- Create: `scripts/catalog/project-trail-report.ts`
- Test: `tests/catalog/project-trail-report.test.ts`

**Interfaces:**
- Consumes: `loadProjectTrail` (Task 2), `nearestItems` with `floor = 0` (Task 1).
- Produces: CLI `--expect-db <name> [--limit 40]`, read-only: for a sample of (skill, competency) pairs from the latest snapshots, prints the skill, the competency and its 5 nearest items with similarities, then a histogram of the top-1 similarity in 0.05 buckets.

- [ ] **Step 1: Write the failing test**: `main([])` → 2; wrong database → 1; with an injected `load` returning one trail and an injected candidate set, the printed text contains the skill, the competency id and a line `0.80` for a candidate at cosine 0.8. Follow `tests/catalog/import-ai-weights.test.ts` for the mocking pattern (`assertExpectedDb` mocked).
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement** (read-only; no `--apply`).
- [ ] **Step 4: Run, verify it passes.**
- [ ] **Step 5: Commit**: `feat(catalog): project trail similarity report (read-only, for the floor check)`.

The floor is fixed on live in Task 6, not here.

---

### Task 6: Live run, floor check, docs

This task's live steps need the owner's yes, as usual; the safety check may require the owner to run them (`!` commands, as with the P3 steps).

- [ ] **Step 1:** Full suite and tsc: `env -u DATABASE_URL pnpm -s vitest run`; `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db`; `pnpm -s tsc --noEmit`. Expected: all pass.
- [ ] **Step 2:** Final whole-branch review (fresh reviewer, most capable model), fix pass as the executing skill describes.
- [ ] **Step 3 (owner yes):** merge to dev, deploy with the SHA guard; `embed-items --expect-db gc_curriculum` dry run (shows the `course_skill` count), then `--apply` (campus embeddings, free).
- [ ] **Step 4:** `project-trail-report --expect-db gc_curriculum` (read-only). Read the histogram and the sample: set `TRAIL_SIMILARITY_FLOOR` to the lowest value at which the listed items still plainly relate to the skill (round to 0.05). If it changes, change the constant, rerun Task 1's tests (adjust the floor test values only if they no longer straddle it), commit, redeploy. Ledger the chosen value with three example pairs above and below it.
- [ ] **Step 5 (owner yes):** wiki refresh of all course and competency pages: `pnpm exec tsx --env-file=.env.local scripts/wiki/refresh-all.ts --dry-run` (prints the call count, about 30), then without `--dry-run`; then `pnpm publish:clemson`. Read three course pages and two competency pages; check `[[links]]` resolve (the link check used on 2026-10-21).
- [ ] **Step 6:** STATE (what's live, the floor, the new CLI and substrate fields), `docs/architecture.html` (a paragraph in the competency section: the project trail and how each link is made) and the vision page (the wiki entry mentions the trail). Commit, push, `pnpm publish:clemson`.
