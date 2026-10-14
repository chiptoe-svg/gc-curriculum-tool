# Wiki `research/` Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a hand-authored, question-led `research/` section in the GC wiki (`/wiki`, the wiki MCP tools, lint) and add an owner-run `sync-research` step that copies `docs/wiki-research/*.md` into the wiki repo's `research/` folder.

**Architecture:**
- One served-types constant in `lib/ai/wiki/schema.ts` replaces the four-section list hard-coded in five reader modules. Generators keep `WIKI_PAGE_TYPES`, so they never touch `research/`.
- Readers that pick up `research` from the constant:
  - the MCP `list_wiki` / `search_wiki`;
  - the `/wiki/[type]/[slug]` renderer;
  - `/wiki` index data;
  - the wikilink resolver;
  - lint.
- Wikilink parsing is fixed for the escaped-pipe form `[[slug\|Label]]`.
- A pure-ish `lib/wiki/research-sync.ts` plus CLI `scripts/wiki/sync-research.ts`:
  - validates the source pages and stamps OKF `timestamp`/`resource`;
  - writes and removes files only inside `research/` and lints them;
  - commits with pathspec `research` only, then pushes.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Vitest 4 (`pnpm vitest run <file>`), node `child_process.execFile` for git, react-markdown + remark-gfm.

**Spec:** [`docs/superpowers/specs/2026-10-14-wiki-research-section-design.md`](../specs/2026-10-14-wiki-research-section-design.md) — binding. Content pages are a separate track (drafted on branch `docs/wiki-research`); this plan builds only the tool support and the sync.

## Global Constraints

- **Worktree only:** `/Users/admin/projects/curriculum_developer-wt-research`, branch `feat/wiki-research` (the controller creates it from `dev`). Never commit in the main checkout, the deploy checkout or another worktree. Implementers never dispatch subagents.
- **No DB changes.** No migration, no schema change, no Drizzle edits.
- **Never touch the live wiki repo** `/Users/admin/projects/gc-curriculum-wiki` in tests or task work. Every test builds its own temp dir (and, for the sync, its own temp bare remote + clone). Modules that read `process.env.WIKI_REPO_PATH` at load (`lib/wiki/git-ops.ts`, `lib/wiki/markdown-helpers.ts`) must be imported dynamically AFTER the test sets the env var (pattern: `tests/lib/ai/wiki/wiki-tools-search-terms.test.ts`).
- **The sync's `--apply` against the real wiki repo is owner-gated** (rollout only, after the owner approves the content pages). Implementers run the CLI only against temp repos.
- **Red-proof** the escaped-pipe tests (renderer and lint) and the generators-leave-research-alone test: show each failing with its fix reverted, paste the red output in the report.
- **US spelling** in code, copy, docs.
- **No `launchctl`, no `pkill`/`killall`.** Kill only PIDs you started. If you start a server for a smoke test, check `~/.dev-ports.yaml`, bind `127.0.0.1`, and kill your PID after.
- **Credentials:** never print them; never copy `.env.local`; any `next build`/`next start` uses `DATABASE_URL` set explicitly to the P2 scratch clone (`bash scripts/migrations/p2-scratch-db.sh url`), never live.
- **tsx:** `node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs <script>` (verify the version dir exists in the worktree).
- **Commit messages** end with the two attribution lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm
  ```
- **STATE.md** is updated in the final task (routes/tools/scripts surface), plus Deferred/debt for anything ruled out.

## Rulings (controller, made while writing this plan; each with what it costs if wrong)

1. **Cross-process serialization.** The spec asks the sync to run "under the same serialization lock as `writeAndPush`". That lock is an in-process promise queue (`lib/wiki/git-ops.ts` `writeQueue`), so it cannot serialize a separate CLI process; `scripts/wiki/refresh-all.ts` already documents the same limit ("do not run this concurrently…"). The sync instead:
   - refuses when tracked files outside `research/` are modified or staged (`git status --porcelain --untracked-files=no`), which is the visible sign of another writer mid-flight;
   - commits with pathspec `-- research`, so nothing outside the folder can enter its commit;
   - treats "nothing to commit after staging" as success when `research/` already matches;
   - is documented as a quiet-window operation, like `refresh-all`.

   *Cost if wrong:* a rare race with an app-side wiki write fails one sync run, which is safe to rerun. A real cross-process lockfile would also change the app's write path, so it is deferred.
2. **Wiki repo docs rows are a one-time manual commit in rollout, not done by the sync.** This keeps the sync's write and delete scope exactly `research/`. The spec's §3.7 text is supplied in Task 6. *Cost if wrong:* one extra manual step.
3. **Untracked files outside `research/` are ignored,** neither refused nor committed. Refusing on them would block the sync whenever the clone has stray files. *Cost if wrong:* none, because pathspec commits can't include them.
4. **Privacy:** research pages are hand-authored. The sync runs only the deterministic check `findResidualIdentifiers` (emails, SSN-like and CUID patterns) and refuses on any hit. It does not run the AI name scrub that `writeAndPush` uses, because named study authors are legitimate content. *Cost if wrong:* a real personal name in a research page would not be scrubbed. The owner's review is the guard for that.
5. **OKF fields:** the sync stamps `resource` (`okfResource('research', slug)`, giving `<origin>/wiki/research/<slug>`) and `timestamp`. The timestamp is the source file's last commit time in this repo (`git log -1 --format=%cI -- <file>`), falling back to the file's mtime. That makes it deterministic, so an unchanged source never produces a diff. Authors supply `type: research`, `title`, `description`, `slug`, `tags`. Lint's OKF check then applies to research pages unchanged.
6. **Ordering:** research pages may carry a numeric `order` frontmatter value. `/wiki` lists by `order` ascending, then by title; pages without `order` sort last. The content track should add `order: 1…7`, with the hub `ai-careers-brief` at 1.
7. **Lint gate scope:** the sync refuses only on error-severity lint issues whose `page` starts with `research/`. Pre-existing errors elsewhere in the wiki don't block it.
8. **Failure restore:** if the post-write lint fails, the sync restores `research/` to `HEAD` (`git restore --source=HEAD --staged --worktree -- research` plus `git clean -fdq -- research`) and throws. This restore is scoped to `research/` only. *Cost if wrong:* if someone had uncommitted hand edits in the clone's `research/`, they would be lost. That clone is sync-owned, and the spec says so.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `lib/wiki/research-sync.ts` | `readResearchSource`, `planResearchSync`, `syncResearch`: validation, stamping, plan, apply (git), lint gate, restore on failure |
| `scripts/wiki/sync-research.ts` | CLI: `--source <dir>` (default `docs/wiki-research`), `--wiki <dir>` (default `WIKI_REPO_PATH` or `/Users/admin/projects/gc-curriculum-wiki`), dry run by default, `--apply` |
| `tests/lib/ai/wiki/served-types.test.ts` | Constant shape + no stray hard-coded section lists |
| `tests/lib/ai/wiki/wiki-tools-research.test.ts` | `list_wiki`/`search_wiki`/`read_wiki` see research pages |
| `lib/wiki/__tests__/wikilinks-research.test.ts` | Resolver: research slugs, escaped pipe, nested slugs rejected |
| `tests/lib/ai/wiki/lint-research.test.ts` | Lint scans research, escaped-pipe links validated, generator-only rules not applied |
| `tests/lib/ai/wiki/generators-skip-research.test.ts` | `rebuildSectionIndexes` never writes/touches `research/` |
| `tests/wiki/index-data-research.test.ts` | `loadWikiIndex().research` order + skip index |
| `tests/lib/wiki/research-sync.test.ts` | Sync against temp bare remote + clone |

**Modified**
- `lib/ai/wiki/schema.ts`: `HAND_AUTHORED_TYPES`, `WIKI_SERVED_TYPES`, `WikiServedType`, `WIKI_SERVED_SCHEMA`.
- `lib/ai/wiki/tools.ts`: use `WIKI_SERVED_TYPES` and update the descriptions.
- `lib/wiki/markdown-helpers.ts`: use `WIKI_SERVED_TYPES`, guard slugs, fix the escaped pipe.
- `lib/ai/wiki/lint.ts`: scan `WIKI_SERVED_TYPES` with `WIKI_SERVED_SCHEMA`, fix the escaped pipe.
- `lib/ai/wiki/update.ts`: `listWikiPagesForHeal` uses `WIKI_PAGE_TYPES`. This is a consolidation only; the generated set is unchanged.
- `lib/wiki/index-data.ts`: a `research: WikiEntry[]` field.
- `app/wiki/[type]/[slug]/page.tsx`: use `WIKI_SERVED_TYPES`; add research labels; the research branch has no related groups.
- `app/wiki/page.tsx`: an "AI and GC careers" section.
- `lib/wiki/git-ops.ts`: header comment only (it names `research-sync.ts` as the second wiki writer).
- `package.json`: script `"wiki:sync-research": "tsx scripts/wiki/sync-research.ts"`.
- `docs/STATE.md` (Task 6).

---

### Task 1: Served-types constant, consolidated readers, MCP tools see research

**Tier:** cheap (complete code below).

**Files:**
- Modify: `lib/ai/wiki/schema.ts`, `lib/ai/wiki/tools.ts`, `lib/ai/wiki/update.ts:98`
- Test: `tests/lib/ai/wiki/served-types.test.ts`, `tests/lib/ai/wiki/wiki-tools-research.test.ts`

**Interfaces:**
- Produces: `HAND_AUTHORED_TYPES = ['research'] as const`, `WIKI_SERVED_TYPES` (`courses, competencies, targets, concepts, research`), `type WikiServedType`, `WIKI_SERVED_SCHEMA: Record<WikiServedType, WikiPageTypeSchema>` (`research: { dir: 'research', requiredSections: [] }`). `WikiPageTypeSchema.dir` widens to `WikiServedType`. `WIKI_PAGE_TYPES`, `WikiPageType` and `WIKI_SCHEMA` are unchanged.

- [ ] **Step 1: Write the failing tests.**

`tests/lib/ai/wiki/served-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  WIKI_PAGE_TYPES, HAND_AUTHORED_TYPES, WIKI_SERVED_TYPES, WIKI_SERVED_SCHEMA,
} from '@/lib/ai/wiki/schema';

describe('wiki served types', () => {
  it('serves the generated sections plus the hand-authored research section', () => {
    expect([...WIKI_SERVED_TYPES]).toEqual([...WIKI_PAGE_TYPES, ...HAND_AUTHORED_TYPES]);
    expect(HAND_AUTHORED_TYPES).toEqual(['research']);
    expect(WIKI_PAGE_TYPES).not.toContain('research');
    expect(WIKI_SERVED_SCHEMA.research).toEqual({ dir: 'research', requiredSections: [] });
    expect(WIKI_SERVED_SCHEMA.courses.requiredSections).toEqual(['Competencies developed', 'Source snapshots']);
  });

  it('no module re-declares the four-section list outside schema.ts', async () => {
    const roots = ['lib', 'app', 'scripts'];
    const re = /\[\s*'courses',\s*'competencies',\s*'targets',\s*'concepts'\s*\]/;
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__') continue;
          await walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !p.endsWith(path.join('lib', 'ai', 'wiki', 'schema.ts'))) {
          if (re.test(await fs.readFile(p, 'utf8'))) offenders.push(p);
        }
      }
    }
    for (const r of roots) await walk(r);
    expect(offenders).toEqual([]);
  });
});
```

`tests/lib/ai/wiki/wiki-tools-research.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ROOT: string;
let tools: typeof import('@/lib/ai/wiki/tools');

beforeAll(async () => {
  ROOT = mkdtempSync(join(tmpdir(), 'wikitools-research-'));
  process.env.WIKI_REPO_PATH = ROOT;
  mkdirSync(join(ROOT, 'courses'), { recursive: true });
  mkdirSync(join(ROOT, 'research'), { recursive: true });
  writeFileSync(join(ROOT, 'courses', 'gc-1010.md'), '---\ntype: course\ntitle: "GC 1010"\n---\n# GC 1010\n');
  writeFileSync(
    join(ROOT, 'research', 'ai-careers-brief.md'),
    '---\ntype: research\ntitle: "AI and GC careers brief"\n---\n# AI and GC careers brief\n\nEntry-level work is changing.\n',
  );
  tools = await import('@/lib/ai/wiki/tools');
});
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe('wiki tools serve research/', () => {
  it('list_wiki includes research pages, and filters by type research', async () => {
    const all = await tools.wikiListTool.execute({}) as { pages: Array<{ path: string; title: string }> };
    expect(all.pages.map(p => p.path)).toContain('research/ai-careers-brief.md');
    const only = await tools.wikiListTool.execute({ type: 'research' }) as { pages: Array<{ path: string; title: string }> };
    expect(only.pages).toEqual([{ path: 'research/ai-careers-brief.md', title: 'AI and GC careers brief' }]);
  });

  it('search_wiki finds research pages', async () => {
    const res = await tools.wikiSearchTool.execute({ query: 'entry-level work' }) as { hits: Array<{ path: string }> };
    expect(res.hits.map(h => h.path)).toContain('research/ai-careers-brief.md');
  });

  it('read_wiki reads a research page', async () => {
    const res = await tools.wikiReadTool.execute({ path: 'research/ai-careers-brief' }) as { path: string; content: string };
    expect(res.path).toBe('research/ai-careers-brief.md');
    expect(res.content).toContain('Entry-level work');
  });
});
```

- [ ] **Step 2: Run them and see them fail.** Run `pnpm vitest run tests/lib/ai/wiki/served-types.test.ts tests/lib/ai/wiki/wiki-tools-research.test.ts`. Expected: the import of `HAND_AUTHORED_TYPES` fails, and the stray-list test lists four offenders (`lib/ai/wiki/tools.ts`, `lib/wiki/markdown-helpers.ts`, `app/wiki/[type]/[slug]/page.tsx`, `lib/ai/wiki/update.ts`; `lib/wiki/index-data.ts` reads sections by name and has no array literal). The research listing assertions fail.

- [ ] **Step 3: Implement `lib/ai/wiki/schema.ts`** by replacing the file below the header comment:
```ts
export const WIKI_PAGE_TYPES = ['courses', 'competencies', 'targets', 'concepts'] as const;
export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number];

/** Hand-authored sections: served (MCP, /wiki, lint, wikilinks) but never
 *  generated — wiki-update / refresh-all / section-index use WIKI_PAGE_TYPES
 *  only. research/ is synced from curriculum_developer/docs/wiki-research by
 *  scripts/wiki/sync-research.ts (spec 2026-10-14). */
export const HAND_AUTHORED_TYPES = ['research'] as const;
export type HandAuthoredType = (typeof HAND_AUTHORED_TYPES)[number];

/** Every section the wiki serves. Readers import THIS, never their own list. */
export const WIKI_SERVED_TYPES = [...WIKI_PAGE_TYPES, ...HAND_AUTHORED_TYPES] as const;
export type WikiServedType = (typeof WIKI_SERVED_TYPES)[number];

export function isWikiServedType(t: string): t is WikiServedType {
  return (WIKI_SERVED_TYPES as readonly string[]).includes(t);
}

export interface WikiPageTypeSchema {
  /** Repo-relative directory holding pages of this type. */
  dir: WikiServedType;
  /** Section headings (any level) a page of this type must contain. Kept to the
   *  load-bearing few so minor prompt copy-edits don't trip the lint. */
  requiredSections: string[];
  /** Concepts only: a page may only be promoted once ≥ N source courses
   *  reference it (frontmatter `related_courses`). Enforces the existing
   *  ≥2-source concept-promotion gate as a checkable rule. */
  minRelatedForPromotion?: number;
}

export const WIKI_SCHEMA: Record<WikiPageType, WikiPageTypeSchema> = {
  courses: { dir: 'courses', requiredSections: ['Competencies developed', 'Source snapshots'] },
  competencies: { dir: 'competencies', requiredSections: ['Across the program'] },
  targets: { dir: 'targets', requiredSections: ['Sub-competencies', 'Program-level rollup'] },
  concepts: { dir: 'concepts', requiredSections: ['The idea'], minRelatedForPromotion: 2 },
};

/** Schema for every served section (generated + hand-authored). */
export const WIKI_SERVED_SCHEMA: Record<WikiServedType, WikiPageTypeSchema> = {
  ...WIKI_SCHEMA,
  research: { dir: 'research', requiredSections: [] },
};
```

- [ ] **Step 4: Implement `lib/ai/wiki/tools.ts`:**
  - Replace lines 23–24 (`const ALLOWED_TYPES …; type WikiType …`) with:
    ```ts
    import { WIKI_SERVED_TYPES, type WikiServedType } from '@/lib/ai/wiki/schema';
    type WikiType = WikiServedType;
    const ALLOWED_TYPES = WIKI_SERVED_TYPES;
    ```
    Move the import up with the other imports.
  - In `listNarrativePages`, update the doc comment to "every `.md` under the served sections (courses/, competencies/, targets/, concepts/, research/)".
  - `list_wiki` description: `'List every narrative wiki page (courses, competencies, targets, concepts, research) with its title. Optionally filter by type. Use this to orient when you don\'t know which page to read. The research section holds the program\'s brief on AI and GC careers.'`
  - `read_wiki` description: add `"research/ai-careers-brief.md"` to the example list.
  - `z.enum(ALLOWED_TYPES)` keeps working, because `WIKI_SERVED_TYPES` is a readonly tuple.

- [ ] **Step 5: Implement `lib/ai/wiki/update.ts`.** Add `import { WIKI_PAGE_TYPES } from '@/lib/ai/wiki/schema';` (or extend the existing schema import if there is one), then replace line 98's `for (const dir of ['courses', 'competencies', 'targets', 'concepts']) {` with `for (const dir of WIKI_PAGE_TYPES) {`. This is a generator path, so it deliberately stays on the generated set.

- [ ] **Step 6: Run the tests again.** Rerun Step 2's two files. Expected: `wiki-tools-research` passes. The stray test still lists `lib/wiki/markdown-helpers.ts` and `app/wiki/[type]/[slug]/page.tsx`. Keep the stray test exactly as written (don't skip it): it turns green in Task 2 (`markdown-helpers`) and Task 3 (`page.tsx`). Say in the report that it is expected to stay red until Task 3, and commit anyway. Also run `pnpm vitest run tests/lib/ai/wiki lib/ai/wiki/__tests__` and `pnpm exec tsc --noEmit -p .`, and confirm nothing else broke.

- [ ] **Step 7: Commit.** `git add lib/ai/wiki/schema.ts lib/ai/wiki/tools.ts lib/ai/wiki/update.ts tests/lib/ai/wiki/served-types.test.ts tests/lib/ai/wiki/wiki-tools-research.test.ts && git commit -m "feat(wiki): served-types constant; MCP list/search/read serve research/"` (with the attribution lines).

---

### Task 2: Wikilinks and lint: research slugs, escaped pipe, research scanning

**Tier:** standard.

**Files:**
- Modify: `lib/wiki/markdown-helpers.ts`, `lib/ai/wiki/lint.ts`
- Test: `lib/wiki/__tests__/wikilinks-research.test.ts`, `tests/lib/ai/wiki/lint-research.test.ts`

**Interfaces:**
- Consumes: `WIKI_SERVED_TYPES`, `WikiServedType`, `WIKI_SERVED_SCHEMA` (Task 1).
- Produces: `resolveWikilinks` resolves `research/<slug>`, accepts `[[slug\|Label]]`, and still renders a nested `[[a/b]]` as broken. `lintWiki` scans `research/` and validates escaped-pipe links. Its `LintIssue.page` for research pages is `research/<file>`.

- [ ] **Step 1: Write the failing tests.**

`lib/wiki/__tests__/wikilinks-research.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ROOT: string;
let resolveWikilinks: typeof import('@/lib/wiki/markdown-helpers').resolveWikilinks;

beforeAll(async () => {
  ROOT = mkdtempSync(join(tmpdir(), 'wikilinks-research-'));
  process.env.WIKI_REPO_PATH = ROOT; // markdown-helpers reads this at module load
  mkdirSync(join(ROOT, 'research'), { recursive: true });
  mkdirSync(join(ROOT, 'targets'), { recursive: true });
  writeFileSync(join(ROOT, 'research', 'career-paths.md'), '---\ntype: research\n---\n');
  writeFileSync(join(ROOT, 'targets', 'brand-strategy.md'), '---\ntype: target\n---\n');
  ({ resolveWikilinks } = await import('@/lib/wiki/markdown-helpers'));
});
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe('resolveWikilinks — research + escaped pipe', () => {
  it('resolves a research slug to /wiki/research/<slug>', () => {
    expect(resolveWikilinks('see [[career-paths]]', '')).toBe('see [career-paths](/wiki/research/career-paths)');
  });

  it('resolves the escaped-pipe table form [[slug\\|Label]]', () => {
    const md = '| Target | Page |\n|---|---|\n| Brand | [[brand-strategy\\|Brand strategy]] |';
    const out = resolveWikilinks(md, '');
    expect(out).toContain('[Brand strategy](/wiki/targets/brand-strategy)');
    expect(out).not.toContain('`');
  });

  it('still resolves the plain pipe form', () => {
    expect(resolveWikilinks('[[brand-strategy|Brand]]', '')).toBe('[Brand](/wiki/targets/brand-strategy)');
  });

  it('never resolves a nested slug', () => {
    expect(resolveWikilinks('[[research/career-paths]]', '')).toBe('`research/career-paths`');
  });
});
```

`tests/lib/ai/wiki/lint-research.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintWiki } from '@/lib/ai/wiki/lint';

let root: string;
const OKF = (type: string, slug: string) =>
  `---\ntype: ${type}\ntitle: "${slug}"\ndescription: "d"\nslug: ${slug}\ntags: [${type}]\ntimestamp: 2026-10-14T00:00:00Z\nresource: https://example.test/wiki/x/${slug}\n---\n`;

async function write(rel: string, body: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wikilint-research-'));
  await write('targets/brand-strategy.md', `${OKF('target', 'brand-strategy')}# Brand\n## Sub-competencies\n- [[ai-careers-brief]]\n## Program-level rollup\nx\n`);
  // research hub: links a target via the escaped-pipe table form, a sibling, and a ghost
  await write('research/ai-careers-brief.md',
    `${OKF('research', 'ai-careers-brief')}# Brief\n\n| Target | Page |\n|---|---|\n| Brand | [[brand-strategy\\|Brand strategy]] |\n\nSee [[career-paths]] and [[ghost-page\\|Ghost]].\n`);
  await write('research/career-paths.md', `${OKF('research', 'career-paths')}# Career paths\n[[ai-careers-brief]]\n`);
  // research page missing OKF keys
  await write('research/bare.md', `---\ntype: research\ntitle: "Bare"\n---\n# Bare\n[[ai-careers-brief]]\n`);
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('lintWiki — research/', () => {
  it('validates escaped-pipe links from research pages (ghost is broken, brand-strategy is not)', async () => {
    const issues = await lintWiki(root);
    const broken = issues.filter(i => i.kind === 'broken-wikilink').map(i => `${i.page} ${i.detail}`);
    expect(broken).toEqual(['research/ai-careers-brief.md [[ghost-page]] → no wiki page has slug "ghost-page"']);
  });

  it('resolves links INTO research from other sections', async () => {
    const issues = await lintWiki(root);
    expect(issues.some(i => i.page === 'targets/brand-strategy.md' && i.kind === 'broken-wikilink')).toBe(false);
  });

  it('applies OKF frontmatter checks to research pages, and no generated-page section rules', async () => {
    const issues = await lintWiki(root);
    expect(issues.find(i => i.page === 'research/bare.md' && i.kind === 'okf-frontmatter-missing')).toBeTruthy();
    expect(issues.some(i => i.page.startsWith('research/') && i.kind === 'missing-section')).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** Run `pnpm vitest run lib/wiki/__tests__/wikilinks-research.test.ts tests/lib/ai/wiki/lint-research.test.ts`. Expected failures:
  - research isn't resolved or scanned;
  - the escaped-pipe link renders as a code span with a trailing backslash in the slug;
  - lint never matches `[[brand-strategy\|…]]`, so the `ghost-page` assertion fails.

- [ ] **Step 3: Implement `lib/wiki/markdown-helpers.ts`:**
  - Replace lines 62–63 with:
    ```ts
    import { WIKI_SERVED_TYPES, type WikiServedType } from '@/lib/ai/wiki/schema';
    type WikiType = WikiServedType;
    ```
    Put the import with the other imports at the top of the file.
  - In `resolveWikiSlug`, first line: `if (!/^[a-z0-9-]+$/.test(slug)) return null; // flat slugs only — never resolve "a/b" or traversal`. Loop `for (const type of WIKI_SERVED_TYPES)`. Update the JSDoc from "four type directories" to "served section directories".
  - Replace the regex in `resolveWikilinks` with:
    ```ts
    // `[^\]|\\]+` keeps a table-escaped `\|` out of the slug; `\\?` swallows that
    // backslash so [[slug\|Label]] (pipe escaped inside a markdown table cell)
    // resolves like [[slug|Label]].
    /\[\[([^\]|\\]+)\\?(?:\|([^\]]+))?\]\]/g,
    ```
  - Add `[[gc-4800\|Custom Text]] → same as the plain pipe form (table-escaped)` to the patterns doc comment.

- [ ] **Step 4: Implement `lib/ai/wiki/lint.ts`:**
  - Change the import to `import { WIKI_SERVED_TYPES, WIKI_SERVED_SCHEMA, type WikiServedType } from './schema';`.
  - `ParsedPage.type: WikiServedType`; `parsePage(type: WikiServedType, …)`.
  - Regex: `const WIKILINK_RE = /\[\[([a-z0-9-]+)\\?(?:\|[^\]]*)?\]\]/gi;`, with the comment `// \\? accepts the table-escaped [[slug\|Label]] form.`
  - `lintWiki`: `for (const type of WIKI_SERVED_TYPES) {`.
  - `WIKI_SCHEMA[p.type]` → `WIKI_SERVED_SCHEMA[p.type]` (both uses).
  - Header comment: add "Scans the generated sections and the hand-authored research/ section."

- [ ] **Step 5: Run the tests again.** Rerun Step 2's files (they should pass), then `pnpm vitest run tests/lib/ai/wiki lib/wiki/__tests__` (the existing lint, OKF and backfill tests must stay green) and `tsc`.

- [ ] **Step 6: Red-proofs (mandatory).**
  1. Revert only the `\\?` / `\\` changes in the `markdown-helpers` regex and rerun the wikilinks test: the escaped-pipe case fails.
  2. Revert only the `\\?` in lint's `WIKILINK_RE` and rerun the lint test: the broken list misses `ghost-page`.

  Restore both. Paste the red and green output in the report.

- [ ] **Step 7: Commit.** `feat(wiki): wikilinks + lint serve research/; fix escaped-pipe [[slug\|Label]]`.

---

### Task 3: `/wiki` index "AI and GC careers" section and the research page renderer

**Tier:** standard.

**Files:**
- Modify: `lib/wiki/index-data.ts`, `app/wiki/[type]/[slug]/page.tsx`, `app/wiki/page.tsx`
- Test: `tests/wiki/index-data-research.test.ts`

**Interfaces:**
- Consumes: `WIKI_SERVED_TYPES`, `isWikiServedType`, `WikiServedType` (Task 1); `resolveWikilinks` (Task 2).
- Produces: `WikiIndexData.research: WikiEntry[]`, ordered by numeric frontmatter `order` ascending, then by title; pages without `order` come last; `type: index` pages are skipped.

- [ ] **Step 1: Write the failing test.** `tests/wiki/index-data-research.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWikiIndex } from '@/lib/wiki/index-data';

let root: string;
const page = (title: string, order?: number) =>
  `---\ntype: research\ntitle: "${title}"\ndescription: "${title} d"\n${order === undefined ? '' : `order: ${order}\n`}---\n# ${title}\n`;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'wiki-index-research-'));
  await mkdir(path.join(root, 'research'));
  await writeFile(path.join(root, 'research', 'what-is-changing.md'), page('What is changing', 2));
  await writeFile(path.join(root, 'research', 'ai-careers-brief.md'), page('AI and GC careers brief', 1));
  await writeFile(path.join(root, 'research', 'documents.md'), page('Documents'));
  await writeFile(path.join(root, 'research', 'index.md'), '---\ntype: index\ntitle: "Research"\n---\n');
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('loadWikiIndex — research', () => {
  it('lists research pages by order, unordered last, skipping index pages', async () => {
    const d = await loadWikiIndex(root);
    expect(d.research.map(r => r.slug)).toEqual(['ai-careers-brief', 'what-is-changing', 'documents']);
    expect(d.research[0]).toEqual({ slug: 'ai-careers-brief', title: 'AI and GC careers brief', description: 'AI and GC careers brief d' });
  });

  it('returns an empty list when there is no research/ dir', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'wiki-index-empty-'));
    try { expect((await loadWikiIndex(empty)).research).toEqual([]); }
    finally { await rm(empty, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run it and see it fail** (`d.research` is undefined).

- [ ] **Step 3: Implement `lib/wiki/index-data.ts`:**
  - Add `research: WikiEntry[];` to `WikiIndexData`, after `concepts`.
  - Add a helper:
    ```ts
    /** Research pages: by numeric `order` ascending, then title; unordered last. */
    function orderedEntries(pages: Array<{ slug: string; fm: Record<string, unknown> }>): WikiEntry[] {
      const ord = (fm: Record<string, unknown>) => {
        const n = Number(fm.order);
        return Number.isFinite(n) && fm.order !== undefined && fm.order !== '' ? n : Number.POSITIVE_INFINITY;
      };
      return [...pages]
        .sort((a, b) => (ord(a.fm) - ord(b.fm)) || (str(a.fm.title) || a.slug).localeCompare(str(b.fm.title) || b.slug))
        .map(toEntry);
    }
    ```
  - In `loadWikiIndex`, add `readPages(root, 'research')` to the `Promise.all`, destructured as `research`, and return `research: orderedEntries(research)`.

- [ ] **Step 4: Implement `app/wiki/[type]/[slug]/page.tsx`:**
  - Replace lines 18–29 (the `ALLOWED_TYPES`, `TYPE_LABEL`, `TYPE_PLURAL` and `isAllowedType` declarations) with:
    ```ts
    import { WIKI_SERVED_TYPES, isWikiServedType, type WikiServedType } from '@/lib/ai/wiki/schema';
    type WikiType = WikiServedType;
    const TYPE_LABEL: Record<WikiType, string> = {
      courses: 'Course', competencies: 'Competency', targets: 'Career target', concepts: 'Concept', research: 'Research',
    };
    const TYPE_PLURAL: Record<WikiType, string> = {
      courses: 'Courses', competencies: 'Competencies', targets: 'Career targets', concepts: 'Concepts', research: 'AI and GC careers',
    };
    const isAllowedType = isWikiServedType;
    void WIKI_SERVED_TYPES; // the served set is owned by schema.ts
    ```
    Put the import with the imports. If `void WIKI_SERVED_TYPES` trips lint, drop it and the unused import.
  - `titleOf` additions: `for (const r of index.research) titleOf.set(r.slug, r.title);`.
  - Retired set: `const retiredComps = type === 'concepts' || type === 'research' ? new Set<string>() : await loadRetiredCompetencyIds()…`. A research page needs no DB call.
  - Change the final `} else {` (the concepts branch) to `} else if (type === 'concepts') {`. Research pages get no related groups, so nothing is added for them.

- [ ] **Step 5: Implement `app/wiki/page.tsx`.** Directly before `<section className="wiki-cols">` (currently line 137), insert:
```tsx
          {data.research.length > 0 && (
            <section className="wiki-cols" aria-labelledby="research-heading">
              <div className="wiki-col">
                <h2 id="research-heading" className="wiki-index__h2">AI and GC careers</h2>
                <p className="wiki-col__intro">What the program sees changing in graduates&rsquo; careers, which skills matter more, and what the curriculum could do. Start with the brief.</p>
                <ul className="wiki-col__list">
                  {data.research.map(r => (
                    <li key={r.slug}>
                      <Link href={`/wiki/research/${r.slug}${q}`}>{r.title}</Link>
                      {r.description && <p>{r.description}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
```
Reuse the existing classes; don't add CSS unless the layout breaks at 390 px (check in Task 6).

- [ ] **Step 6: Run the tests again.** Run `pnpm vitest run tests/wiki tests/lib/ai/wiki/served-types.test.ts`. The stray-list test is now green: no offenders. Run `tsc` and eslint on the changed files.

- [ ] **Step 7: Commit.** `feat(wiki): /wiki lists AI and GC careers; research pages render`.

---

### Task 4: Generators leave `research/` alone

**Tier:** cheap (complete code below).

**Files:**
- Test: `tests/lib/ai/wiki/generators-skip-research.test.ts`
- Modify: none (this pins Task 1's design; the test is the deliverable)

- [ ] **Step 1: Write the test:**
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebuildSectionIndexes } from '@/lib/ai/wiki/section-index';

let root: string;
const BRIEF = '---\ntype: research\ntitle: "Brief"\ntimestamp: 2026-10-14T00:00:00Z\n---\n# Brief\n';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-gen-skip-'));
  await fs.mkdir(path.join(root, 'courses'), { recursive: true });
  await fs.mkdir(path.join(root, 'research'), { recursive: true });
  await fs.writeFile(path.join(root, 'courses', 'gc-1010.md'), '---\ntype: course\ntitle: "GC 1010"\ntimestamp: 2026-10-01T00:00:00Z\n---\n# GC 1010\n');
  await fs.writeFile(path.join(root, 'research', 'ai-careers-brief.md'), BRIEF);
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('generators never write research/', () => {
  it('rebuildSectionIndexes writes generated section hubs only', async () => {
    await rebuildSectionIndexes(root);
    expect(await fs.readdir(path.join(root, 'courses'))).toContain('index.md');
    expect((await fs.readdir(path.join(root, 'research'))).sort()).toEqual(['ai-careers-brief.md']);
    expect(await fs.readFile(path.join(root, 'research', 'ai-careers-brief.md'), 'utf8')).toBe(BRIEF);
  });
});
```

- [ ] **Step 2: Run it.** Expect PASS, because Task 1 kept `WIKI_PAGE_TYPES` generated-only.

- [ ] **Step 3: Red-proof (mandatory).** Temporarily change `rebuildSectionIndexes` in `lib/ai/wiki/section-index.ts` to loop `WIKI_SERVED_TYPES` (import it). Rerun and confirm it FAILS (`research/index.md` appears). Restore the original and confirm green. Paste both outputs.

- [ ] **Step 4: Commit.** `test(wiki): generators never write research/ (red-proofed)`.

---

### Task 5: `sync-research`: library and CLI

**Tier:** most capable (destruction-capable: it deletes stale files in `research/`).

**Files:**
- Create: `lib/wiki/research-sync.ts`, `scripts/wiki/sync-research.ts`, `tests/lib/wiki/research-sync.test.ts`
- Modify: `lib/wiki/git-ops.ts` (header comment only), `package.json` (`wiki:sync-research` script)

**Invariant (state it in the report before coding):**
- At every instant, including across a crash, files outside `<wiki>/research/` are never written, deleted or committed by the sync.
- After a successful `--apply`, `research/*.md` equals the stamped source set exactly, and the commit touches only `research/`.
- After a failed `--apply`, `research/` equals `HEAD`.

**Interfaces:**
- Consumes: `okfResource` and `setFrontmatterLine` (`lib/ai/wiki/okf-frontmatter.ts`); `parseFrontmatter` (`lib/wiki/markdown-helpers.ts`); `findResidualIdentifiers` (`lib/privacy/deterministic.ts`); `lintWiki` (`lib/ai/wiki/lint.ts`); `isMainModule` (`scripts/catalog/catalog-source.ts`).
- Produces:
  ```ts
  export class ResearchSyncRefusal extends Error {}
  export interface ResearchSourcePage { file: string; slug: string; content: string } // content already stamped
  export interface ResearchSyncPlan { write: string[]; remove: string[]; unchanged: string[] }
  export interface ResearchSyncResult { plan: ResearchSyncPlan; applied: boolean; sha: string | null }
  export async function readResearchSource(sourceDir: string, opts?: { base?: string; timestampOf?: (absPath: string) => Promise<string> }): Promise<ResearchSourcePage[]>
  export async function planResearchSync(pages: ResearchSourcePage[], wikiRoot: string): Promise<ResearchSyncPlan>
  export async function syncResearch(opts: { sourceDir: string; wikiRoot: string; apply: boolean; remote?: string; branch?: string; base?: string; timestampOf?: (absPath: string) => Promise<string> }): Promise<ResearchSyncResult>
  ```

- [ ] **Step 1: Write the failing tests** in `tests/lib/wiki/research-sync.test.ts`. Use real git in temp dirs: a bare remote, a clone used as the wiki, and a separate source dir. Inject `timestampOf` so the stamps are deterministic.
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncResearch, readResearchSource, ResearchSyncRefusal } from '@/lib/wiki/research-sync';

let tmp: string; let wiki: string; let src: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const TS = async () => '2026-10-14T12:00:00Z';
const BASE = 'https://example.test';
const page = (slug: string, extra = '', body = `# ${slug}\n\nText.\n`) =>
  `---\ntype: research\ntitle: "${slug}"\ndescription: "about ${slug}"\nslug: ${slug}\ntags: [research]\n${extra}---\n${body}`;

async function w(dir: string, rel: string, body: string) {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}
const OKF_T = (slug: string) => `---\ntype: target\ntitle: "${slug}"\ndescription: "d"\nslug: ${slug}\ntags: [target]\ntimestamp: 2026-10-01T00:00:00Z\nresource: ${BASE}/wiki/targets/${slug}\n---\n# ${slug}\n## Sub-competencies\n- x\n## Program-level rollup\nx\n`;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'research-sync-'));
  const remote = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  wiki = path.join(tmp, 'wiki');
  execFileSync('git', ['clone', '-q', remote, wiki]);
  git(wiki, 'config', 'user.email', 't@example.test'); git(wiki, 'config', 'user.name', 'test');
  git(wiki, 'checkout', '-q', '-b', 'main');
  await w(wiki, 'targets/brand-strategy.md', OKF_T('brand-strategy'));
  git(wiki, 'add', '-A'); git(wiki, 'commit', '-qm', 'seed'); git(wiki, 'push', '-q', 'origin', 'main');
  src = path.join(tmp, 'src');
  await w(src, 'ai-careers-brief.md', page('ai-careers-brief', '', '# Brief\n\nSee [[career-paths]] and [[brand-strategy]].\n'));
  await w(src, 'career-paths.md', page('career-paths', '', '# Career paths\n\n[[ai-careers-brief]]\n'));
  await w(src, 'SOURCES.md', '# reviewer notes — never synced\n');
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

const run = (apply: boolean) => syncResearch({ sourceDir: src, wikiRoot: wiki, apply, base: BASE, timestampOf: TS });

describe('readResearchSource', () => {
  it('stamps resource + timestamp, skips SOURCES.md', async () => {
    const pages = await readResearchSource(src, { base: BASE, timestampOf: TS });
    expect(pages.map(p => p.file).sort()).toEqual(['ai-careers-brief.md', 'career-paths.md']);
    const brief = pages.find(p => p.slug === 'ai-careers-brief')!;
    expect(brief.content).toContain(`resource: ${BASE}/wiki/research/ai-careers-brief`);
    expect(brief.content).toContain('timestamp: 2026-10-14T12:00:00Z');
  });
  it.each([
    ['wrong type', page('x').replace('type: research', 'type: concept'), 'x.md'],
    ['slug mismatch', page('other'), 'x.md'],
    ['email in body', page('x', '', 'mail me at someone@example.edu\n'), 'x.md'],
    ['bad filename', page('X_Y'), 'X_Y.md'],
  ])('refuses: %s', async (_label, body, file) => {
    await fs.rm(src, { recursive: true, force: true });
    await w(src, file, body);
    await expect(readResearchSource(src, { base: BASE, timestampOf: TS })).rejects.toBeInstanceOf(ResearchSyncRefusal);
  });
});

describe('syncResearch', () => {
  it('dry run writes nothing', async () => {
    const r = await run(false);
    expect(r.applied).toBe(false);
    expect(r.plan.write.sort()).toEqual(['ai-careers-brief.md', 'career-paths.md']);
    await expect(fs.stat(path.join(wiki, 'research'))).rejects.toThrow();
    expect(git(wiki, 'status', '--porcelain')).toBe('');
  });

  it('apply copies, commits only research/, pushes; a stray untracked file is untouched', async () => {
    await w(wiki, 'courses/stray.md', 'untracked\n');
    const r = await run(true);
    expect(r.applied).toBe(true);
    expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(wiki, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['research/ai-careers-brief.md', 'research/career-paths.md']);
    expect(git(wiki, 'status', '--porcelain')).toBe('?? courses/stray.md');
    expect(git(wiki, 'rev-parse', 'HEAD')).toBe(git(wiki, 'rev-parse', 'origin/main'));
  });

  it('a second run with unchanged source makes no commit', async () => {
    await run(true);
    const head = git(wiki, 'rev-parse', 'HEAD');
    const r = await run(true);
    expect(r.plan.write).toEqual([]);
    expect(r.sha).toBe(null);
    expect(git(wiki, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('removes research/*.md no longer in the source, and nothing outside research/', async () => {
    await run(true);
    await fs.rm(path.join(src, 'career-paths.md'));
    await w(src, 'ai-careers-brief.md', page('ai-careers-brief', '', '# Brief\n\n[[brand-strategy]]\n'));
    const r = await run(true);
    expect(r.plan.remove).toEqual(['career-paths.md']);
    expect(await fs.readdir(path.join(wiki, 'research'))).toEqual(['ai-careers-brief.md']);
    expect(await fs.readFile(path.join(wiki, 'targets', 'brand-strategy.md'), 'utf8')).toBe(OKF_T('brand-strategy'));
  });

  it('refuses when tracked files outside research/ are modified, and writes nothing', async () => {
    await fs.appendFile(path.join(wiki, 'targets', 'brand-strategy.md'), 'edit\n');
    await expect(run(true)).rejects.toBeInstanceOf(ResearchSyncRefusal);
    await expect(fs.stat(path.join(wiki, 'research'))).rejects.toThrow();
  });

  it('a lint error in research/ refuses and restores research/ to HEAD', async () => {
    await run(true);
    const before = git(wiki, 'rev-parse', 'HEAD');
    await w(src, 'career-paths.md', page('career-paths', '', '# Career paths\n\n[[no-such-page]]\n'));
    await expect(run(true)).rejects.toBeInstanceOf(ResearchSyncRefusal);
    expect(git(wiki, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(wiki, 'status', '--porcelain')).toBe('');
  });

  it('refuses when <wiki>/research is a symlink', async () => {
    const elsewhere = path.join(tmp, 'elsewhere'); await fs.mkdir(elsewhere);
    await fs.symlink(elsewhere, path.join(wiki, 'research'));
    await expect(run(true)).rejects.toBeInstanceOf(ResearchSyncRefusal);
    expect(await fs.readdir(elsewhere)).toEqual([]);
  });

  it('refuses when the source dir is inside the wiki repo', async () => {
    await expect(syncResearch({ sourceDir: path.join(wiki, 'targets'), wikiRoot: wiki, apply: false, base: BASE, timestampOf: TS }))
      .rejects.toBeInstanceOf(ResearchSyncRefusal);
  });
});
```

- [ ] **Step 2: Run the tests and see them fail** (the module doesn't exist).

- [ ] **Step 3: Implement `lib/wiki/research-sync.ts`:**
```ts
/**
 * Sync the hand-authored research/ section into the wiki clone (spec
 * 2026-10-14). The second (and only other) wiki writer besides git-ops'
 * writeAndPush; it writes, deletes and commits ONLY under <wiki>/research/.
 *
 * Invariant: files outside research/ are never written, deleted or committed;
 * after a successful apply research/*.md equals the stamped source set and the
 * commit touches only research/; after a failed apply research/ equals HEAD.
 *
 * Cross-process note: writeAndPush's serialization is in-process only, so this
 * runs in a quiet window (like scripts/wiki/refresh-all.ts). It refuses when
 * tracked files outside research/ are dirty and commits with pathspec
 * `-- research`, so an app-side write can never enter its commit.
 */
import * as childProcess from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '@/lib/wiki/markdown-helpers';
import { okfResource, setFrontmatterLine } from '@/lib/ai/wiki/okf-frontmatter';
import { findResidualIdentifiers } from '@/lib/privacy/deterministic';
import { lintWiki } from '@/lib/ai/wiki/lint';

export class ResearchSyncRefusal extends Error {
  constructor(message: string) { super(message); this.name = 'ResearchSyncRefusal'; }
}

export interface ResearchSourcePage { file: string; slug: string; content: string }
export interface ResearchSyncPlan { write: string[]; remove: string[]; unchanged: string[] }
export interface ResearchSyncResult { plan: ResearchSyncPlan; applied: boolean; sha: string | null }

const SECTION = 'research';
const SKIP = new Set(['SOURCES.md']);
const FILE_RE = /^[a-z0-9-]+\.md$/;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile('git', ['-C', cwd, ...args], (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())));
  });
}

async function defaultTimestamp(absPath: string): Promise<string> {
  try {
    const iso = await git(path.dirname(absPath), ['log', '-1', '--format=%cI', '--', path.basename(absPath)]);
    if (iso) return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch { /* not a git checkout — fall through */ }
  return (await fs.stat(absPath)).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function readResearchSource(
  sourceDir: string,
  opts: { base?: string; timestampOf?: (absPath: string) => Promise<string> } = {},
): Promise<ResearchSourcePage[]> {
  const timestampOf = opts.timestampOf ?? defaultTimestamp;
  let files: string[];
  try {
    files = (await fs.readdir(sourceDir)).filter(f => f.endsWith('.md') && !SKIP.has(f)).sort();
  } catch {
    throw new ResearchSyncRefusal(`source dir not readable: ${sourceDir}`);
  }
  if (files.length === 0) throw new ResearchSyncRefusal(`no research pages in ${sourceDir}`);
  const out: ResearchSourcePage[] = [];
  for (const file of files) {
    if (!FILE_RE.test(file)) throw new ResearchSyncRefusal(`${file}: file names must be lowercase-hyphen slugs ending .md`);
    const slug = file.replace(/\.md$/, '');
    const abs = path.join(sourceDir, file);
    const raw = await fs.readFile(abs, 'utf8');
    const { frontmatter: fm } = parseFrontmatter(raw);
    if (fm.type !== 'research') throw new ResearchSyncRefusal(`${file}: frontmatter type must be "research"`);
    if (fm.slug !== slug) throw new ResearchSyncRefusal(`${file}: frontmatter slug must equal "${slug}"`);
    if (!fm.title || !fm.description) throw new ResearchSyncRefusal(`${file}: title and description are required`);
    const residual = findResidualIdentifiers(raw);
    if (residual.length > 0) throw new ResearchSyncRefusal(`${file}: ${residual.length} email/ID-like pattern(s); remove them before syncing`);
    let content = setFrontmatterLine(raw, 'resource', okfResource(SECTION, slug, opts.base));
    content = setFrontmatterLine(content, 'timestamp', await timestampOf(abs));
    out.push({ file, slug, content });
  }
  return out;
}

async function researchDir(wikiRoot: string): Promise<string> {
  const dir = path.join(wikiRoot, SECTION);
  try {
    const st = await fs.lstat(dir);
    if (st.isSymbolicLink()) throw new ResearchSyncRefusal(`${dir} is a symlink; the sync only writes a real research/ folder`);
    if (!st.isDirectory()) throw new ResearchSyncRefusal(`${dir} exists and is not a directory`);
  } catch (err) {
    if (err instanceof ResearchSyncRefusal) throw err;
    // absent → created on apply
  }
  return dir;
}

export async function planResearchSync(pages: ResearchSourcePage[], wikiRoot: string): Promise<ResearchSyncPlan> {
  const dir = await researchDir(wikiRoot);
  let existing: string[] = [];
  try { existing = (await fs.readdir(dir)).filter(f => f.endsWith('.md')); } catch { /* absent */ }
  const wanted = new Map(pages.map(p => [p.file, p.content]));
  const write: string[] = []; const unchanged: string[] = [];
  for (const [file, content] of wanted) {
    let cur: string | null = null;
    try { cur = await fs.readFile(path.join(dir, file), 'utf8'); } catch { /* new */ }
    (cur === content ? unchanged : write).push(file);
  }
  const remove = existing.filter(f => !wanted.has(f)).sort();
  return { write: write.sort(), remove, unchanged: unchanged.sort() };
}

async function restoreResearch(wikiRoot: string): Promise<void> {
  await git(wikiRoot, ['restore', '--source=HEAD', '--staged', '--worktree', '--', SECTION]).catch(() => undefined);
  await git(wikiRoot, ['clean', '-fdq', '--', SECTION]).catch(() => undefined);
}

export async function syncResearch(opts: {
  sourceDir: string; wikiRoot: string; apply: boolean;
  remote?: string; branch?: string; base?: string;
  timestampOf?: (absPath: string) => Promise<string>;
}): Promise<ResearchSyncResult> {
  const wikiRoot = path.resolve(opts.wikiRoot);
  const sourceDir = path.resolve(opts.sourceDir);
  if (sourceDir === wikiRoot || sourceDir.startsWith(wikiRoot + path.sep)) {
    throw new ResearchSyncRefusal('source dir must be outside the wiki repo');
  }
  const remote = opts.remote ?? 'origin';
  const branch = opts.branch ?? 'main';
  const pages = await readResearchSource(sourceDir, { base: opts.base, timestampOf: opts.timestampOf });
  if (!opts.apply) return { plan: await planResearchSync(pages, wikiRoot), applied: false, sha: null };

  await researchDir(wikiRoot); // symlink refusal before any git/fs write
  const dirty = (await git(wikiRoot, ['status', '--porcelain', '--untracked-files=no']))
    .split('\n').filter(Boolean)
    .filter(l => !l.slice(3).startsWith(`${SECTION}/`));
  if (dirty.length > 0) {
    throw new ResearchSyncRefusal(`wiki clone has tracked changes outside research/ (another writer mid-flight?): ${dirty.join('; ')}`);
  }
  await git(wikiRoot, ['pull', '--ff-only', remote, branch]);

  const plan = await planResearchSync(pages, wikiRoot);
  const dir = path.join(wikiRoot, SECTION);
  try {
    await fs.mkdir(dir, { recursive: true });
    const byFile = new Map(pages.map(p => [p.file, p.content]));
    for (const f of plan.write) await fs.writeFile(path.join(dir, f), byFile.get(f)!);
    for (const f of plan.remove) await fs.rm(path.join(dir, f));
    const errors = (await lintWiki(wikiRoot)).filter(i => i.severity === 'error' && i.page.startsWith(`${SECTION}/`));
    if (errors.length > 0) {
      throw new ResearchSyncRefusal(`lint errors in research/: ${errors.map(e => `${e.page} ${e.kind}: ${e.detail}`).join('; ')}`);
    }
    await git(wikiRoot, ['add', '-A', '--', SECTION]);
    const staged = await git(wikiRoot, ['diff', '--cached', '--name-only', '--', SECTION]);
    if (!staged) return { plan, applied: true, sha: null };
    await git(wikiRoot, ['commit', '-q', '-m', `research: sync ${plan.write.length} written, ${plan.remove.length} removed`, '--', SECTION]);
  } catch (err) {
    await restoreResearch(wikiRoot);
    throw err;
  }
  const sha = await git(wikiRoot, ['rev-parse', 'HEAD']);
  try {
    await git(wikiRoot, ['push', '-q', remote, branch]);
  } catch {
    await git(wikiRoot, ['pull', '--rebase', '-q', remote, branch]);
    await git(wikiRoot, ['push', '-q', remote, branch]);
  }
  return { plan, applied: true, sha: await git(wikiRoot, ['rev-parse', 'HEAD']).catch(() => sha) };
}
```
If a staged-but-unrelated path could slip into the commit via the pathspec, prove otherwise in the report (`git commit -- research` commits only paths under `research`).

- [ ] **Step 4: Implement `scripts/wiki/sync-research.ts`:**
```ts
/**
 * Sync docs/wiki-research/*.md into the wiki repo's research/ folder (spec
 * 2026-10-14). Dry run by default; --apply writes, lints, commits only
 * research/ and pushes. Owner-gated against the real wiki; run in a quiet
 * window (no refresh-all / seed / capture writing the wiki at the same time).
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/wiki/sync-research.ts [--source docs/wiki-research] [--wiki <path>] [--apply]
 *
 * Exit: 0 ok · 2 bad args · 3 refused (validation, dirty clone, lint) · 1 other error.
 */
import path from 'node:path';
import { isMainModule } from '../catalog/catalog-source';
import { syncResearch, ResearchSyncRefusal } from '@/lib/wiki/research-sync';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let source = 'docs/wiki-research';
  let wiki = process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--source' && argv[i + 1]) source = argv[++i]!;
    else if (a === '--wiki' && argv[i + 1]) wiki = argv[++i]!;
    else { console.error(`unknown or incomplete argument: ${a}`); return 2; }
  }
  console.log(`mode: ${apply ? 'APPLY' : 'dry run'}  source: ${path.resolve(source)}  wiki: ${path.resolve(wiki)}`);
  try {
    const r = await syncResearch({ sourceDir: source, wikiRoot: wiki, apply });
    console.log(`write: ${r.plan.write.join(', ') || '—'}`);
    console.log(`remove: ${r.plan.remove.join(', ') || '—'}`);
    console.log(`unchanged: ${r.plan.unchanged.length}`);
    console.log(apply ? (r.sha ? `committed + pushed ${r.sha}` : 'nothing to commit (research/ already matches)') : 'dry run — nothing written');
    return 0;
  } catch (err) {
    if (err instanceof ResearchSyncRefusal) { console.error(`REFUSED: ${err.message}`); return 3; }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().then(code => process.exit(code));
}
```
Check `isMainModule`'s actual signature in `scripts/catalog/catalog-source.ts:32` (`(moduleUrl, argv1)`) and match it. Add `"wiki:sync-research": "tsx scripts/wiki/sync-research.ts"` to `package.json` next to `wiki:lint`. In the `lib/wiki/git-ops.ts` header, change "The ONLY module that writes…" to: "The main wiki writer. All generated-page writes go through writeAndPush(); the hand-authored research/ section is written only by lib/wiki/research-sync.ts (scoped to research/)."

- [ ] **Step 5: Run the tests again.** Run `pnpm vitest run tests/lib/wiki/research-sync.test.ts` (all pass), then the wiki suites, `tsc`, and eslint on the changed files. Run the CLI dry run against a temp clone only. Never run it against `/Users/admin/projects/gc-curriculum-wiki`.

- [ ] **Step 6: Red-proofs.**
  1. Drop the `-- research` pathspec from the commit and stage a tracked change outside research. Use a test variant that seeds a staged outside change after the dirty check, for example by injecting a hook through a temporary edit. This shows the outside change would enter the commit.
  2. Remove the symlink refusal: the symlink test writes into `elsewhere`.
  3. Remove `restoreResearch` from the catch: the lint-failure test leaves `research/` modified.

  Restore everything. Paste the red and green output for each.

- [ ] **Step 7: Commit.** `feat(wiki): sync-research — research/-scoped write, lint gate, pathspec commit`.

---

### Task 6: Hostile review of the sync, verification, STATE.md, rollout notes

**Tier:** most capable (Opus) for the hostile review; standard for the docs.

- [ ] **Step 1: Hostile review (fresh context, Opus, verify by running, temp repos only; iterate to an honest ACCEPT; fix rounds go to an implementer).** Attack:
  - **Deletion and write scope:** look for any path through which the sync writes, deletes, restores or commits outside `research/`. Cover crafted file names in the source (`..`, absolute, uppercase, `index.md`), a `research` path that is a file, a symlink, or contains a symlinked file. Check `restoreResearch` when `research/` doesn't exist in `HEAD` (the first sync failing lint). Check a pre-staged outside change, and an untracked outside file.
  - **Sweep:** can an app-side `writeAndPush` running concurrently put the sync's files into its own commit? (Accepted per Ruling 1; confirm it is benign: the content is identical, and the sync reports "nothing to commit".) Can the sync's commit ever carry non-research paths?
  - **Lint gate:** a broken link, a missing OKF key, and an email. Pre-existing errors elsewhere must not block.
  - **The served-types change:** confirm generators (`section-index`, OKF backfill, `update.ts`) never iterate `research`. Confirm `/wiki/research/<slug>` rejects `..` and nested slugs. Confirm `read_wiki` still refuses `raw/`.

  Record each round in STATE.md as a single line. The full report goes to `.superpowers/sdd/2026-10-14-wiki-research-section/adversarial-round-<n>.md`.

- [ ] **Step 2: Verification gates:**
  - `pnpm exec tsc --noEmit -p .`;
  - eslint on the changed files;
  - `env -u DATABASE_URL pnpm vitest run` (the full suite, recording counts);
  - `next build` with the scratch `DATABASE_URL`;
  - a smoke on a temp wiki copy containing `research/` pages: `next start -H 127.0.0.1 -p <free port>` with `WIKI_REPO_PATH=<temp>` and the scratch `DATABASE_URL`. Check `/wiki` shows "AI and GC careers" and `/wiki/research/<slug>` renders, at 1200 and 390 px (Playwright screenshots to the scratchpad), then kill your PID.

- [ ] **Step 3: Update `docs/STATE.md`** (one commit):
  - the routes table: `/wiki/research/[slug]` and the `/wiki` "AI and GC careers" section;
  - the `/api/mcp` row: list/search/read include `research/`;
  - the scripts: `pnpm wiki:sync-research` (dry run default, `--apply` owner-gated, quiet window);
  - the escaped-pipe fix;
  - Deferred/debt:
    - a cross-process wiki write lock (Ruling 1);
    - a root `index.md` link to the brief (spec §6);
    - wiki repo docs rows (one-time manual, Step 4);
    - automatic resync when the papers change.

- [ ] **Step 4: Rollout notes for the controller.** Write these into STATE.md under the research entry. Steps 3 and 4 below are owner-gated:
  1. Merge `feat/wiki-research` into dev; push `$SHA:main` (the `set -euo pipefail` and 40-character SHA guard); deploy (fast-forward the deploy checkout, `pnpm build`, `launchctl kickstart -k`). No migration.
  2. The content branch `docs/wiki-research` merges after the owner approves the pages, with ai_career's accuracy check done.
  3. **Owner yes:** `pnpm wiki:sync-research` dry run, then `--apply` from the main checkout, in a quiet window.
  4. **Owner yes:** one manual commit in `/Users/admin/projects/gc-curriculum-wiki` adding to `CLAUDE.md` (the two-layer table) and to `README.md` (the "How to contribute" section) this row: "`research/` — hand-authored, synced from `curriculum_developer/docs/wiki-research/` by `pnpm wiki:sync-research`; never regenerated by wiki-update. Edit the source, not the wiki copy."
  5. Smoke: `https://gcworkflow.clemson.edu:8443/wiki` shows "AI and GC careers"; an MCP `search_wiki` for "entry-level" returns `research/` pages.

- [ ] **Step 5: Commit.** `docs(state): wiki research/ section — built, rollout steps`.

---

## Self-review

**Spec coverage**

| Spec item | Task |
|---|---|
| §2.1 question-led ~7 pages | Content track (separate); ordering via `order`, Task 3 |
| §2.4 authored here, synced; `SOURCES.md` not synced | Task 5 (SKIP set) |
| §2.5 never regenerated | Task 1 (generators keep `WIKI_PAGE_TYPES`), Task 4 test |
| §2.6 public like `/wiki` | Task 3 (same route, same `PUBLIC_PREFIXES`) |
| §3.1 one served constant | Task 1 (+ the stray-list test) |
| §3.2 rendering + index section | Task 3 |
| §3.3 MCP list/search | Task 1 |
| §3.4 wikilinks + escaped pipe + tests | Task 2 |
| §3.5 lint scans research, frontmatter | Task 2; OKF keys via Task 5 stamping (Ruling 5) |
| §3.6 sync: copy, remove stale, lint gate, commit `research/` only, push, lock | Task 5 (lock → Ruling 1) |
| §3.7 wiki docs rows | Task 6 Step 4 (Ruling 2) |
| §3.8 root `index.md` out of scope | Task 6 Deferred |
| §4 testing incl. red-proofs | Tasks 1–5; red-proofs in Tasks 2, 4, 5 |
| §5 rollout | Task 6 Step 4 |

**Placeholder scan:** done. Every code step carries its code. Task 5 Step 6's red-proof 1 asks the implementer to build the variant themselves, because it depends on the test harness; this is deliberate.

**Type consistency:**
- `WikiServedType`, `WIKI_SERVED_TYPES`, `WIKI_SERVED_SCHEMA` and `isWikiServedType` are defined in Task 1 and used in Tasks 2 and 3.
- `ResearchSyncRefusal`, `readResearchSource`, `planResearchSync` and `syncResearch` are defined in Task 5 and used by its CLI and tests.
- `WikiIndexData.research` comes from Task 3.

**Content-track dependency:** pages need `type: research`, `slug` equal to the file name, `title`, `description`, `tags`, and an optional `order` (hub `ai-careers-brief` = 1). They must not link with `[[…\|…]]` until Task 2 is live, a constraint already given to the drafting agent.
