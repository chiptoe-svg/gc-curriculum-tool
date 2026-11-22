import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WIKI_PAGES, parsePages, wikiKeyId, pendingWikiKeys, blindWikiCell, pageLint, assertPaidWikiArgs, summarizeWikiArm, FACTUAL_NOTE } from '@/scripts/bench/agent-wiki';

describe('page cases', () => {
  it('lists 14 supported pages including problem-solving, no duplicates', () => {
    expect(WIKI_PAGES).toHaveLength(14);
    expect(new Set(WIKI_PAGES).size).toBe(14);
    expect(WIKI_PAGES).toContain('competencies/problem-solving');
    for (const p of WIKI_PAGES) expect(p).toMatch(/^(competencies|targets|courses)\/[a-z0-9-]+$/);
  });
  it('parsePages validates sections', () => {
    expect(parsePages('competencies/a, targets/b')).toEqual(['competencies/a', 'targets/b']);
    expect(() => parsePages('concepts/x')).toThrow(/unsupported/);
    expect(() => parsePages('')).toThrow();
    expect(() => parsePages('courses')).toThrow();
  });
});
describe('keys', () => {
  it('skips finished keys', () => {
    const a = { model: 'm', arm: 'single', page: 'courses/gc-1', run: 1 }, b = { ...a, run: 2 };
    expect(pendingWikiKeys([a, b], [wikiKeyId(a)])).toEqual([b]);
  });
});
describe('blind cell', () => {
  it('carries only markdown', () => {
    const c = blindWikiCell('# Page');
    expect(Object.keys(c)).toEqual(['markdown']);
  });
});
describe('pageLint', () => {
  const issues = [
    { kind: 'broken-wikilink', severity: 'error', page: 'courses/a.md', detail: 'x' },
    { kind: 'orphan', severity: 'warning', page: 'courses/a.md', detail: 'x' },
    { kind: 'broken-wikilink', severity: 'error', page: 'courses/b.md', detail: 'x' },
  ] as const;
  it('counts only the named page', () => {
    expect(pageLint([...issues], 'courses/a')).toEqual({ errors: 1, warnings: 1 });
  });
});
describe('paid args', () => {
  it('needs a ceiling', () => {
    expect(() => assertPaidWikiArgs(true, null)).toThrow();
    expect(() => assertPaidWikiArgs(true, 5)).not.toThrow();
    expect(() => assertPaidWikiArgs(false, null)).not.toThrow();
  });
});
describe('summarizeWikiArm', () => {
  it('averages per page', () => {
    const r = summarizeWikiArm([
      { page: 'a', ok: true, factual: 2, unverifiable: 1, lintErrors: 0 },
      { page: 'a', ok: true, factual: 0, unverifiable: 0, lintErrors: 1 },
      { page: 'b', ok: false },
    ]);
    expect(r).toMatchObject({ n: 2, errors: 1, factualPerPage: 1, unverifiablePerPage: 0.5, lintPerPage: 0.5 });
  });
  it('states the independence caveat', () => {
    expect(FACTUAL_NOTE).toContain('blind review decides (ruling R13)');
  });
});
describe('safety', () => {
  it('never imports the wiki writer', () => {
    const src = readFileSync('scripts/bench/agent-wiki.ts', 'utf8');
    expect(src).not.toMatch(/writeAndPush/);
    expect(src).not.toMatch(/git-ops/);
  });
});

import { withTimeout, CallTimeout } from '@/scripts/bench/agent-wiki';
describe('withTimeout', () => {
  const k = { model: 'm', arm: 'agent', page: 'p', run: 1 };
  it('rejects a slow call with CallTimeout and passes a fast one', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, k)).rejects.toBeInstanceOf(CallTimeout);
    await expect(withTimeout(Promise.resolve(5), 1000, k)).resolves.toBe(5);
  });
});
