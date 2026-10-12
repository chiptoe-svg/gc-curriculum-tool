/**
 * Tests for the "merged into" stub (lib/ai/wiki/update.ts: buildMergedStubPage
 * + writeMergedStub). A merged-away competency (P0b, migration 0057) keeps
 * its old wiki slug; Task 7's script replaces that page ONCE with a
 * deterministic stub naming and linking the survivor — no LLM call.
 *
 * `writeAndPush` and the AI provider are mocked: this suite never writes to
 * the real wiki repo and never calls the LLM.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@/lib/wiki/git-ops', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wiki/git-ops')>();
  return { ...actual, writeAndPush: vi.fn().mockResolvedValue({ sha: 'deadbeef' }) };
});

vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: vi.fn(),
}));

import { writeAndPush } from '@/lib/wiki/git-ops';
import { getProviderForFunction } from '@/lib/ai/provider';
import { buildMergedStubPage, writeMergedStub } from '../update';
import { lintWiki } from '../lint';

const TS = '2026-10-12T00:00:00.000Z';

describe('buildMergedStubPage (pure)', () => {
  it('uses the same path/slug convention as a live competency page, so the stub replaces it', () => {
    const page = buildMergedStubPage('gc-production-literacy', 'domain-knowledge', 'Production domain knowledge', { timestamp: TS });
    expect(page.path).toBe('competencies/gc-production-literacy.md');
  });

  it('names and links the survivor in the body', () => {
    const page = buildMergedStubPage('gc-production-literacy', 'domain-knowledge', 'Production domain knowledge', { timestamp: TS });
    expect(page.content).toContain('[[domain-knowledge|Production domain knowledge]]');
    expect(page.content).toContain('Production domain knowledge');
  });

  it('carries complete OKF frontmatter (type, title, description, slug, tags, timestamp, resource)', () => {
    const page = buildMergedStubPage('domain-grounding', 'domain-knowledge', 'Production domain knowledge', { timestamp: TS });
    for (const key of ['type', 'title', 'description', 'slug', 'tags', 'timestamp', 'resource']) {
      expect(page.content).toMatch(new RegExp(`^${key}:`, 'm'));
    }
    expect(page.content).toMatch(/^slug: domain-grounding$/m);
    expect(page.content).toMatch(/^merged_into: domain-knowledge$/m);
  });

  it('is deterministic given the same inputs', () => {
    const a = buildMergedStubPage('timeline-management', 'project-management', 'Project management', { timestamp: TS });
    const b = buildMergedStubPage('timeline-management', 'project-management', 'Project management', { timestamp: TS });
    expect(a).toEqual(b);
  });

  it('passes gc-wiki-lint with zero errors when the survivor page exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-merged-stub-'));
    try {
      await mkdir(join(root, 'competencies'), { recursive: true });
      const stub = buildMergedStubPage('timeline-management', 'project-management', 'Project management', { timestamp: TS });
      await writeFile(join(root, 'competencies', 'timeline-management.md'), stub.content);
      // Dummy survivor page so the stub's [[project-management]] wikilink
      // resolves — without this, lintWiki would (correctly) report a
      // broken-wikilink error that belongs to the fixture, not the stub.
      await writeFile(
        join(root, 'competencies', 'project-management.md'),
        [
          '---',
          'type: competency',
          'title: "Project management"',
          'description: "d"',
          'slug: project-management',
          'tags: [competency]',
          `timestamp: ${TS}`,
          'resource: https://gcworkflow.clemson.edu:8443/wiki/competencies/project-management',
          '---',
          '',
          '# Project management',
          '',
          '## Across the program',
          '',
          '- [[timeline-management|Timeline management]]',
          '',
        ].join('\n'),
      );
      const issues = await lintWiki(root);
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('writeMergedStub (thin writer)', () => {
  afterEach(() => vi.clearAllMocks());

  it('writes exactly one page through the existing write path (writeAndPush), no LLM call', async () => {
    await writeMergedStub('gc-production-literacy', 'domain-knowledge', 'Production domain knowledge');

    expect(writeAndPush).toHaveBeenCalledTimes(1);
    const commit = (writeAndPush as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      pages: Array<{ path: string; content: string }>;
      logEntry: string;
      commitMessage: string;
    };
    expect(commit.pages).toHaveLength(1);
    expect(commit.pages[0]!.path).toBe('competencies/gc-production-literacy.md');
    expect(commit.pages[0]!.content).toContain('[[domain-knowledge|Production domain knowledge]]');

    // No LLM call: the provider factory was never invoked.
    expect(getProviderForFunction).not.toHaveBeenCalled();
  });

  it('returns the sha from the write path', async () => {
    const result = await writeMergedStub('domain-grounding', 'domain-knowledge', 'Production domain knowledge');
    expect(result).toEqual({ sha: 'deadbeef' });
  });

  it('builds the page via buildMergedStubPage (same content shape)', async () => {
    await writeMergedStub('timeline-management', 'project-management', 'Project management');
    const commit = (writeAndPush as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      pages: Array<{ path: string; content: string }>;
    };
    const expected = buildMergedStubPage('timeline-management', 'project-management', 'Project management', {
      timestamp: commit.pages[0]!.content.match(/^timestamp: (.+)$/m)![1],
    });
    expect(commit.pages[0]).toEqual(expected);
  });
});
