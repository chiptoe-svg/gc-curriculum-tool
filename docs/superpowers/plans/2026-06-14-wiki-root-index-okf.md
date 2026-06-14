# Top-Level Wiki index.md OKF Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the gc-curriculum-wiki root `index.md` to OKF v0.1 frontmatter, stamped on regen + backfilled, enforced by `gc-wiki-lint` — completing whole-wiki OKF conformance.

**Architecture:** Reuses Increment #2's machinery. One special-case in the pure `okfResource` (root → `/wiki`), drop the `index.md` exclusion in the regen post-stamp, author title/description in the prompt's index block, add a root-index path to the backfill, and a root-index OKF check to the lint.

**Tech Stack:** TypeScript strict, Vitest, Node fs. Two repos: `curriculum_developer` (code) + `gc-curriculum-wiki` (the wiki clone).

**Branch:** `feat/wiki-root-index-okf` (off `dev`; spec committed `c91da47`).

**Spec:** `docs/superpowers/specs/2026-06-14-wiki-root-index-okf-design.md`

---

## File Structure
- `lib/ai/wiki/okf-frontmatter.ts` (modify) — `okfResource` root-index special-case.
- `lib/ai/wiki/update.ts` (modify) — drop the `p.path !== 'index.md'` stamp exclusion.
- `lib/ai/prompts/wiki-update.md` (modify) — index example block authors title+description.
- `scripts/wiki-backfill-okf.ts` (modify) — `deriveTitle` + `backfillRootIndex` + wire into `main`.
- `lib/ai/wiki/lint.ts` (modify) — root `index.md` OKF check.
- Tests: extend `tests/lib/ai/wiki/okf-frontmatter.test.ts`, `tests/lib/ai/wiki/wiki-backfill-okf.test.ts`, `tests/lib/ai/wiki/lint-okf.test.ts`.
- `docs/STATE.md` (modify, final task).

---

### Task 1: `okfResource` root-index special-case (TDD)

**Files:**
- Modify: `lib/ai/wiki/okf-frontmatter.ts` (the `okfResource` function)
- Test: `tests/lib/ai/wiki/okf-frontmatter.test.ts` (add a case to the existing `okfResource` describe block)

- [ ] **Step 1: Add the failing test.** In `tests/lib/ai/wiki/okf-frontmatter.test.ts`, inside the existing `describe('okfResource', …)` block, add:

```ts
  it('maps the root index type to the wiki home (not /wiki/index/index)', () => {
    expect(okfResource('index', 'index', 'http://x')).toBe('http://x/wiki');
  });
```

- [ ] **Step 2: Run to verify it fails.** `pnpm exec vitest run tests/lib/ai/wiki/okf-frontmatter.test.ts` — expect FAIL (currently returns `http://x/wiki/index/index`).

- [ ] **Step 3: Implement.** In `lib/ai/wiki/okf-frontmatter.ts`, change `okfResource` from:

```ts
export function okfResource(type: string, slug: string, base: string = okfBase()): string {
  const dir = TYPE_TO_DIR[type] ?? type;
  return `${base}/wiki/${dir}/${slug}`;
}
```

to:

```ts
export function okfResource(type: string, slug: string, base: string = okfBase()): string {
  if (type === 'index') return `${base}/wiki`; // root dashboard → wiki home
  const dir = TYPE_TO_DIR[type] ?? type;
  return `${base}/wiki/${dir}/${slug}`;
}
```

- [ ] **Step 4: Run to verify it passes.** `pnpm exec vitest run tests/lib/ai/wiki/okf-frontmatter.test.ts` — expect PASS (all cases).

- [ ] **Step 5: Commit.**
```bash
git add lib/ai/wiki/okf-frontmatter.ts tests/lib/ai/wiki/okf-frontmatter.test.ts
git commit -m "feat(wiki): okfResource maps root index type to the wiki home

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Stamp the root index on regen (drop the exclusion)

**Files:**
- Modify: `lib/ai/wiki/update.ts` (the post-stamp loop, ~lines 1064-1072)

- [ ] **Step 1: Edit the post-stamp block.** In `lib/ai/wiki/update.ts`, the block currently reads:

```ts
    // OKF machine-fields (title/timestamp/tags/resource/slug). The top-level
    // index.md (LLM-authored dashboard with stats) is out of OKF scope; the
    // per-section index.md files are built deterministically in git-ops.
    if (p.path !== 'index.md') {
      const slug = p.path.replace(/^.*\//, '').replace(/\.md$/, '');
      const tsIso = typeof snapshot.createdAt === 'string'
        ? snapshot.createdAt : snapshot.createdAt.toISOString();
      content = stampOkfFrontmatter(content, { slug, timestamp: tsIso });
    }
```

Replace it with (the root index is now stamped too; per-section indexes are still built in git-ops, never in this loop):

```ts
    // OKF machine-fields (title/timestamp/tags/resource/slug) for every
    // LLM-generated page, including the root index.md (the dashboard).
    // Per-section index.md files are built deterministically in git-ops and
    // never flow through this loop.
    {
      const slug = p.path.replace(/^.*\//, '').replace(/\.md$/, '');
      const tsIso = typeof snapshot.createdAt === 'string'
        ? snapshot.createdAt : snapshot.createdAt.toISOString();
      content = stampOkfFrontmatter(content, { slug, timestamp: tsIso });
    }
```

(For `path === 'index.md'`, `slug` derives to `'index'`; `okfResource('index', 'index')` → `<base>/wiki` from Task 1.)

- [ ] **Step 2: Typecheck + wiki tests.** `pnpm exec tsc --noEmit && pnpm exec vitest run tests/lib/ai/wiki/ lib/ai/wiki/__tests__/` — expect no type errors, all pass.

- [ ] **Step 3: Commit.**
```bash
git add lib/ai/wiki/update.ts
git commit -m "feat(wiki): stamp OKF frontmatter on the root index.md too (drop exclusion)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Prompt index block authors title + description

**Files:**
- Modify: `lib/ai/prompts/wiki-update.md` (the `### Index page (\`index.md\`)` example block)

- [ ] **Step 1: Read the block.** Run: `grep -n "Index page\|type: index" lib/ai/prompts/wiki-update.md` and read the YAML block under "### Index page (`index.md`)". It currently is:

```yaml
---
type: index
updated_at: 2026-05-25T14:00:00Z
total_snapshots: 3
total_courses_with_snapshots: 2
---
```

- [ ] **Step 2: Replace it** with:

```yaml
---
type: index
title: "GC Curriculum Knowledge Base"
description: "<one-sentence summary of the wiki>"
timestamp: 2026-05-25T14:00:00Z
total_snapshots: 3
total_courses_with_snapshots: 2
---
```

(The machine-field rule added in Increment #2 — "Do NOT author `tags:`/`timestamp:`/`resource:`/`slug:` …" — already governs the index; `title`+`description` are now author-written here too. If there is index-specific prose right after the block instructing to set `updated_at`, change that mention to `timestamp`.)

- [ ] **Step 3: Verify.** `grep -n "updated_at" lib/ai/prompts/wiki-update.md` should return nothing (no example block uses it now). `grep -n "title:\|description:" lib/ai/prompts/wiki-update.md` should show the index block now has both. `pnpm exec tsc --noEmit` clean.

- [ ] **Step 4: Commit.**
```bash
git add lib/ai/prompts/wiki-update.md
git commit -m "feat(wiki): prompt index block authors title+description, uses timestamp

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Backfill the root index.md (TDD)

**Files:**
- Modify: `scripts/wiki-backfill-okf.ts` (add `deriveTitle`, `backfillRootIndex`, wire into `main`)
- Test: `tests/lib/ai/wiki/wiki-backfill-okf.test.ts` (add cases)

- [ ] **Step 1: Add failing tests.** In `tests/lib/ai/wiki/wiki-backfill-okf.test.ts`, add the import update and new describe blocks. First ensure the import line includes the new exports:

```ts
import { backfillOkf, deriveDescription, deriveTitle, backfillRootIndex } from '@/scripts/wiki-backfill-okf';
```

Then add:

```ts
const ROOT_INDEX = `---
type: index
updated_at: 2026-06-02T21:52:05.837Z
total_snapshots: 7
total_courses_with_snapshots: 5
input_hash: bf940566b9d3
---

# GC Curriculum Knowledge Base

This wiki is the curriculum-facing layer for captured GC course evidence. Start with course pages.

## Courses
`;

describe('deriveTitle', () => {
  it('takes the first heading of the body', () => {
    expect(deriveTitle(ROOT_INDEX)).toBe('GC Curriculum Knowledge Base');
  });
  it('falls back when there is no heading', () => {
    expect(deriveTitle('---\ntype: index\n---\n\nno heading here')).toBe('GC Curriculum Knowledge Base');
  });
});

describe('backfillRootIndex', () => {
  it('migrates the root index to full OKF frontmatter, preserving stats', () => {
    const out = backfillRootIndex(ROOT_INDEX);
    expect(readFrontmatterScalar(out, 'type')).toBe('index');
    expect(readFrontmatterScalar(out, 'title')).toBe('GC Curriculum Knowledge Base');
    expect(readFrontmatterScalar(out, 'description')).toBe('This wiki is the curriculum-facing layer for captured GC course evidence.');
    expect(readFrontmatterScalar(out, 'slug')).toBe('index');
    expect(readFrontmatterScalar(out, 'tags')).toBe('[index]');
    expect(readFrontmatterScalar(out, 'timestamp')).toBe('2026-06-02T21:52:05.837Z');
    expect(readFrontmatterScalar(out, 'resource')).toContain('/wiki');
    expect(readFrontmatterScalar(out, 'resource')).not.toContain('/wiki/index');
    expect(readFrontmatterScalar(out, 'total_snapshots')).toBe('7');
    expect(readFrontmatterScalar(out, 'input_hash')).toBe('bf940566b9d3');
    expect(out).not.toMatch(/^updated_at:/m);
  });
  it('is idempotent', () => {
    const once = backfillRootIndex(ROOT_INDEX);
    expect(backfillRootIndex(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm exec vitest run tests/lib/ai/wiki/wiki-backfill-okf.test.ts` — expect FAIL (`deriveTitle`/`backfillRootIndex` not exported).

- [ ] **Step 3: Implement in `scripts/wiki-backfill-okf.ts`.** Add these two exported functions (after the existing `backfillOkf`):

```ts
/** First `# ` heading of the body (wikilink-stripped); fallback for the root index. */
export function deriveTitle(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const m = body.match(/^#\s+(.+)$/m);
  if (!m) return 'GC Curriculum Knowledge Base';
  return m[1]!
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/"/g, "'")
    .trim();
}

/** Pure: migrate the root index.md to OKF (stamp + derive title/description if absent). */
export function backfillRootIndex(content: string): string {
  let out = stampOkfFrontmatter(content, { slug: 'index' }); // no timestamp opt → preserve updated_at
  if (readFrontmatterScalar(out, 'title') === null) {
    out = setFrontmatterLine(out, 'title', `"${deriveTitle(content)}"`);
  }
  if (readFrontmatterScalar(out, 'description') === null) {
    const desc = deriveDescription(content) || readFrontmatterScalar(out, 'title') || 'index';
    out = setFrontmatterLine(out, 'description', `"${desc}"`);
  }
  return out;
}
```

- [ ] **Step 4: Wire into `main()`.** In `scripts/wiki-backfill-okf.ts`, in `main()`, after the `for (const dir of WIKI_PAGE_TYPES)` loop and immediately before `await rebuildSectionIndexes(root);`, add:

```ts
  // Root index.md (the LLM dashboard) — migrate it too.
  const rootIndexPath = join(root, 'index.md');
  try {
    const before = await readFile(rootIndexPath, 'utf8');
    scanned++;
    const after = backfillRootIndex(before);
    if (after !== before) { await writeFile(rootIndexPath, after); migrated++; console.log('  migrated index.md'); }
  } catch { /* no root index — skip */ }
```

- [ ] **Step 5: Run to verify it passes.** `pnpm exec vitest run tests/lib/ai/wiki/wiki-backfill-okf.test.ts` — expect PASS (existing + 4 new).

- [ ] **Step 6: Commit.**
```bash
git add scripts/wiki-backfill-okf.ts tests/lib/ai/wiki/wiki-backfill-okf.test.ts
git commit -m "feat(wiki): backfill the root index.md to OKF (deriveTitle + backfillRootIndex)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Lint the root index.md (TDD)

**Files:**
- Modify: `lib/ai/wiki/lint.ts` (add a root-index OKF check at the end of `lintWiki`)
- Test: `tests/lib/ai/wiki/lint-okf.test.ts` (add cases)

- [ ] **Step 1: Add failing tests.** In `tests/lib/ai/wiki/lint-okf.test.ts`, add inside the existing `describe('lint — okf-frontmatter-missing', …)` block (the `beforeEach` already creates `root` with two courses):

```ts
  it('flags the root index.md when an OKF key is missing', async () => {
    await writeFile(join(root, 'index.md'),
      `---\ntype: index\ntitle: "GC Curriculum Knowledge Base"\nslug: index\ntimestamp: t\nresource: http://x/wiki\n---\n\n# GC Curriculum Knowledge Base\n`); // missing description + tags
    const issues = await lintWiki(root);
    const rootIssue = issues.find(i => i.kind === 'okf-frontmatter-missing' && i.page === 'index.md');
    expect(rootIssue?.severity).toBe('error');
    expect(rootIssue?.detail).toContain('description');
    expect(rootIssue?.detail).toContain('tags');
  });

  it('is clean for a fully OKF-conformant root index.md', async () => {
    await writeFile(join(root, 'index.md'),
      `---\ntype: index\ntitle: "T"\ndescription: "d"\nslug: index\ntags: [index]\ntimestamp: t\nresource: http://x/wiki\n---\n\n# T\n`);
    const issues = await lintWiki(root);
    expect(issues.filter(i => i.page === 'index.md')).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify it fails.** `pnpm exec vitest run tests/lib/ai/wiki/lint-okf.test.ts` — expect FAIL (root index not checked yet; no `index.md` issue produced).

- [ ] **Step 3: Implement.** In `lib/ai/wiki/lint.ts`, in `lintWiki`, immediately before the final `return issues;`, insert:

```ts
  // Root index.md (repo root, not in a type dir): OKF frontmatter only — it's
  // the LLM dashboard, so skip orphan/missing-section like the section indexes.
  try {
    const rootIndex = await fs.readFile(path.join(root, 'index.md'), 'utf8');
    const missing = OKF_REQUIRED_KEYS.filter(k => !hasFrontmatterKey(rootIndex, k));
    if (missing.length > 0) {
      issues.push({
        kind: 'okf-frontmatter-missing',
        severity: 'error',
        page: 'index.md',
        detail: `missing OKF frontmatter key(s): ${missing.join(', ')}`,
      });
    }
  } catch {
    // no root index.md — skip
  }
```

(`fs`, `path`, `OKF_REQUIRED_KEYS`, and `hasFrontmatterKey` are all already imported/defined in `lint.ts` from Increment #2.)

- [ ] **Step 4: Run new + existing lint tests.** `pnpm exec vitest run tests/lib/ai/wiki/lint-okf.test.ts tests/lib/ai/wiki/lint.test.ts tests/lib/ai/wiki/lint-bands.test.ts` — expect all PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/ai/wiki/lint.ts tests/lib/ai/wiki/lint-okf.test.ts
git commit -m "feat(wiki): gc-wiki-lint enforces OKF frontmatter on the root index.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Run the migration on the real wiki + STATE.md

**Files:**
- Modify: `~/projects/gc-curriculum-wiki/index.md` (migrated by the script — committed in the wiki repo)
- Modify: `docs/STATE.md`

- [ ] **Step 1: Full suite green.** `pnpm test` — all pass. Fix any failure before touching the real wiki.

- [ ] **Step 2: Run the backfill.** `pnpm wiki:backfill-okf` — expect the console to now also report `migrated index.md` (44 scanned: 43 type pages + root index). The type pages are already migrated so only `index.md` should change.

- [ ] **Step 3: Lint.** `pnpm wiki:lint` — expect **0 `okf-frontmatter-missing`** (root index now included). The ~45 pre-existing `broken-wikilink` errors are unchanged. Confirm with `pnpm wiki:lint 2>&1 | grep -c okf-frontmatter-missing` → `0`, and that `index.md` is not among the okf errors.

- [ ] **Step 4: Review + commit the wiki repo.**
```bash
git -C ~/projects/gc-curriculum-wiki diff -- index.md | head -30
git -C ~/projects/gc-curriculum-wiki add -A
git -C ~/projects/gc-curriculum-wiki commit -m "chore(okf): migrate root index.md to OKF v0.1 frontmatter"
git -C ~/projects/gc-curriculum-wiki push
```
(Spot-check: the diff shows `updated_at`→`timestamp`, + `title`/`description`/`slug`/`tags`/`resource`, `total_*`/`input_hash` intact, body unchanged.)

- [ ] **Step 5: Update STATE.md.** In `docs/STATE.md`, in the OKF line, update the "STILL deferred" tail to drop the top-level index item. Replace:

```
STILL deferred: whole-curriculum **bundle zip** (all courses' .md + index.md, reuses the serializer); top-level `index.md` OKF conformance; and the **`/wiki/graph`** view.
```

with:

```
**Root `index.md` OKF conformance — DONE 2026-06-14** (`feat/wiki-root-index-okf`): the wiki's top-level dashboard `index.md` now carries OKF v0.1 frontmatter (stamped on regen, backfilled, lint-enforced via the root-index `okf-frontmatter-missing` check) — the whole wiki is OKF-conformant. Spec [`2026-06-14-wiki-root-index-okf-design.md`](./superpowers/specs/2026-06-14-wiki-root-index-okf-design.md). STILL deferred: whole-curriculum **bundle zip** (all courses' .md + index.md, reuses the serializer); and the **`/wiki/graph`** view.
```

- [ ] **Step 6: Commit STATE.md.**
```bash
git add docs/STATE.md
git commit -m "docs(state): root index.md OKF conformance DONE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification
- [ ] `pnpm test` green; `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm wiki:lint` → 0 `okf-frontmatter-missing` (root index included).
- [ ] Wiki repo committed + pushed; root `index.md` carries all 7 OKF keys + preserved stats.
- [ ] Re-running `pnpm wiki:backfill-okf` yields no further diff (idempotent).

## Self-Review notes (author)
- **Spec coverage:** okfResource special-case → Task 1; regen stamp → Task 2; prompt → Task 3; backfill (deriveTitle/backfillRootIndex) → Task 4; lint → Task 5; real run + STATE → Task 6. ✓
- **No placeholders:** exact code/commands in every step. ✓
- **Type consistency:** `deriveTitle`/`backfillRootIndex` exports referenced consistently in Task 4; `okfResource` signature unchanged; lint reuses existing `OKF_REQUIRED_KEYS`/`hasFrontmatterKey`. ✓
- **Idempotency:** asserted in Tasks 1/4 and the final check. ✓
