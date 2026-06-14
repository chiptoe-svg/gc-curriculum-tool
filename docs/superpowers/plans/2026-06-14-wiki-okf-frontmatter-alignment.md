# Wiki OKF-v0.1 Frontmatter Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every `gc-curriculum-wiki` narrative page (4 page types + new per-section `index.md` hubs) to valid OKF v0.1 frontmatter (`type/title/description/slug/tags/timestamp/resource`), enforced by `gc-wiki-lint`, while preserving the domain relations.

**Architecture:** A pure projection module (`lib/ai/wiki/okf-frontmatter.ts`) holds the deterministic OKF transforms (machine-field stamp + section-index builder). The ongoing regen path wires the stamp into `update.ts`'s post-stamp loop and rebuilds section indexes in `git-ops.ts` (the disk writer, which sees the full page set). A one-time deterministic backfill script migrates the ~43 existing pages. `gc-wiki-lint` gains an `okf-frontmatter-missing` error + index special-casing. The wiki schema authority (wiki repo `CLAUDE.md`) and the `wiki-update` prompt are updated so the LLM authors `title`+`description` and leaves the machine fields alone.

**Tech Stack:** TypeScript (strict), Vitest, Node fs, tsx scripts. Two repos: `curriculum_developer` (code) + `gc-curriculum-wiki` (the wiki clone, its own git repo at `~/projects/gc-curriculum-wiki` / env `WIKI_REPO_PATH`).

**Branch:** `feat/wiki-okf-frontmatter` (off `dev`; spec committed at `32f0f0b`).

**Spec:** `docs/superpowers/specs/2026-06-14-wiki-okf-frontmatter-alignment-design.md`

---

## File Structure

- `lib/ai/wiki/okf-frontmatter.ts` (create) — pure: `OKF_REQUIRED_KEYS`, `okfBase`, `deriveTags`, `okfResource`, `stampOkfFrontmatter`, `buildSectionIndex`, plus exported helpers `readFrontmatterScalar`/`setFrontmatterLine`. No I/O.
- `lib/ai/wiki/section-index.ts` (create) — thin I/O wrapper `rebuildSectionIndexes(root)` (reads each section dir, calls `buildSectionIndex`, writes `<type>/index.md`).
- `lib/ai/wiki/update.ts` (modify) — wire `stampOkfFrontmatter` into the post-stamp loop (~line 1060).
- `lib/wiki/git-ops.ts` (modify) — call `rebuildSectionIndexes` inside `writeAndPushSerial` after pages are written (~line 147), before `git add -A`.
- `lib/ai/wiki/lint.ts` (modify) — new `okf-frontmatter-missing` error + `index.md` special-casing.
- `lib/ai/prompts/wiki-update.md` (modify) — emit `title`+`description`, stop emitting `name`.
- `~/projects/gc-curriculum-wiki/CLAUDE.md` (modify) — rewrite the Frontmatter section to OKF vocab + `index` type.
- `scripts/wiki-backfill-okf.ts` (create) + `package.json` (modify) — `pnpm wiki:backfill-okf` deterministic migration.
- Tests: `tests/lib/ai/wiki/okf-frontmatter.test.ts`, `tests/lib/ai/wiki/section-index.test.ts`, `tests/lib/ai/wiki/wiki-backfill-okf.test.ts`, and edits to `tests/lib/ai/wiki/lint.test.ts` (or a new `lint-okf.test.ts`).
- `docs/STATE.md` (modify, final task).

**Scope guard:** the **top-level `index.md`** (repo root, LLM-generated with `total_snapshots` stats) is OUT OF SCOPE — it is not in a section dir, is not linted, and is the natural home of the deferred bundle/graph work. Do NOT OKF-stamp it. Only the four section `<type>/index.md` files are in scope.

---

### Task 1: Pure OKF frontmatter helpers (`okf-frontmatter.ts`)

**Files:**
- Create: `lib/ai/wiki/okf-frontmatter.ts`
- Test: `tests/lib/ai/wiki/okf-frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/wiki/okf-frontmatter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  stampOkfFrontmatter, deriveTags, okfResource, readFrontmatterScalar, setFrontmatterLine,
} from '@/lib/ai/wiki/okf-frontmatter';

const COURSE = `---
type: course
slug: gc-1010
title: "Orientation to Graphic Communications"
level: 1
prerequisites: []
updated_at: 2026-06-04T20:17:27.167Z
contributes_to_targets: [account-management]
develops_competencies: [vendor-management]
input_hash: 4f6771ad1944
evidence_bands: [claimed]
---

# GC 1010

A first-year orientation course.
`;

const COMPETENCY = `---
type: competency
slug: aesthetic-judgment
name: "Aesthetic Judgment"
career_target: brand-strategist
contributing_courses: [gc-4440]
updated_at: 2026-06-02T21:52:05.837Z
input_hash: b85864426669
---

# Aesthetic Judgment
`;

describe('deriveTags', () => {
  it('course → type + level + contributes_to_targets', () => {
    expect(deriveTags('course', COURSE)).toEqual(['course', 'level-1', 'account-management']);
  });
  it('competency → type + career_target when set', () => {
    expect(deriveTags('competency', COMPETENCY)).toEqual(['competency', 'brand-strategist']);
  });
  it('target/concept → type only', () => {
    expect(deriveTags('target', '---\ntype: target\n---')).toEqual(['target']);
    expect(deriveTags('concept', '---\ntype: concept\n---')).toEqual(['concept']);
  });
});

describe('okfResource', () => {
  it('maps singular type → plural dir with base', () => {
    expect(okfResource('competency', 'aesthetic-judgment', 'http://x')).toBe('http://x/wiki/competencies/aesthetic-judgment');
  });
  it('defaults base to the LAN origin', () => {
    expect(okfResource('course', 'gc-1010')).toBe('http://130.127.162.180:3000/wiki/courses/gc-1010');
  });
});

describe('stampOkfFrontmatter', () => {
  it('renames name→title, updated_at→timestamp; adds tags + resource; keeps domain keys', () => {
    const out = stampOkfFrontmatter(COMPETENCY, { slug: 'aesthetic-judgment', base: 'http://x' });
    expect(readFrontmatterScalar(out, 'title')).toBe('Aesthetic Judgment');
    expect(out).not.toMatch(/^name:/m);
    expect(readFrontmatterScalar(out, 'timestamp')).toBe('2026-06-02T21:52:05.837Z');
    expect(out).not.toMatch(/^updated_at:/m);
    expect(readFrontmatterScalar(out, 'tags')).toBe('[competency, brand-strategist]');
    expect(readFrontmatterScalar(out, 'resource')).toBe('http://x/wiki/competencies/aesthetic-judgment');
    expect(readFrontmatterScalar(out, 'career_target')).toBe('brand-strategist'); // preserved
    expect(readFrontmatterScalar(out, 'input_hash')).toBe('b85864426669'); // preserved
    expect(out).toContain('# Aesthetic Judgment'); // body preserved
  });

  it('uses an explicit timestamp opt when given (overrides updated_at)', () => {
    const out = stampOkfFrontmatter(COURSE, { slug: 'gc-1010', timestamp: '2026-06-14T00:00:00.000Z' });
    expect(readFrontmatterScalar(out, 'timestamp')).toBe('2026-06-14T00:00:00.000Z');
  });

  it('is idempotent (no timestamp opt → preserves prior value)', () => {
    const once = stampOkfFrontmatter(COURSE, { slug: 'gc-1010', base: 'http://x' });
    const twice = stampOkfFrontmatter(once, { slug: 'gc-1010', base: 'http://x' });
    expect(twice).toBe(once);
  });

  it('does not touch description (author/backfill owned)', () => {
    const withDesc = COURSE.replace('title: "Orientation to Graphic Communications"', 'title: "Orientation to Graphic Communications"\ndescription: "hand-written"');
    const out = stampOkfFrontmatter(withDesc, { slug: 'gc-1010' });
    expect(readFrontmatterScalar(out, 'description')).toBe('hand-written');
  });
});

describe('setFrontmatterLine', () => {
  it('appends a key when absent and replaces when present', () => {
    const added = setFrontmatterLine(COMPETENCY, 'description', '"d"');
    expect(readFrontmatterScalar(added, 'description')).toBe('d');
    const replaced = setFrontmatterLine(added, 'description', '"e"');
    expect(readFrontmatterScalar(replaced, 'description')).toBe('e');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/wiki/okf-frontmatter.test.ts`
Expected: FAIL — module `@/lib/ai/wiki/okf-frontmatter` does not exist.

- [ ] **Step 3: Implement `lib/ai/wiki/okf-frontmatter.ts`**

```ts
/**
 * Pure OKF-v0.1 frontmatter projection for the gc-curriculum-wiki layer.
 * No I/O, no AI. Deterministic + idempotent. Consumed by update.ts (ongoing
 * regen post-stamp) and scripts/wiki-backfill-okf.ts (one-time migration).
 *
 * Postgres remains the source of truth; this only normalizes the markdown
 * face's frontmatter to the OKF vocabulary. Domain relation keys
 * (develops_competencies, contributes_to_targets, evidence_bands, input_hash,
 * …) are preserved untouched.
 */
import { WIKI_PAGE_TYPES, type WikiPageType } from './schema';

export const OKF_REQUIRED_KEYS = ['type', 'title', 'description', 'slug', 'tags', 'timestamp', 'resource'] as const;

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const DEFAULT_BASE = 'http://130.127.162.180:3000';

/** Public origin used in `resource:` URLs. Env-overridable; LAN default. */
export function okfBase(): string {
  return process.env.WIKI_PUBLIC_ORIGIN ?? DEFAULT_BASE;
}

/** Singular frontmatter `type` → plural section dir used in /wiki/<dir>/<slug>. */
const TYPE_TO_DIR: Record<string, string> = {
  course: 'courses', competency: 'competencies', target: 'targets', concept: 'concepts',
};

function blockOf(content: string): string | null {
  const m = content.match(FRONTMATTER_RE);
  return m ? m[1]! : null;
}

/** Read a scalar `key: value` (unquoted) from a page's frontmatter. */
export function readFrontmatterScalar(content: string, key: string): string | null {
  const block = blockOf(content);
  if (block === null) return null;
  const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m && m[1] ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function scalarInBlock(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m && m[1] ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function listInBlock(block: string, key: string): string[] {
  const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m || !m[1]) return [];
  const v = m[1].trim();
  if (v.startsWith('[')) return v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  return v && v !== 'null' ? [v] : [];
}

function setLine(block: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  return re.test(block) ? block.replace(re, line) : `${block}\n${line}`;
}

function removeLine(block: string, key: string): string {
  return block.replace(new RegExp(`^${key}:\\s*.*$\\n?`, 'm'), '');
}

/** Set or replace `key: value` in a page's frontmatter block (public; used by the backfill for description). */
export function setFrontmatterLine(content: string, key: string, value: string): string {
  const block = blockOf(content);
  if (block === null) return content;
  return content.replace(FRONTMATTER_RE, `---\n${setLine(block, key, value)}\n---\n`);
}

/** Deterministic OKF tags for a page, from its type + relation keys in its block. */
export function deriveTags(type: string, contentOrBlock: string): string[] {
  const block = blockOf(contentOrBlock) ?? contentOrBlock;
  switch (type) {
    case 'course': {
      const level = scalarInBlock(block, 'level');
      return ['course', ...(level ? [`level-${level}`] : []), ...listInBlock(block, 'contributes_to_targets')];
    }
    case 'competency': {
      const ct = scalarInBlock(block, 'career_target');
      return ['competency', ...(ct && ct !== 'null' ? [ct] : [])];
    }
    case 'target': return ['target'];
    case 'concept': return ['concept'];
    default: return [type];
  }
}

export function okfResource(type: string, slug: string, base: string = okfBase()): string {
  const dir = TYPE_TO_DIR[type] ?? type;
  return `${base}/wiki/${dir}/${slug}`;
}

export interface OkfStampOpts { slug: string; timestamp?: string; base?: string; }

/**
 * Idempotent: stamp the OKF MACHINE fields into a page's frontmatter —
 * title (from a legacy `name`), timestamp (explicit opt, else renamed from a
 * legacy `updated_at`), canonical slug, deterministic tags, resource URL.
 * Does NOT touch `description` (author/backfill owned) or any domain key.
 * Same input → same output.
 */
export function stampOkfFrontmatter(content: string, opts: OkfStampOpts): string {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return content;
  let block = m[1]!;
  const type = scalarInBlock(block, 'type') ?? '';

  // name → title (only when title absent)
  const name = scalarInBlock(block, 'name');
  if (name !== null && scalarInBlock(block, 'title') === null) {
    block = setLine(block, 'title', `"${name}"`);
  }
  block = removeLine(block, 'name');

  // timestamp: explicit opt wins; else rename updated_at preserving its value.
  const ts = opts.timestamp ?? scalarInBlock(block, 'updated_at');
  if (ts) block = setLine(block, 'timestamp', ts);
  block = removeLine(block, 'updated_at');

  block = setLine(block, 'slug', opts.slug);
  block = setLine(block, 'tags', `[${deriveTags(type, block).join(', ')}]`);
  block = setLine(block, 'resource', okfResource(type, opts.slug, opts.base));

  return content.replace(FRONTMATTER_RE, `---\n${block}\n---\n`);
}

// ---------------------------------------------------------------------------
// Section index builder (pure) — see Task 2 for tests.
// ---------------------------------------------------------------------------

export interface IndexEntry { slug: string; title: string; description: string; }

const SECTION_META: Record<WikiPageType, { title: string; noun: string }> = {
  courses: { title: 'Courses', noun: 'course' },
  competencies: { title: 'Competencies', noun: 'competency' },
  targets: { title: 'Targets', noun: 'career-target' },
  concepts: { title: 'Concepts', noun: 'concept' },
};

/**
 * Deterministic OKF `index` page for a section. Courses sort by slug; other
 * sections sort by title. `timestamp` is supplied by the caller (the max member
 * timestamp) so the page is stable across rebuilds when nothing changed.
 */
export function buildSectionIndex(
  type: WikiPageType, entries: IndexEntry[], timestamp: string, base: string = okfBase(),
): string {
  const meta = SECTION_META[type];
  const sorted = [...entries].sort((a, b) =>
    type === 'courses' ? a.slug.localeCompare(b.slug) : a.title.localeCompare(b.title));
  const fm = [
    '---',
    'type: index',
    `title: "${meta.title}"`,
    `description: "Index of ${meta.noun} pages in the GC curriculum wiki."`,
    `slug: ${type}`,
    `tags: [index, ${type}]`,
    `timestamp: ${timestamp}`,
    `resource: ${base}/wiki/${type}`,
    '---',
    '',
    `# ${meta.title}`,
    '',
  ];
  const lines = sorted.map(e => `- [[${e.slug}]]${e.description ? ` — ${e.description}` : ''}`);
  return fm.join('\n') + lines.join('\n') + '\n';
}

export { WIKI_PAGE_TYPES };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/lib/ai/wiki/okf-frontmatter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/okf-frontmatter.ts tests/lib/ai/wiki/okf-frontmatter.test.ts
git commit -m "feat(wiki): pure OKF frontmatter stamp + tag/resource derivation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Section-index builder tests

**Files:**
- Modify: (none — `buildSectionIndex` was implemented in Task 1)
- Test: `tests/lib/ai/wiki/section-index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/wiki/section-index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSectionIndex } from '@/lib/ai/wiki/okf-frontmatter';

describe('buildSectionIndex', () => {
  const entries = [
    { slug: 'gc-3460', title: 'Typography', description: 'Type systems.' },
    { slug: 'gc-1010', title: 'Orientation', description: 'First-year intro.' },
  ];

  it('emits OKF index frontmatter with slug=type and resource', () => {
    const md = buildSectionIndex('courses', entries, '2026-06-14T00:00:00.000Z', 'http://x');
    expect(md).toMatch(/^type: index$/m);
    expect(md).toMatch(/^title: "Courses"$/m);
    expect(md).toMatch(/^description: "Index of course pages in the GC curriculum wiki."$/m);
    expect(md).toMatch(/^slug: courses$/m);
    expect(md).toMatch(/^tags: \[index, courses\]$/m);
    expect(md).toMatch(/^timestamp: 2026-06-14T00:00:00.000Z$/m);
    expect(md).toMatch(/^resource: http:\/\/x\/wiki\/courses$/m);
  });

  it('courses sort by slug; lists each as a wikilink with description', () => {
    const md = buildSectionIndex('courses', entries, 'ts', 'http://x');
    const body = md.split('\n---\n')[1]!;
    expect(body.indexOf('[[gc-1010]]')).toBeLessThan(body.indexOf('[[gc-3460]]'));
    expect(md).toContain('- [[gc-1010]] — First-year intro.');
  });

  it('non-course sections sort by title', () => {
    const md = buildSectionIndex('competencies', [
      { slug: 'b', title: 'Beta', description: '' },
      { slug: 'a', title: 'Alpha', description: '' },
    ], 'ts', 'http://x');
    const body = md.split('\n---\n')[1]!;
    expect(body.indexOf('[[a]]')).toBeLessThan(body.indexOf('[[b]]')); // Alpha before Beta
  });
});
```

- [ ] **Step 2: Run the test to verify it fails, then passes**

Run: `pnpm exec vitest run tests/lib/ai/wiki/section-index.test.ts`
Expected: PASS immediately (the function exists from Task 1). If any assertion fails, fix `buildSectionIndex` in `okf-frontmatter.ts` to match, then re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/ai/wiki/section-index.test.ts
git commit -m "test(wiki): buildSectionIndex OKF index page contract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `rebuildSectionIndexes` I/O wrapper

**Files:**
- Create: `lib/ai/wiki/section-index.ts`
- Test: `tests/lib/ai/wiki/section-index-io.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/wiki/section-index-io.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rebuildSectionIndexes } from '@/lib/ai/wiki/section-index';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-idx-'));
  await mkdir(join(root, 'courses'), { recursive: true });
  await writeFile(join(root, 'courses', 'gc-1010.md'),
    `---\ntype: course\nslug: gc-1010\ntitle: "Orientation"\ndescription: "Intro."\ntimestamp: 2026-06-04T00:00:00.000Z\n---\n\n# x\n`);
  await writeFile(join(root, 'courses', 'gc-3460.md'),
    `---\ntype: course\nslug: gc-3460\ntitle: "Typography"\ndescription: "Type."\ntimestamp: 2026-06-12T00:00:00.000Z\n---\n\n# y\n`);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('rebuildSectionIndexes', () => {
  it('writes courses/index.md listing members with the max member timestamp', async () => {
    await rebuildSectionIndexes(root);
    const idx = await readFile(join(root, 'courses', 'index.md'), 'utf8');
    expect(idx).toMatch(/^type: index$/m);
    expect(idx).toMatch(/^timestamp: 2026-06-12T00:00:00.000Z$/m); // max of the two
    expect(idx).toContain('[[gc-1010]]');
    expect(idx).toContain('[[gc-3460]]');
  });

  it('is idempotent (second run produces identical bytes)', async () => {
    await rebuildSectionIndexes(root);
    const first = await readFile(join(root, 'courses', 'index.md'), 'utf8');
    await rebuildSectionIndexes(root);
    const second = await readFile(join(root, 'courses', 'index.md'), 'utf8');
    expect(second).toBe(first);
  });

  it('skips a section dir with no member pages', async () => {
    await rebuildSectionIndexes(root); // targets/ etc. don't exist → no throw
    await expect(readFile(join(root, 'targets', 'index.md'), 'utf8')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/wiki/section-index-io.test.ts`
Expected: FAIL — module `@/lib/ai/wiki/section-index` does not exist.

- [ ] **Step 3: Implement `lib/ai/wiki/section-index.ts`**

```ts
/**
 * Deterministic (re)builder of the per-section index.md hub pages from the
 * full on-disk page set. Pure-builder lives in okf-frontmatter.ts; this is the
 * thin fs wrapper. Called by the wiki disk-writer (git-ops) on every regen and
 * by the one-time backfill. Excludes the top-level index.md (out of scope).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WIKI_PAGE_TYPES } from './schema';
import { buildSectionIndex, readFrontmatterScalar, type IndexEntry } from './okf-frontmatter';

export async function rebuildSectionIndexes(root: string): Promise<void> {
  for (const type of WIKI_PAGE_TYPES) {
    const dir = path.join(root, type);
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter(f => f.endsWith('.md') && f !== 'index.md');
    } catch {
      continue; // section dir absent — nothing to index
    }
    if (files.length === 0) continue;

    const entries: IndexEntry[] = [];
    let maxTs = '';
    for (const f of files) {
      const text = await fs.readFile(path.join(dir, f), 'utf8');
      const slug = f.replace(/\.md$/, '');
      const title = readFrontmatterScalar(text, 'title') ?? slug;
      const description = readFrontmatterScalar(text, 'description') ?? '';
      const ts = readFrontmatterScalar(text, 'timestamp') ?? '';
      if (ts > maxTs) maxTs = ts; // ISO strings sort lexicographically
      entries.push({ slug, title, description });
    }
    await fs.writeFile(path.join(dir, 'index.md'), buildSectionIndex(type, entries, maxTs));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/lib/ai/wiki/section-index-io.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/section-index.ts tests/lib/ai/wiki/section-index-io.test.ts
git commit -m "feat(wiki): rebuildSectionIndexes — deterministic per-section index.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the OKF stamp into regen (`update.ts` + `git-ops.ts`)

**Files:**
- Modify: `lib/ai/wiki/update.ts` (import + post-stamp loop ~line 1050-1064)
- Modify: `lib/wiki/git-ops.ts` (import + `writeAndPushSerial` ~line 147)

- [ ] **Step 1: Add the import to `update.ts`**

Near the other `lib/ai/wiki` imports (e.g. after the `evidence-band-markers` import at line 38), add:

```ts
import { stampOkfFrontmatter } from '@/lib/ai/wiki/okf-frontmatter';
```

- [ ] **Step 2: Apply the stamp in the post-stamp loop**

In `update.ts`, the loop at ~line 1051-1064 currently reads:

```ts
    let content = stampInputHash(p.content, inputHashByPath.get(p.path) ?? '');
    const bands = evidenceBandsByPath.get(p.path);
    if (bands) content = stampEvidenceBands(content, bands);
    wiki.push({ path: p.path, content });
```

Change it to (add the OKF stamp for everything except the top-level index.md):

```ts
    let content = stampInputHash(p.content, inputHashByPath.get(p.path) ?? '');
    const bands = evidenceBandsByPath.get(p.path);
    if (bands) content = stampEvidenceBands(content, bands);
    // OKF machine-fields (title/timestamp/tags/resource/slug). The top-level
    // index.md (LLM-authored dashboard with stats) is out of OKF scope; the
    // per-section index.md files are built deterministically in git-ops.
    if (p.path !== 'index.md') {
      const slug = p.path.replace(/^.*\//, '').replace(/\.md$/, '');
      const tsIso = typeof snapshot.createdAt === 'string'
        ? snapshot.createdAt : snapshot.createdAt.toISOString();
      content = stampOkfFrontmatter(content, { slug, timestamp: tsIso });
    }
    wiki.push({ path: p.path, content });
```

- [ ] **Step 3: Wire `rebuildSectionIndexes` into the disk writer**

In `lib/wiki/git-ops.ts`, add the import near the top (with the other imports):

```ts
import { rebuildSectionIndexes } from '@/lib/ai/wiki/section-index';
```

In `writeAndPushSerial`, after the page-write loop (the `for (const page of commit.pages)` block ending ~line 147) and BEFORE the log append / `git add -A`, insert:

```ts
  // 2b. Rebuild the per-section index.md hubs from the full on-disk page set
  //     (the regen only touched the affected pages; indexes must reflect all).
  await rebuildSectionIndexes(WIKI_REPO_PATH);
```

- [ ] **Step 4: Typecheck + run the wiki test suite**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run tests/lib/ai/wiki/ lib/ai/wiki/__tests__/`
Expected: no type errors; existing wiki tests + the new ones pass. (`update.ts`'s full path is DB-backed and exercised by the Task 9 real-wiki run; this step confirms the wiring compiles and unit tests stay green.)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/update.ts lib/wiki/git-ops.ts
git commit -m "feat(wiki): stamp OKF frontmatter on regen; rebuild section indexes on write

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Update the `wiki-update` prompt to author `title` + `description`

**Files:**
- Modify: `lib/ai/prompts/wiki-update.md`

- [ ] **Step 1: Read the prompt's frontmatter blocks**

Run: `grep -n "name:\|updated_at\|type:\|frontmatter\|Do NOT" lib/ai/prompts/wiki-update.md`
The per-type example frontmatter blocks are around lines 210 (course), 313 (competency), 335 (target), 359/379/398 (concepts), 419 (index), and rules near 458-459.

- [ ] **Step 2: Edit each example frontmatter block**

For the **course** block (~210) it already has `title:`. Add a `description:` line directly under `title:` and change `updated_at:` → `timestamp:`. Result shape:

```yaml
type: course
slug: gc-4800
title: "Senior Capstone"
description: "<one-sentence summary of what this course delivers>"
level: 4000
prerequisites: [gc-3460, gc-4060]
timestamp: 2026-05-25T14:00:00Z
...
```

For the **competency** (~313), **target** (~335), and **concept** (~359, ~379, ~398) blocks: replace the `name:` line with `title:` (same value), add a `description:` line under it, and change `updated_at:` → `timestamp:`. Example (competency):

```yaml
type: competency
slug: brand-strategy
title: "Brand Strategy"
description: "<one-sentence summary of this competency>"
career_target: brand-strategist
contributing_courses: [gc-1010, gc-3460, gc-4800]
timestamp: 2026-05-25T14:00:00Z
```

Leave the **index** block (~419, the top-level index.md) UNCHANGED — it is out of OKF scope.

- [ ] **Step 3: Update the authoring rules**

Find the rule line referencing `updated_at` (~459: "Do NOT omit the `updated_at` field…"). Replace that rule, and add the machine-field caveat, so the rules read:

```
- Do NOT break frontmatter syntax. Every page must parse as valid YAML.
- Always author a `title:` (the human name) and a one-sentence `description:` on every page.
- Do NOT author `tags:`, `timestamp:`, `resource:`, `slug:`, `input_hash:`, or `evidence_bands:` — those are stamped deterministically after you return. Set the other domain fields (level, prerequisites, relations) as before. Do NOT emit a `name:` field; use `title:`.
```

- [ ] **Step 4: Sanity-check the prompt still loads**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (the prompt is loaded as text; this just confirms nothing else broke). Then `grep -c "^name:" lib/ai/prompts/wiki-update.md` should report `0` for the four narrative-type example blocks (the literal `name:` lines are gone).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/prompts/wiki-update.md
git commit -m "feat(wiki): prompt authors title+description, drops name; machine fields stamped

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Rewrite the wiki repo `CLAUDE.md` Frontmatter schema

**Files:**
- Modify: `~/projects/gc-curriculum-wiki/CLAUDE.md` (the "## Frontmatter" section)

- [ ] **Step 1: Replace the four per-type frontmatter blocks**

In `~/projects/gc-curriculum-wiki/CLAUDE.md`, replace the four code blocks under "## Frontmatter" with the OKF shapes. Course:

```yaml
---
type: course
title: "Senior Capstone"
description: "One-sentence summary of what the course delivers."
slug: gc-4800
tags: [course, level-4000, brand-strategist]   # machine-stamped
level: 4000
prerequisites: [gc-3460, gc-4060]
timestamp: 2026-05-25T14:00:00Z                # machine-stamped
resource: http://130.127.162.180:3000/wiki/courses/gc-4800   # machine-stamped
last_snapshot_id: <uuid>
last_snapshot_path: raw/snapshots/gc-4800/2026-05-25_def4567.json
contributes_to_targets: [brand-strategist, account-management]
develops_competencies: [brand-strategy, creative-direction]
---
```

Competency / target / concept follow the same shape: `type`, `title` (was `name`), `description`, `slug`, `tags`, `timestamp` (was `updated_at`), `resource`, then the preserved domain keys (`career_target`/`contributing_courses` for competency; `sub_competencies`/`contributing_courses` for target; `related_courses`/`related_competencies` for concept).

- [ ] **Step 2: Add the index page type + the authoring/machine-field note**

Add a new subsection after the concept block:

```markdown
### Section index page (`<type>/index.md`, machine-generated)

```yaml
---
type: index
title: "Competencies"
description: "Index of competency pages in the GC curriculum wiki."
slug: competencies
tags: [index, competencies]
timestamp: <max member timestamp>
resource: http://130.127.162.180:3000/wiki/competencies
---
```

Built deterministically from the section's pages — do not hand-edit.
```

Then update the trailing note from the old `updated_at` sentence to:

```markdown
`title` + `description` are author-written. `slug`/`tags`/`timestamp`/`resource` (and `input_hash`/`evidence_bands`) are stamped deterministically after generation — never hand-author them. `timestamp` is the regeneration time. The four `<type>/index.md` files are machine-generated section hubs.
```

- [ ] **Step 3: Commit (in the wiki repo)**

```bash
git -C ~/projects/gc-curriculum-wiki add CLAUDE.md
git -C ~/projects/gc-curriculum-wiki commit -m "docs(schema): OKF v0.1 frontmatter vocabulary + section index type"
```

(Do not push yet — the backfill in Task 9 lands in the same wiki-repo push.)

---

### Task 7: Extend `gc-wiki-lint` — `okf-frontmatter-missing` + index handling

**Files:**
- Modify: `lib/ai/wiki/lint.ts`
- Test: `tests/lib/ai/wiki/lint-okf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/wiki/lint-okf.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintWiki } from '@/lib/ai/wiki/lint';

let root: string;
const okfCourse = (slug: string, extra = '') =>
  `---\ntype: course\ntitle: "T"\ndescription: "d"\nslug: ${slug}\ntags: [course]\ntimestamp: 2026-06-14T00:00:00.000Z\nresource: http://x/wiki/courses/${slug}\n---\n\n## Competencies developed\n\n[[${slug === 'gc-1010' ? 'gc-3460' : 'gc-1010'}]]\n\n## Source snapshots\n${extra}`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-lint-'));
  await mkdir(join(root, 'courses'), { recursive: true });
  await writeFile(join(root, 'courses', 'gc-1010.md'), okfCourse('gc-1010'));
  await writeFile(join(root, 'courses', 'gc-3460.md'), okfCourse('gc-3460'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('lint — okf-frontmatter-missing', () => {
  it('is clean when every OKF key is present', async () => {
    const issues = await lintWiki(root);
    expect(issues.filter(i => i.kind === 'okf-frontmatter-missing')).toEqual([]);
  });

  it('fires an error listing the missing keys', async () => {
    await writeFile(join(root, 'courses', 'gc-1010.md'),
      `---\ntype: course\ntitle: "T"\nslug: gc-1010\ntimestamp: x\nresource: y\n---\n\n## Competencies developed\n\n[[gc-3460]]\n\n## Source snapshots\n`); // missing description + tags
    const issues = await lintWiki(root);
    const okf = issues.find(i => i.kind === 'okf-frontmatter-missing' && i.page.endsWith('gc-1010.md'));
    expect(okf?.severity).toBe('error');
    expect(okf?.detail).toContain('description');
    expect(okf?.detail).toContain('tags');
  });

  it('treats a section index.md as type:index — no orphan / no course missing-section, but OKF-checked', async () => {
    await writeFile(join(root, 'courses', 'index.md'),
      `---\ntype: index\ntitle: "Courses"\ndescription: "d"\nslug: courses\ntags: [index, courses]\ntimestamp: t\nresource: http://x/wiki/courses\n---\n\n# Courses\n\n- [[gc-1010]]\n- [[gc-3460]]\n`);
    const issues = await lintWiki(root);
    const idxIssues = issues.filter(i => i.page.endsWith('courses/index.md'));
    expect(idxIssues.filter(i => i.kind === 'orphan')).toEqual([]);
    expect(idxIssues.filter(i => i.kind === 'missing-section')).toEqual([]);
    expect(idxIssues.filter(i => i.kind === 'okf-frontmatter-missing')).toEqual([]); // it has all keys
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/wiki/lint-okf.test.ts`
Expected: FAIL — `okf-frontmatter-missing` is not a kind yet; index.md is mis-treated as a course page.

- [ ] **Step 3: Edit `lib/ai/wiki/lint.ts`**

(a) Add the kind to the `LintIssue` union (line ~23):

```ts
  kind: 'broken-wikilink' | 'orphan' | 'missing-section' | 'ungated-concept' | 'evidence-bands-missing' | 'okf-frontmatter-missing';
```

(b) Add the import + the OKF key list near the top (after the existing imports, ~line 18):

```ts
import { OKF_REQUIRED_KEYS } from '@/lib/ai/wiki/okf-frontmatter';
```

(c) Add a frontmatter-presence helper near `frontmatterList` (~line 55):

```ts
/** True when `field:` appears in the page's frontmatter block. */
function hasFrontmatterKey(text: string, field: string): boolean {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  return fm ? new RegExp(`^${field}:\\s*.+$`, 'm').test(fm[1]!) : false;
}
```

(d) Extend `ParsedPage` (~line 29) with two fields:

```ts
  isIndex: boolean;
  missingOkfKeys: string[];
```

(e) In `parsePage` (~line 57), compute them and override the slug for index pages:

```ts
function parsePage(type: WikiPageType, file: string, text: string): ParsedPage {
  const isIndex = file === 'index.md';
  return {
    relPath: `${type}/${file}`,
    type,
    slug: isIndex ? type : file.replace(/\.md$/, ''),
    headings: [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map(m => m[1]!.trim()),
    links: [...text.matchAll(WIKILINK_RE)].map(m => m[1]!.toLowerCase()),
    relatedCourses: type === 'concepts' && !isIndex ? frontmatterList(text, 'related_courses') : [],
    hasBandMarkers: detectBands(text).length > 0,
    hasBandFrontmatter: readEvidenceBandsFrontmatter(text) !== null,
    isIndex,
    missingOkfKeys: OKF_REQUIRED_KEYS.filter(k => !hasFrontmatterKey(text, k)),
  };
}
```

(f) In the `lintWiki` per-page loop (~line 94-144): add the OKF check, and guard the type-specific checks so index pages skip orphan + missing-section + ungated-concept + evidence-bands. Replace the loop body from the `if (!linkedTo.has(p.slug))` block through the `evidence-bands-missing` block with:

```ts
    if (p.missingOkfKeys.length > 0) {
      issues.push({
        kind: 'okf-frontmatter-missing',
        severity: 'error',
        page: p.relPath,
        detail: `missing OKF frontmatter key(s): ${p.missingOkfKeys.join(', ')}`,
      });
    }

    if (!p.isIndex) {
      if (!linkedTo.has(p.slug)) {
        issues.push({ kind: 'orphan', severity: 'warning', page: p.relPath, detail: `nothing links to [[${p.slug}]]` });
      }

      for (const sec of WIKI_SCHEMA[p.type].requiredSections) {
        if (!p.headings.some(h => h.toLowerCase() === sec.toLowerCase())) {
          issues.push({ kind: 'missing-section', severity: 'warning', page: p.relPath, detail: `missing required section "${sec}"` });
        }
      }

      const minRel = WIKI_SCHEMA[p.type].minRelatedForPromotion;
      if (minRel !== undefined && p.relatedCourses.length < minRel) {
        issues.push({ kind: 'ungated-concept', severity: 'error', page: p.relPath, detail: `concept promoted from ${p.relatedCourses.length} source course(s); the ≥${minRel}-source gate requires more` });
      }

      if ((p.type === 'courses' || p.type === 'competencies') && p.hasBandMarkers && !p.hasBandFrontmatter) {
        issues.push({ kind: 'evidence-bands-missing', severity: 'warning', page: p.relPath, detail: 'carries evidence-band markers but no structured `evidence_bands` frontmatter — run `pnpm wiki:backfill-bands` or recompile' });
      }
    }
```

(Keep the existing `broken-wikilink` check above this — it applies to index pages too, validating their links resolve.)

- [ ] **Step 4: Run both the new and existing lint tests**

Run: `pnpm exec vitest run tests/lib/ai/wiki/lint-okf.test.ts tests/lib/ai/wiki/lint.test.ts tests/lib/ai/wiki/lint-bands.test.ts`
Expected: all PASS (new OKF behavior + no regression in existing checks).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/lint.ts tests/lib/ai/wiki/lint-okf.test.ts
git commit -m "feat(wiki): gc-wiki-lint okf-frontmatter-missing error + index.md handling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Backfill script (`scripts/wiki-backfill-okf.ts`)

**Files:**
- Create: `scripts/wiki-backfill-okf.ts`
- Modify: `package.json` (add the `wiki:backfill-okf` script)
- Test: `tests/lib/ai/wiki/wiki-backfill-okf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/wiki/wiki-backfill-okf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { backfillOkf, deriveDescription } from '@/scripts/wiki-backfill-okf';
import { readFrontmatterScalar } from '@/lib/ai/wiki/okf-frontmatter';

const LEGACY = `---
type: competency
slug: aesthetic-judgment
name: "Aesthetic Judgment"
career_target: brand-strategist
updated_at: 2026-06-02T21:52:05.837Z
input_hash: b8586
---

# Aesthetic Judgment

The capacity to discriminate quality in visual work. It develops across studio courses.
`;

describe('deriveDescription', () => {
  it('takes the first non-heading sentence of the body', () => {
    expect(deriveDescription(LEGACY)).toBe('The capacity to discriminate quality in visual work.');
  });
});

describe('backfillOkf', () => {
  it('migrates a legacy page to full OKF frontmatter', () => {
    const out = backfillOkf(LEGACY, 'aesthetic-judgment');
    expect(readFrontmatterScalar(out, 'title')).toBe('Aesthetic Judgment');
    expect(out).not.toMatch(/^name:/m);
    expect(readFrontmatterScalar(out, 'timestamp')).toBe('2026-06-02T21:52:05.837Z');
    expect(out).not.toMatch(/^updated_at:/m);
    expect(readFrontmatterScalar(out, 'tags')).toBe('[competency, brand-strategist]');
    expect(readFrontmatterScalar(out, 'resource')).toContain('/wiki/competencies/aesthetic-judgment');
    expect(readFrontmatterScalar(out, 'description')).toBe('The capacity to discriminate quality in visual work.');
    expect(readFrontmatterScalar(out, 'input_hash')).toBe('b8586'); // preserved
  });

  it('is idempotent', () => {
    const once = backfillOkf(LEGACY, 'aesthetic-judgment');
    const twice = backfillOkf(once, 'aesthetic-judgment');
    expect(twice).toBe(once);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/wiki/wiki-backfill-okf.test.ts`
Expected: FAIL — `@/scripts/wiki-backfill-okf` does not exist.

- [ ] **Step 3: Implement `scripts/wiki-backfill-okf.ts`**

```ts
/**
 * One-shot, pure (no AI / no DB) backfill: migrate every existing wiki
 * course/competency/target/concept page to OKF v0.1 frontmatter (name→title,
 * updated_at→timestamp, + tags/resource/slug via stampOkfFrontmatter, +
 * description derived from the body when absent), then (re)build the four
 * per-section index.md hubs. Idempotent — a re-run produces no diff. After this
 * runs once, update.ts/git-ops stamp the fields on every subsequent regen.
 *
 * Run: pnpm wiki:backfill-okf   (operator commits + pushes the wiki repo after)
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wikiRepoPath } from '@/lib/wiki/git-ops';
import { WIKI_PAGE_TYPES } from '@/lib/ai/wiki/schema';
import { stampOkfFrontmatter, setFrontmatterLine, readFrontmatterScalar } from '@/lib/ai/wiki/okf-frontmatter';
import { rebuildSectionIndexes } from '@/lib/ai/wiki/section-index';

/** First non-heading/non-list sentence of the body (after frontmatter). */
export function deriveDescription(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  for (const para of body.split(/\n\s*\n/)) {
    const t = para.trim();
    if (!t || t.startsWith('#') || t.startsWith('-') || t.startsWith('|') || t.startsWith('>')) continue;
    const sentence = t.split(/(?<=[.!?])\s/)[0]!.replace(/\s+/g, ' ').trim();
    if (sentence) return sentence.replace(/"/g, "'");
  }
  return '';
}

/** Pure: migrate one page's content to OKF (stamp + derive description if absent). */
export function backfillOkf(content: string, slug: string): string {
  let out = stampOkfFrontmatter(content, { slug }); // no timestamp opt → preserve updated_at value
  if (readFrontmatterScalar(out, 'description') === null) {
    out = setFrontmatterLine(out, 'description', `"${deriveDescription(content)}"`);
  }
  return out;
}

async function main(): Promise<void> {
  const root = wikiRepoPath();
  let scanned = 0, migrated = 0;
  for (const dir of WIKI_PAGE_TYPES) {
    let files: string[] = [];
    try { files = (await readdir(join(root, dir))).filter(f => f.endsWith('.md') && f !== 'index.md'); }
    catch { continue; }
    for (const f of files) {
      const path = join(root, dir, f);
      const before = await readFile(path, 'utf8');
      scanned++;
      const after = backfillOkf(before, f.replace(/\.md$/, ''));
      if (after !== before) { await writeFile(path, after); migrated++; console.log(`  migrated ${dir}/${f}`); }
    }
  }
  await rebuildSectionIndexes(root);
  console.log(`wiki:backfill-okf — scanned ${scanned}, migrated ${migrated}, rebuilt section indexes`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('wiki-backfill-okf.ts')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Add the package.json script**

In `package.json`, next to `"wiki:backfill-bands"`, add:

```json
    "wiki:backfill-okf": "tsx scripts/wiki-backfill-okf.ts",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/lib/ai/wiki/wiki-backfill-okf.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/wiki-backfill-okf.ts package.json tests/lib/ai/wiki/wiki-backfill-okf.test.ts
git commit -m "feat(wiki): pnpm wiki:backfill-okf — deterministic OKF migration + section indexes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Run the migration on the real wiki + STATE.md

**Files:**
- Modify: `~/projects/gc-curriculum-wiki/*` (migrated by the script — committed in the wiki repo)
- Modify: `docs/STATE.md`

- [ ] **Step 1: Full suite green first**

Run: `pnpm test`
Expected: all pass (the new wiki tests included). Fix any failure before touching the real wiki.

- [ ] **Step 2: Inspect the wiki clone is clean, then run the backfill**

```bash
git -C ~/projects/gc-curriculum-wiki status --porcelain   # expect only the Task-6 CLAUDE.md commit, no stray changes
pnpm wiki:backfill-okf
```
Expected: console reports ~43 scanned, N migrated, section indexes rebuilt.

- [ ] **Step 3: Lint the migrated wiki**

Run: `pnpm wiki:lint`
Expected: `wiki-lint: clean ✓` **OR** zero `okf-frontmatter-missing` errors. If any `okf-frontmatter-missing` remains, inspect that page (likely an empty derived `description` → the body had no prose sentence; hand-add a one-line `description:` and re-lint). Resolve to zero errors.

- [ ] **Step 4: Review + commit the wiki repo**

```bash
git -C ~/projects/gc-curriculum-wiki diff --stat
git -C ~/projects/gc-curriculum-wiki add -A
git -C ~/projects/gc-curriculum-wiki commit -m "chore(okf): migrate frontmatter to OKF v0.1 + add section index hubs"
git -C ~/projects/gc-curriculum-wiki push
```
(Spot-check the diff first: `git -C ~/projects/gc-curriculum-wiki diff HEAD~1 -- courses/gc-1010.md` should show name→title/updated_at→timestamp + added description/tags/resource, domain keys intact.)

- [ ] **Step 5: Update STATE.md**

In `docs/STATE.md`, in the OKF deferred line (search `STILL deferred`), strike the wiki-frontmatter item and add the DONE note. Replace:

```
STILL deferred: whole-curriculum **bundle zip** (all courses' .md + index.md, reuses the serializer); the broader **wiki-frontmatter OKF-v0.1 alignment** (Increment #2 — its own brainstorm→spec→plan); and the **`/wiki/graph`** view.
```

with:

```
**Wiki OKF-v0.1 frontmatter alignment — DONE 2026-06-14** (`feat/wiki-okf-frontmatter`): the `gc-curriculum-wiki` narrative pages (4 types + per-section `index.md` hubs) now carry OKF v0.1 frontmatter (`type/title/description/slug/tags/timestamp/resource`), stamped deterministically on regen (`lib/ai/wiki/okf-frontmatter.ts` + `section-index.ts`, wired into `update.ts`/`git-ops.ts`), backfilled via `pnpm wiki:backfill-okf`, enforced by `gc-wiki-lint` (`okf-frontmatter-missing` error). Domain relations preserved; top-level `index.md` left as-is (deferred to bundle/graph). Spec [`2026-06-14-wiki-okf-frontmatter-alignment-design.md`](./superpowers/specs/2026-06-14-wiki-okf-frontmatter-alignment-design.md). STILL deferred: whole-curriculum **bundle zip**, top-level `index.md` OKF conformance, and the **`/wiki/graph`** view.
```

- [ ] **Step 6: Commit STATE.md (code repo)**

```bash
git add docs/STATE.md
git commit -m "docs(state): wiki OKF-v0.1 frontmatter alignment DONE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)
- [ ] `pnpm test` green (code repo).
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm wiki:lint` → zero `okf-frontmatter-missing`.
- [ ] Wiki repo committed + pushed; `git -C ~/projects/gc-curriculum-wiki log --oneline -2` shows the schema + migration commits.
- [ ] Re-running `pnpm wiki:backfill-okf` produces no new diff (idempotent).

## Self-Review notes (author)
- **Spec coverage:** rename→OKF vocab → Task 1 `stampOkfFrontmatter`; description (agent + backfill) → Task 5 prompt + Task 8 `deriveDescription`; tags/resource derivation → Task 1; per-section index.md → Tasks 2/3 + git-ops wiring (Task 4); CLAUDE.md authority → Task 6; backfill → Task 8; lint error + index handling → Task 7; real-wiki run + STATE → Task 9. ✓
- **Scope guard:** top-level index.md explicitly excluded (Task 4 `p.path !== 'index.md'`; Task 5 leaves index block; lint doesn't scan repo root). ✓
- **Type consistency:** `IndexEntry`, `OkfStampOpts`, `readFrontmatterScalar`/`setFrontmatterLine`, `OKF_REQUIRED_KEYS`, `rebuildSectionIndexes`, `buildSectionIndex`, `backfillOkf`/`deriveDescription` referenced consistently across tasks. ✓
- **Idempotency:** asserted in Tasks 1, 3, 8 and the final check. ✓
