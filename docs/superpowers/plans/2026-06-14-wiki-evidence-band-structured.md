# Structured Wiki Evidence-Band Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each wiki page's evidence-band set as structured `evidence_bands:` frontmatter (stamped deterministically), have `search_wiki`'s `bandFloor` read it instead of scraping `·claimed`/`·materials`/`·artifact` prose tokens, lint-assert it, and backfill existing pages.

**Architecture:** The bands are already derived deterministically in `update.ts` (`deriveEvidenceBand`). Add a pure frontmatter reader + a frontmatter stamper (mirroring the existing `stampInputHash`), stamp the deduped page-level band set at the same point `input_hash` is stamped, switch the read-time tools to a frontmatter-first `resolvePageBands`, add a lint drift-check, and ship a pure no-AI backfill script.

**Tech Stack:** TypeScript strict, Vitest. Wiki pages are markdown with YAML frontmatter in the separate `gc-curriculum-wiki` repo (read via `wikiRepoPath()`).

**Spec:** `docs/superpowers/specs/2026-06-14-wiki-evidence-band-structured-design.md`

**Conventions:** single test `pnpm vitest run <path>`; full suite `pnpm test`; typecheck `pnpm tsc --noEmit` (vitest does NOT typecheck — run tsc explicitly). `EvidenceBand` = `'claimed' | 'materials_supported' | 'artifact_verified'` from `@/lib/program/evidence-ladder`. `BAND_ORDER` (ladder, low→high) lives in `lib/ai/wiki/evidence-band-markers.ts`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**File map:**
- Modify `lib/ai/wiki/evidence-band-markers.ts` — add `readEvidenceBandsFrontmatter` + `resolvePageBands` (keep `detectBands`/`pagePassesBandFloor`/`BAND_ORDER`/`BAND_MARKER`/`bandRank`).
- Modify `lib/ai/wiki/update.ts` — add `stampEvidenceBands` + `dedupeBands` (pure); stamp `evidence_bands` per page in the write loop.
- Modify `lib/ai/wiki/tools.ts` — `search_wiki` + `read_wiki` use `resolvePageBands`.
- Modify `lib/ai/wiki/lint.ts` — `evidence-bands-missing` warning.
- Create `scripts/wiki-backfill-bands.ts` + a `package.json` `wiki:backfill-bands` script.
- Tests under `tests/` mirroring each.

---

### Task 1: `readEvidenceBandsFrontmatter` + `resolvePageBands`

**Files:**
- Modify: `lib/ai/wiki/evidence-band-markers.ts` (append after `pagePassesBandFloor`)
- Test: `tests/lib/ai/wiki/evidence-band-markers.test.ts` (create if absent, else append)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/ai/wiki/evidence-band-markers.test.ts
import { describe, it, expect } from 'vitest';
import { readEvidenceBandsFrontmatter, resolvePageBands } from '@/lib/ai/wiki/evidence-band-markers';

const fm = (line: string, body = 'x') => `---\ntype: course\n${line}\n---\n\n${body}`;

describe('readEvidenceBandsFrontmatter', () => {
  it('parses a valid list, deduped + in ladder order', () => {
    expect(readEvidenceBandsFrontmatter(fm('evidence_bands: [artifact_verified, claimed, claimed]')))
      .toEqual(['claimed', 'artifact_verified']);
  });
  it('returns [] for an explicitly empty list', () => {
    expect(readEvidenceBandsFrontmatter(fm('evidence_bands: []'))).toEqual([]);
  });
  it('returns null when the field is absent', () => {
    expect(readEvidenceBandsFrontmatter(fm('input_hash: abc123'))).toBeNull();
  });
  it('returns null when there is no frontmatter', () => {
    expect(readEvidenceBandsFrontmatter('# Just a heading\nno frontmatter')).toBeNull();
  });
  it('drops unknown/garbage values', () => {
    expect(readEvidenceBandsFrontmatter(fm('evidence_bands: [materials_supported, bogus, ALSO_BAD]')))
      .toEqual(['materials_supported']);
  });
});

describe('resolvePageBands', () => {
  it('uses the frontmatter list when present (ignores prose markers)', () => {
    const page = fm('evidence_bands: [materials_supported]', 'Color matching ·artifact here');
    expect(resolvePageBands(page)).toEqual(['materials_supported']);
  });
  it('falls back to prose markers when the field is absent', () => {
    const page = fm('input_hash: z', 'X ·claimed and Y ·artifact');
    expect(resolvePageBands(page)).toEqual(['claimed', 'artifact_verified']);
  });
  it('returns [] for an empty frontmatter list even if prose has markers', () => {
    expect(resolvePageBands(fm('evidence_bands: []', 'stray ·materials'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/wiki/evidence-band-markers.test.ts`
Expected: FAIL — `readEvidenceBandsFrontmatter` / `resolvePageBands` not exported.

- [ ] **Step 3: Implement**

Append to `lib/ai/wiki/evidence-band-markers.ts`:

```typescript
/**
 * Read the structured `evidence_bands: [...]` list from a page's YAML
 * frontmatter — the machine-readable counterpart to the prose markers.
 * Returns the deduped bands in ladder order, `[]` when the field is present
 * but empty, and `null` when the field (or frontmatter) is ABSENT — so a
 * caller can fall back to prose-scraping legacy pages.
 */
export function readEvidenceBandsFrontmatter(markdown: string): EvidenceBand[] | null {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const line = fm[1]!.match(/^evidence_bands:\s*(.*)$/m);
  if (!line) return null;
  const items = line[1]!
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const present = new Set(items);
  return BAND_ORDER.filter(b => present.has(b));
}

/**
 * The single read-time accessor: structured frontmatter when stamped, prose
 * markers as a graceful fallback for legacy / not-yet-backfilled pages.
 */
export function resolvePageBands(markdown: string): EvidenceBand[] {
  return readEvidenceBandsFrontmatter(markdown) ?? detectBands(markdown);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/wiki/evidence-band-markers.test.ts` → PASS. Then `pnpm tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/evidence-band-markers.ts tests/lib/ai/wiki/evidence-band-markers.test.ts
git commit -m "feat(wiki): readEvidenceBandsFrontmatter + resolvePageBands (structured band floor)"
```

---

### Task 2: `stampEvidenceBands` + `dedupeBands` (pure)

**Files:**
- Modify: `lib/ai/wiki/update.ts` (append the two pure fns near `stampInputHash`; add a `BAND_ORDER` import)
- Test: `tests/lib/ai/wiki/update-bands.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/ai/wiki/update-bands.test.ts
import { describe, it, expect } from 'vitest';
import { stampEvidenceBands, dedupeBands } from '@/lib/ai/wiki/update';

describe('dedupeBands', () => {
  it('filters null, dedupes, and orders by the ladder', () => {
    expect(dedupeBands(['artifact_verified', null, 'claimed', 'claimed', null, 'materials_supported']))
      .toEqual(['claimed', 'materials_supported', 'artifact_verified']);
  });
  it('returns [] for all-null / empty', () => {
    expect(dedupeBands([null, null])).toEqual([]);
    expect(dedupeBands([])).toEqual([]);
  });
});

describe('stampEvidenceBands', () => {
  it('appends the field into an existing frontmatter block', () => {
    const out = stampEvidenceBands('---\ntype: course\ninput_hash: abc\n---\n\nBody', ['claimed', 'artifact_verified']);
    expect(out).toContain('evidence_bands: [claimed, artifact_verified]');
    expect(out).toContain('input_hash: abc');
    expect(out).toContain('\nBody');
  });
  it('replaces an existing field rather than duplicating it', () => {
    const out = stampEvidenceBands('---\ntype: course\nevidence_bands: [claimed]\n---\n\nB', ['materials_supported']);
    expect(out.match(/evidence_bands:/g)).toHaveLength(1);
    expect(out).toContain('evidence_bands: [materials_supported]');
  });
  it('prepends a frontmatter block when the page has none', () => {
    const out = stampEvidenceBands('# Title\n\nBody', ['claimed']);
    expect(out.startsWith('---\nevidence_bands: [claimed]\n---\n')).toBe(true);
  });
  it('writes an empty list as []', () => {
    const out = stampEvidenceBands('---\ntype: course\n---\n\nB', []);
    expect(out).toContain('evidence_bands: []');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/wiki/update-bands.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

In `lib/ai/wiki/update.ts`, add `BAND_ORDER` to the existing evidence-band-markers import. The file currently imports from `@/lib/program/evidence-ladder`; ADD this import near the other `@/lib/ai/wiki` imports (check it isn't already importing from this module):

```typescript
import { BAND_ORDER } from '@/lib/ai/wiki/evidence-band-markers';
```

Then append, right after `stampInputHash` (which ends near line 842):

```typescript
/** Pure: filter null, dedupe, and order an evidence-band list by the ladder. */
export function dedupeBands(bands: ReadonlyArray<EvidenceBand | null>): EvidenceBand[] {
  const present = new Set(bands.filter((b): b is EvidenceBand => b !== null));
  return BAND_ORDER.filter(b => present.has(b));
}

/**
 * Pure: stamp `evidence_bands: [a, b]` into a page's YAML frontmatter — the
 * structured counterpart to the prose band markers. Replace-if-present,
 * append-into-block if absent, prepend a block if the page has no frontmatter.
 * Mirrors `stampInputHash`.
 */
export function stampEvidenceBands(content: string, bands: EvidenceBand[]): string {
  const line = `evidence_bands: [${bands.join(', ')}]`;
  const m = content.match(FRONTMATTER_RE);
  if (m) {
    const body = /^evidence_bands:\s*.*$/m.test(m[1]!)
      ? m[1]!.replace(/^evidence_bands:\s*.*$/m, line)
      : `${m[1]!}\n${line}`;
    return content.replace(FRONTMATTER_RE, `---\n${body}\n---\n`);
  }
  return `---\n${line}\n---\n\n${content}`;
}
```

(`EvidenceBand` is already imported in `update.ts`; `FRONTMATTER_RE` is already defined there.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/wiki/update-bands.test.ts` → PASS. Then `pnpm tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/update.ts tests/lib/ai/wiki/update-bands.test.ts
git commit -m "feat(wiki): stampEvidenceBands + dedupeBands pure helpers"
```

---

### Task 3: Stamp `evidence_bands` in the page-write loop

**Files:**
- Modify: `lib/ai/wiki/update.ts` (the page-write loop near line 1044, where `stampInputHash` is called)

- [ ] **Step 1: Implement (no new unit test — this wires the Task-2 pure helpers into the LLM-backed `generateWikiUpdate`; verified by tsc + the existing wiki-update suite. The stamping logic itself is unit-tested in Task 2.)**

In `lib/ai/wiki/update.ts`, just before the dedup-by-path loop that stamps `input_hash` (the `const inputHashByPath = ...` / `const wiki: WikiPageWrite[] = []` region around line 1023–1045), build a per-path band map from `pagesWithSubstrate` (which carries each page's `type` and `substrate`) and the already-computed `competencyBands`:

```typescript
  // Per-page evidence-band set (structured counterpart to the prose markers):
  //   course page    → the snapshot's own competency bands
  //   competency page→ the bands of every cell contributing to that competency
  // Stamped into frontmatter so search_wiki's bandFloor reads structured data
  // instead of scraping ·markers (deterministic; mirrors input_hash).
  const evidenceBandsByPath = new Map<string, EvidenceBand[]>();
  for (const p of pagesWithSubstrate) {
    if (p.type === 'course') {
      evidenceBandsByPath.set(p.path, dedupeBands(competencyBands.map(b => b.band)));
    } else if (p.type === 'competency') {
      const cells = (p.substrate as { contributingCells?: Array<{ band: EvidenceBand | null }> })?.contributingCells ?? [];
      evidenceBandsByPath.set(p.path, dedupeBands(cells.map(c => c.band)));
    }
  }
```

Then, in the write loop, change the stamping line from:

```typescript
    const content = stampInputHash(p.content, inputHashByPath.get(p.path) ?? '');
    wiki.push({ path: p.path, content });
```

to:

```typescript
    let content = stampInputHash(p.content, inputHashByPath.get(p.path) ?? '');
    const bands = evidenceBandsByPath.get(p.path);
    if (bands) content = stampEvidenceBands(content, bands);
    wiki.push({ path: p.path, content });
```

- [ ] **Step 2: Typecheck + the wiki-update suite**

Run: `pnpm tsc --noEmit` (clean) then `pnpm vitest run tests/lib/ai/wiki/` (the existing wiki tests stay green; report counts).

- [ ] **Step 3: Commit**

```bash
git add lib/ai/wiki/update.ts
git commit -m "feat(wiki): stamp evidence_bands per course/competency page on regen"
```

---

### Task 4: `search_wiki` + `read_wiki` read structured bands

**Files:**
- Modify: `lib/ai/wiki/tools.ts` (the `read_wiki` return ~line 116 and the `search_wiki` execute ~line 164)
- Test: `tests/lib/ai/wiki/wiki-tools-bandfloor.test.ts` (create)

- [ ] **Step 1: Write the failing test**

The tools read pages via `readWikiPage` (`lib/wiki/git-ops`) and list via `listNarrativePages`. Mock those to drive `search_wiki` against in-memory pages:

```typescript
// tests/lib/ai/wiki/wiki-tools-bandfloor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PAGES: Record<string, string> = {
  'courses/gc-low.md':   '---\ntype: course\nevidence_bands: [claimed]\n---\n\nspot color here',
  'courses/gc-high.md':  '---\ntype: course\nevidence_bands: [artifact_verified]\n---\n\nspot color here',
  'courses/gc-legacy.md':'---\ntype: course\ninput_hash: z\n---\n\nspot color here, no markers',
};

vi.mock('@/lib/wiki/git-ops', () => ({
  wikiRepoPath: () => '/fake',
  readWikiPage: async (p: string) => PAGES[p] ?? null,
}));
vi.mock('@/lib/ai/wiki/tools-helpers', () => ({})); // no-op if not present

import { wikiSearchTool } from '@/lib/ai/wiki/tools';

// listNarrativePages walks the repo; stub it via the module's own dependency.
vi.mock('@/lib/ai/wiki/list-pages', () => ({ listNarrativePages: async () => Object.keys(PAGES) }), { virtual: true });

beforeEach(() => vi.clearAllMocks());

describe('search_wiki bandFloor reads structured frontmatter', () => {
  it('drops a page whose frontmatter bands are all below the floor', async () => {
    const res = await wikiSearchTool.execute({ query: 'spot color', bandFloor: 'artifact_verified' }) as { hits: Array<{ path: string }> };
    const paths = res.hits.map(h => h.path);
    expect(paths).toContain('courses/gc-high.md');
    expect(paths).toContain('courses/gc-legacy.md'); // no field, no markers → passes
    expect(paths).not.toContain('courses/gc-low.md'); // claimed < artifact_verified
  });
});
```

NOTE before writing this test: open `lib/ai/wiki/tools.ts` and confirm the EXACT module + symbol it imports `listNarrativePages` from (it is imported at the top of the file). Mock THAT module path, not a guessed one — adjust the `vi.mock('@/lib/ai/wiki/list-pages', …)` line to the real path. If `listNarrativePages` and `readWikiPage` come from the same module, put both in one `vi.mock`. Keep the test's intent identical.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/wiki/wiki-tools-bandfloor.test.ts`
Expected: FAIL — `gc-low.md` is currently kept because `detectBands` finds no prose markers in it (its band lives only in frontmatter), so the floor doesn't drop it.

- [ ] **Step 3: Implement**

In `lib/ai/wiki/tools.ts`:
- Change the import on line 21 from `import { detectBands, pagePassesBandFloor, BAND_ORDER } from '@/lib/ai/wiki/evidence-band-markers';` to add `resolvePageBands`:
  ```typescript
  import { resolvePageBands, pagePassesBandFloor, BAND_ORDER } from '@/lib/ai/wiki/evidence-band-markers';
  ```
  (Drop `detectBands` from this import — it's replaced by `resolvePageBands` in both call sites below.)
- In `read_wiki`'s return (~line 116), change `evidenceBands: detectBands(content)` to `evidenceBands: resolvePageBands(content)`.
- In `search_wiki`'s execute (~line 164), change `const bands = detectBands(content);` to `const bands = resolvePageBands(content);`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/wiki/wiki-tools-bandfloor.test.ts` → PASS. Then `pnpm tsc --noEmit` → clean (confirm `detectBands` has no other use left in `tools.ts`).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/tools.ts tests/lib/ai/wiki/wiki-tools-bandfloor.test.ts
git commit -m "feat(wiki): search_wiki/read_wiki read structured evidence_bands (frontmatter-first)"
```

---

### Task 5: Lint `evidence-bands-missing` warning

**Files:**
- Modify: `lib/ai/wiki/lint.ts` (the `LintIssue.kind` union, `ParsedPage`, `parsePage`, and the per-page check loop)
- Test: `tests/lib/ai/wiki/lint-bands.test.ts` (create) — or append to the existing lint test if present

- [ ] **Step 1: Write the failing test**

`lintWiki(root)` reads a directory tree. Point it at a temp fixture dir with `courses/` + `concepts/` pages:

```typescript
// tests/lib/ai/wiki/lint-bands.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { lintWiki } from '@/lib/ai/wiki/lint';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wikilint-'));
  await mkdir(join(root, 'courses'), { recursive: true });
  await mkdir(join(root, 'concepts'), { recursive: true });
  // course page WITH prose markers but NO structured field → should warn
  await writeFile(join(root, 'courses', 'gc-x.md'),
    '---\ntype: course\nslug: gc-x\n---\n\n# GC X\n\n## Competencies developed\n- Color ·materials\n\n## Source snapshots\n[[gc-x]]');
  // course page WITH markers AND the structured field → clean
  await writeFile(join(root, 'courses', 'gc-y.md'),
    '---\ntype: course\nslug: gc-y\nevidence_bands: [materials_supported]\n---\n\n# GC Y\n\n## Competencies developed\n- Color ·materials\n\n## Source snapshots\n[[gc-y]]');
  // concept page (not course/competency) with a stray marker → no band warning
  await writeFile(join(root, 'concepts', 'pf.md'),
    '---\ntype: concept\nslug: pf\n---\n\n# PF\n\n## The idea\nstuff ·claimed [[gc-y]]');
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe('lint evidence-bands-missing', () => {
  it('warns a course page that has band markers but no evidence_bands field', async () => {
    const issues = await lintWiki(root);
    const band = issues.filter(i => i.kind === 'evidence-bands-missing');
    expect(band.map(i => i.page)).toContain('courses/gc-x.md');
    expect(band.map(i => i.page)).not.toContain('courses/gc-y.md');
    expect(band.map(i => i.page)).not.toContain('concepts/pf.md');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/wiki/lint-bands.test.ts`
Expected: FAIL — `evidence-bands-missing` is not a kind yet.

- [ ] **Step 3: Implement**

In `lib/ai/wiki/lint.ts`:
- Add `'evidence-bands-missing'` to the `LintIssue.kind` union.
- Import the band helpers at the top: `import { detectBands, readEvidenceBandsFrontmatter } from '@/lib/ai/wiki/evidence-band-markers';`
- In `ParsedPage`, add two booleans: `hasBandMarkers: boolean;` and `hasBandFrontmatter: boolean;`
- In `parsePage(...)`, compute them from the raw `text`:
  ```typescript
    hasBandMarkers: detectBands(text).length > 0,
    hasBandFrontmatter: readEvidenceBandsFrontmatter(text) !== null,
  ```
- In the per-page issue loop (the `for (const p of pages)` block), after the existing checks, add:
  ```typescript
    if ((p.type === 'courses' || p.type === 'competencies') && p.hasBandMarkers && !p.hasBandFrontmatter) {
      issues.push({
        kind: 'evidence-bands-missing',
        severity: 'warning',
        page: p.relPath,
        detail: 'carries evidence-band markers but no structured `evidence_bands` frontmatter — run `pnpm wiki:backfill-bands` or recompile',
      });
    }
  ```
  (NOTE: `WikiPageType` values are the directory names — `'courses'` / `'competencies'` — confirm against `WIKI_PAGE_TYPES` in `lib/ai/wiki/schema.ts` and use those literals.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/wiki/lint-bands.test.ts` → PASS. Then `pnpm tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/lint.ts tests/lib/ai/wiki/lint-bands.test.ts
git commit -m "feat(wiki): lint warns on band-marker pages missing structured evidence_bands"
```

---

### Task 6: `pnpm wiki:backfill-bands` one-shot script

**Files:**
- Create: `scripts/wiki-backfill-bands.ts`
- Modify: `package.json` (add the `wiki:backfill-bands` script)
- Test: `tests/scripts/wiki-backfill-bands.test.ts` (create — tests the pure transform)

- [ ] **Step 1: Write the failing test**

Factor the per-file transform into a pure exported function `backfillContent(content)` and test it directly (no filesystem):

```typescript
// tests/scripts/wiki-backfill-bands.test.ts
import { describe, it, expect } from 'vitest';
import { backfillContent } from '@/scripts/wiki-backfill-bands';

describe('backfillContent', () => {
  it('stamps evidence_bands from prose markers when the field is absent', () => {
    const out = backfillContent('---\ntype: course\n---\n\nA ·materials and B ·artifact');
    expect(out).toContain('evidence_bands: [materials_supported, artifact_verified]');
  });
  it('stamps [] when there are no markers', () => {
    expect(backfillContent('---\ntype: course\n---\n\nno markers')).toContain('evidence_bands: []');
  });
  it('is idempotent — already-stamped content is returned unchanged', () => {
    const stamped = '---\ntype: course\nevidence_bands: [claimed]\n---\n\nX ·claimed';
    expect(backfillContent(stamped)).toBe(stamped);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/scripts/wiki-backfill-bands.test.ts`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement the script**

Create `scripts/wiki-backfill-bands.ts`:

```typescript
/**
 * One-shot, pure (no AI / no DB) backfill: stamp the structured
 * `evidence_bands:` frontmatter onto every existing wiki course/competency
 * page, derived from the prose markers already on the page. Idempotent — a
 * page that already carries the field is left untouched. After this runs once,
 * `update.ts` stamps the field on every subsequent regen.
 *
 * Run: pnpm wiki:backfill-bands   (operator commits the wiki repo afterward)
 */
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { wikiRepoPath } from '@/lib/wiki/git-ops';
import { detectBands, readEvidenceBandsFrontmatter, stampEvidenceBands } from '@/lib/ai/wiki/backfill-bands-helpers';

/** Pure transform: stamp evidence_bands from prose markers unless already present. */
export function backfillContent(content: string): string {
  if (readEvidenceBandsFrontmatter(content) !== null) return content; // idempotent
  return stampEvidenceBands(content, detectBands(content));
}

async function main(): Promise<void> {
  const root = wikiRepoPath();
  let changed = 0;
  let scanned = 0;
  for (const dir of ['courses', 'competencies']) {
    let files: string[] = [];
    try { files = (await readdir(join(root, dir))).filter(f => f.endsWith('.md') && f !== 'index.md'); }
    catch { continue; }
    for (const f of files) {
      const path = join(root, dir, f);
      const before = await readFile(path, 'utf8');
      scanned++;
      const after = backfillContent(before);
      if (after !== before) { await writeFile(path, after); changed++; console.log(`  stamped ${dir}/${f}`); }
    }
  }
  console.log(`wiki:backfill-bands — scanned ${scanned}, stamped ${changed}`);
  process.exit(0);
}

// Only run main() when executed directly, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('wiki-backfill-bands.ts')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
```

`stampEvidenceBands` is defined in `update.ts`, which imports DB/LLM modules — importing it into a script is fine, but to keep the script dependency-light, create a thin pure re-export module `lib/ai/wiki/backfill-bands-helpers.ts`:

```typescript
// lib/ai/wiki/backfill-bands-helpers.ts
// Pure band helpers grouped for the no-DB/no-AI backfill script + its test.
export { detectBands, readEvidenceBandsFrontmatter } from '@/lib/ai/wiki/evidence-band-markers';
export { stampEvidenceBands } from '@/lib/ai/wiki/update';
```

(If importing `update.ts` pulls heavy deps into the test, instead MOVE `stampEvidenceBands` + `dedupeBands` from `update.ts` into `evidence-band-markers.ts` in Task 2 and re-export them from `update.ts` for back-compat — decide in Task 2; keep this plan's import paths consistent with that choice. Default: the thin re-export module above.)

- [ ] **Step 4: Add the package.json script**

In `package.json` `scripts`, add next to `"wiki:lint"`:

```json
    "wiki:backfill-bands": "tsx scripts/wiki-backfill-bands.ts",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/scripts/wiki-backfill-bands.test.ts` → PASS. Then `pnpm tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/wiki-backfill-bands.ts lib/ai/wiki/backfill-bands-helpers.ts package.json tests/scripts/wiki-backfill-bands.test.ts
git commit -m "feat(wiki): pnpm wiki:backfill-bands — pure backfill of structured evidence_bands"
```

---

### Task 7: Full suite + STATE.md

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Full suite + tsc**

Run: `pnpm tsc --noEmit && pnpm test` → clean + green (report counts).

- [ ] **Step 2: Update STATE.md**

- In the **"Wiki band floor operates on prose markers, not structured data"** Deferred/debt entry: mark it RESOLVED on branch `feat/wiki-structured-band-floor` — `evidence_bands` frontmatter now stamped deterministically in `update.ts`; `search_wiki`/`read_wiki` read it via `resolvePageBands` (prose-scrape fallback retained for un-backfilled pages); lint `evidence-bands-missing` drift-check; `pnpm wiki:backfill-bands` one-shot. Note the operator action: run `pnpm wiki:backfill-bands` once + commit the `gc-curriculum-wiki` repo to clear legacy pages.
- Active arc / "What's live": one line that the wiki evidence-band floor is now structured (spec/plan links).

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): structured wiki evidence-band floor shipped"
```

---

## Plan self-review (done at write time)

- **Spec coverage:** `readEvidenceBandsFrontmatter`/`resolvePageBands` (T1); `stampEvidenceBands`/`dedupeBands` (T2) + the deterministic stamp at the input_hash point, course-from-`competencyBands` / competency-from-`contributingCells.band` (T3); `search_wiki`+`read_wiki` switch (T4); lint `evidence-bands-missing` (T5); `pnpm wiki:backfill-bands` pure + idempotent (T6). Page-level list shape, absent-vs-`[]` distinction, prose-fallback all covered. ✓
- **Placeholder scan:** every code step shows complete code; the two "confirm the real symbol path" notes (lint `WikiPageType` literals, `listNarrativePages` mock path) are explicit verification instructions, not deferred work. ✓
- **Type consistency:** `EvidenceBand`, `BAND_ORDER`, `resolvePageBands`, `readEvidenceBandsFrontmatter`, `stampEvidenceBands`, `dedupeBands` names identical across tasks; `dedupeBands` accepts `(EvidenceBand|null)[]` consistently (course `.band`, competency `.band`). ✓
- **Frozen-surface guard:** band *semantics* (`deriveEvidenceBand`), the LLM prompt, and `pagePassesBandFloor`'s legacy-passes rule are untouched; only the data source the floor reads changes. ✓
