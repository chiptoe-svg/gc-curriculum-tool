/**
 * Tests for lib/ai/wiki/update.ts
 *
 * Fixture-driven: all Postgres queries and the AI provider are mocked.
 * We verify:
 *   (a) The raw layer is built correctly from a known snapshot.
 *   (b) The right substrate is assembled and passed to the provider.
 *   (c) The orchestrator validates the output and returns the expected shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that transitively use them.
// ---------------------------------------------------------------------------

// Mock drizzle DB client so no real Postgres connections are opened.
vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
}));

// Mock capture-snapshots-queries so we control what getSnapshotById returns.
vi.mock('@/lib/db/capture-snapshots-queries', () => ({
  getSnapshotById: vi.fn(),
}));

// Mock the AI provider factory.
vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: vi.fn(),
}));

// Mock the prompt loader.
vi.mock('@/lib/ai/prompts/load', () => ({
  loadPrompt: vi.fn(),
}));

// Mock node:fs/promises readFile (used to read existing wiki pages).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { db } from '@/lib/db/client';

import {
  courseCodeToSlug,
  computeAffectedPages,
  updateWikiForSnapshot,
  type WikiUpdateResult,
} from '../update';

import type { SnapshotRow } from '@/lib/db/capture-snapshots-queries';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SNAPSHOT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const SESSION_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

const mockProfile: CaptureProfile = {
  course_code: 'GC 4800',
  scale_version: 'v1',
  generated_at: '2026-05-25T14:00:00Z',
  overview: {
    narrative: 'In this capstone course students synthesize four years of study.',
    at_a_glance: ['Project-based', 'Industry clients', 'Cross-disciplinary teams'],
    who_for: 'Senior GC majors headed into agency or production roles.',
    arc: 'Students start with research, move to ideation, then production and presentation.',
  },
  competencies: [
    {
      statement: 'Manages client relationships',
      type: 'technical',
      k_depth: 3,
      u_depth: 3,
      d_depth: 4,
      evidence_k: 'Weekly client updates',
      evidence_u: 'Post-project reflection',
      evidence_d: 'Client communication portfolio',
      rationale: 'Strong D evidence from portfolio',
      source: 'materials',
      citations: [],
    },
  ],
  incoming_expectations: [],
  verification_summary: {
    course_shape: 'Integration capstone — high D across all competencies.',
    strongest_evidence: ['Portfolio rubric', 'Client letter'],
    dimensional_patterns: ['K3/U3/D4 typical'],
    catalog_vs_evidence: [],
    foundationals_glance: 'Agency D4 throughout.',
  },
  audit_notes: {
    prereq_gaps: [],
    objective_misalignments: [],
    cross_source_conflicts: [],
    suggested_objective_revisions: [],
    productive_failure_conditions: {
      generate_then_consolidate: 'present',
      open_ended_problems: 'present',
      revision_cycles: 'present',
      structured_post_mortem: 'partial',
      max_supporting_depth: 4,
      notes: ['Strong generate-then-consolidate pattern in project phases.'],
    },
  },
  revised_objectives_draft: null,
  course_emphasis: null,
};

const mockSnapshot: SnapshotRow = {
  id: SNAPSHOT_ID,
  courseCode: 'GC 4800',
  profile: mockProfile,
  inputsMeta: {
    catalog: {
      description: '',
      prerequisites: '',
      learningObjectives: [],
      majorProjects: [],
      skillsRequired: [],
    },
    builderProfilePresent: false,
    materials: [],
    prereqSnapshotsUsed: [],
    scanPasses: { canvasImportedAt: null, googleDocsScannedAt: null },
  },
  transcript: [],
  caption: 'Spring 2026',
  captionNote: null,
  reviewerNote: 'Faculty approved this profile.',
  transcriptSessionId: SESSION_ID,
  scaleVersion: 'v1',
  model: 'gpt-5.4',
  instructorName: 'Department canonical',
  retiredAt: null,
  createdAt: new Date('2026-05-25T14:00:00Z'),
};

// The LLM response the mock provider will return.
const mockLLMResponse = {
  pages: [
    {
      path: 'courses/gc-4800.md',
      content: '---\ntype: course\nslug: gc-4800\n---\n# GC 4800 — Senior Capstone\n',
      operation: 'create' as const,
    },
    {
      path: 'concepts/productive-failure.md',
      content: '---\ntype: concept\nslug: productive-failure\n---\n# Productive Failure\n',
      operation: 'create' as const,
    },
    {
      path: 'index.md',
      content: '---\ntype: index\n---\n# GC Curriculum Knowledge Base\n',
      operation: 'create' as const,
    },
  ],
  log_entry: '2026-05-25T14:00:00Z — ingest gc-4800 (Spring 2026): regenerated courses/gc-4800.md, concepts/productive-failure.md, index.md',
};

// ---------------------------------------------------------------------------
// Helper: build a drizzle-style chainable mock that resolves to `rows`.
// The chain is thenable at every stage so callers can `await` after any
// terminating call (where, orderBy, limit, etc.).
// ---------------------------------------------------------------------------
function makeDbChain(rows: unknown[]) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const selfReturn = () => chain;
  chain.select = selfReturn;
  chain.from = selfReturn;
  chain.innerJoin = selfReturn;
  chain.where = selfReturn;
  chain.orderBy = selfReturn;
  chain.limit = () => Promise.resolve(rows);
  // Make the chain itself thenable so `await db.select().from()...` resolves.
  (chain as Record<string, unknown>).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('courseCodeToSlug', () => {
  it('converts "GC 4800" → "gc-4800"', () => {
    expect(courseCodeToSlug('GC 4800')).toBe('gc-4800');
  });

  it('converts "GC 1010" → "gc-1010"', () => {
    expect(courseCodeToSlug('GC 1010')).toBe('gc-1010');
  });

  it('handles multiple spaces by collapsing them to a single hyphen', () => {
    // The regex /\s+/ collapses any run of whitespace → single '-'.
    expect(courseCodeToSlug('GC  4800')).toBe('gc-4800');
  });
});

describe('computeAffectedPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // coverage_cells query returns two distinct sub-competencies and targets.
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(
      makeDbChain([
        { subCompetencyId: 'brand-strategy', careerTargetId: 'brand-strategist' },
        { subCompetencyId: 'client-communication', careerTargetId: 'brand-strategist' },
      ]),
    );
  });

  it('always includes course page and index page in wiki list', async () => {
    const { wiki } = await computeAffectedPages(mockSnapshot, null);
    const types = wiki.map(p => p.type);
    expect(types).toContain('course');
    expect(types).toContain('index');
  });

  it('includes competency pages for each unique sub-competency', async () => {
    const { wiki } = await computeAffectedPages(mockSnapshot, null);
    const competencyPages = wiki.filter(p => p.type === 'competency');
    expect(competencyPages.map(p => p.slug)).toContain('brand-strategy');
    expect(competencyPages.map(p => p.slug)).toContain('client-communication');
  });

  it('includes target page for each unique career target', async () => {
    const { wiki } = await computeAffectedPages(mockSnapshot, null);
    const targetPages = wiki.filter(p => p.type === 'target');
    expect(targetPages.map(p => p.slug)).toContain('brand-strategist');
  });

  it('includes productive-failure concept when audit_notes.productive_failure_conditions is set', async () => {
    const { wiki } = await computeAffectedPages(mockSnapshot, null);
    const slugs = wiki.map(p => p.slug);
    expect(slugs).toContain('productive-failure');
  });

  it('always includes three-act-structure concept page', async () => {
    const { wiki } = await computeAffectedPages(mockSnapshot, null);
    const slugs = wiki.map(p => p.slug);
    expect(slugs).toContain('three-act-structure');
  });

  it('does NOT include productive-failure when conditions are absent', async () => {
    const snapshotWithoutPF: SnapshotRow = {
      ...mockSnapshot,
      profile: {
        ...mockProfile,
        audit_notes: {
          ...mockProfile.audit_notes,
          productive_failure_conditions: null,
        },
      },
    };
    const { wiki } = await computeAffectedPages(snapshotWithoutPF, null);
    const slugs = wiki.map(p => p.slug);
    expect(slugs).not.toContain('productive-failure');
  });

  describe('raw layer', () => {
    it('always includes the snapshot JSON file', async () => {
      const { raw } = await computeAffectedPages(mockSnapshot, null);
      const snapshotFile = raw.find(p => p.path.startsWith('raw/snapshots/'));
      expect(snapshotFile).toBeDefined();
      expect(snapshotFile!.path).toMatch(/^raw\/snapshots\/gc-4800\/2026-05-25_[0-9a-f]+\.json$/);
    });

    it('snapshot JSON content is the formatted profile', async () => {
      const { raw } = await computeAffectedPages(mockSnapshot, null);
      const snapshotFile = raw.find(p => p.path.startsWith('raw/snapshots/'));
      expect(snapshotFile!.content).toBe(JSON.stringify(mockProfile, null, 2));
    });

    it('includes transcript file when transcriptMarkdown is provided', async () => {
      const { raw } = await computeAffectedPages(mockSnapshot, '# transcript\ncontent');
      const transcriptFile = raw.find(p => p.path.startsWith('raw/transcripts/'));
      expect(transcriptFile).toBeDefined();
      expect(transcriptFile!.path).toMatch(/^raw\/transcripts\/gc-4800\/2026-05-25_[0-9a-f]+\.md$/);
      expect(transcriptFile!.content).toBe('# transcript\ncontent');
    });

    it('does NOT include transcript file when transcriptMarkdown is null', async () => {
      const { raw } = await computeAffectedPages(mockSnapshot, null);
      const transcriptFile = raw.find(p => p.path.startsWith('raw/transcripts/'));
      expect(transcriptFile).toBeUndefined();
    });

    it('snapshot JSON path includes short id derived from snapshot id', async () => {
      const { raw } = await computeAffectedPages(mockSnapshot, null);
      const snapshotFile = raw.find(p => p.path.startsWith('raw/snapshots/'));
      // SNAPSHOT_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
      // shortId = first 7 chars of aaaaaaa00000000000000000000001 = 'aaaaaaa'
      expect(snapshotFile!.path).toContain('aaaaaaa');
    });
  });
});

describe('updateWikiForSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // getSnapshotById returns the fixture snapshot.
    (getSnapshotById as ReturnType<typeof vi.fn>).mockResolvedValue(mockSnapshot);

    // All db.select() chains return empty arrays by default (no coverage,
    // no course rows, no concept substrate). Individual tests override as needed.
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(makeDbChain([]));

    // No existing wiki pages.
    (readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    // Prompt loader returns a simple string.
    (loadPrompt as ReturnType<typeof vi.fn>).mockResolvedValue('You are the wiki maintainer.');

    // Provider returns the mock LLM response.
    (getProviderForFunction as ReturnType<typeof vi.fn>).mockResolvedValue({
      model: 'gpt-5.5',
      complete: vi.fn().mockResolvedValue({
        data: mockLLMResponse,
        costUsdCents: 150,
        durationMs: 3000,
        cachedTokens: 0,
        uncachedPromptTokens: 5000,
        completionTokens: 1500,
      }),
    });
  });

  it('throws when snapshot is not found', async () => {
    (getSnapshotById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(updateWikiForSnapshot('bad-id')).rejects.toThrow('snapshot bad-id not found');
  });

  it('returns raw, wiki, and logEntry fields', async () => {
    const result: WikiUpdateResult = await updateWikiForSnapshot(SNAPSHOT_ID);
    expect(result).toHaveProperty('raw');
    expect(result).toHaveProperty('wiki');
    expect(result).toHaveProperty('logEntry');
  });

  it('raw layer always includes the snapshot JSON', async () => {
    const { raw } = await updateWikiForSnapshot(SNAPSHOT_ID);
    const snapshotFile = raw.find(p => p.path.startsWith('raw/snapshots/'));
    expect(snapshotFile).toBeDefined();
  });

  it('raw layer includes transcript when snapshot has transcriptSessionId', async () => {
    // Execution order in updateWikiForSnapshot:
    //   1. renderTranscriptMarkdown → captureMessages query (1st db.select)
    //   2. computeAffectedPages → coverage cells query (2nd db.select)
    //   3. substrate/course loaders → remaining db.select calls
    const transcriptRow = {
      id: 'msg-001',
      courseCode: 'GC 4800',
      sessionId: SESSION_ID,
      turnIndex: 0,
      role: 'user',
      content: 'Hello',
      toolCalls: null,
      toolResult: null,
      citations: null,
      createdAt: new Date('2026-05-25T13:00:00Z'),
    };
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeDbChain([transcriptRow]))  // captureMessages rows
      .mockReturnValueOnce(makeDbChain([]))               // coverage cells
      .mockReturnValue(makeDbChain([]));                  // remaining queries

    const { raw } = await updateWikiForSnapshot(SNAPSHOT_ID);
    const transcriptFile = raw.find(p => p.path.startsWith('raw/transcripts/'));
    expect(transcriptFile).toBeDefined();
    expect(transcriptFile!.content).toContain('Turn 0');
    expect(transcriptFile!.content).toContain('Hello');
  });

  it('does NOT include transcript in raw when snapshot has no transcriptSessionId', async () => {
    const snapshotNoSession: SnapshotRow = { ...mockSnapshot, transcriptSessionId: null };
    (getSnapshotById as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotNoSession);

    const { raw } = await updateWikiForSnapshot(SNAPSHOT_ID);
    const transcriptFile = raw.find(p => p.path.startsWith('raw/transcripts/'));
    expect(transcriptFile).toBeUndefined();
  });

  it('wiki pages come from LLM response (non-unchanged only)', async () => {
    const { wiki } = await updateWikiForSnapshot(SNAPSHOT_ID);
    // All three mock pages are 'create', so all should appear.
    expect(wiki).toHaveLength(3);
    expect(wiki.map(p => p.path)).toContain('courses/gc-4800.md');
    expect(wiki.map(p => p.path)).toContain('concepts/productive-failure.md');
    expect(wiki.map(p => p.path)).toContain('index.md');
  });

  it('filters out unchanged pages from wiki output', async () => {
    const responseWithUnchanged = {
      ...mockLLMResponse,
      pages: [
        ...mockLLMResponse.pages,
        {
          path: 'competencies/brand-strategy.md',
          content: '---\ntype: competency\n---\n',
          operation: 'unchanged' as const,
        },
      ],
    };
    const provider = {
      model: 'gpt-5.5',
      complete: vi.fn().mockResolvedValue({ data: responseWithUnchanged, costUsdCents: 200, durationMs: 3500, cachedTokens: 0, uncachedPromptTokens: 6000, completionTokens: 1800 }),
    };
    (getProviderForFunction as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    const { wiki } = await updateWikiForSnapshot(SNAPSHOT_ID);
    expect(wiki.map(p => p.path)).not.toContain('competencies/brand-strategy.md');
  });

  it('drops model-returned page paths that were not requested (F8)', async () => {
    const responseWithRoguePaths = {
      ...mockLLMResponse,
      pages: [
        ...mockLLMResponse.pages, // 3 legit, requested paths
        // A steered/hallucinating model trying to write outside this run's scope:
        { path: 'log.md', content: 'overwrite the append-only log', operation: 'create' as const },
        { path: 'competencies/not-in-this-run.md', content: 'rogue', operation: 'create' as const },
        { path: '.git/hooks/post-checkout', content: '#!/bin/sh\necho pwned', operation: 'create' as const },
      ],
    };
    const provider = {
      model: 'gpt-5.5',
      complete: vi.fn().mockResolvedValue({ data: responseWithRoguePaths, costUsdCents: 200, durationMs: 3500, cachedTokens: 0, uncachedPromptTokens: 6000, completionTokens: 1800 }),
    };
    (getProviderForFunction as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    const { wiki } = await updateWikiForSnapshot(SNAPSHOT_ID);
    const paths = wiki.map(p => p.path);
    // Only the requested narrative pages survive.
    expect(paths).toEqual(
      expect.arrayContaining(['courses/gc-4800.md', 'concepts/productive-failure.md', 'index.md']),
    );
    expect(paths).not.toContain('log.md');
    expect(paths).not.toContain('competencies/not-in-this-run.md');
    expect(paths).not.toContain('.git/hooks/post-checkout');
    expect(wiki).toHaveLength(3);
  });

  it('logEntry is derived from the LLM response', async () => {
    // The reconcile pass (increment C) re-requests pages the mock omits, so the
    // returned log_entry can appear more than once joined by ' · '; the entry
    // must still come from the LLM response, never be fabricated.
    const { logEntry } = await updateWikiForSnapshot(SNAPSHOT_ID);
    expect(logEntry).toContain(mockLLMResponse.log_entry);
  });

  it('passes snapshot profile + derived competency bands to the provider', async () => {
    const provider = {
      model: 'gpt-5.5',
      complete: vi.fn().mockResolvedValue({ data: mockLLMResponse, costUsdCents: 150, durationMs: 3000, cachedTokens: 0, uncachedPromptTokens: 5000, completionTokens: 1500 }),
    };
    (getProviderForFunction as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    await updateWikiForSnapshot(SNAPSHOT_ID);

    // The mock omits some requested pages, so the reconcile retry (increment C)
    // calls the provider more than once; assert on the FIRST (primary) call.
    expect(provider.complete).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    const userMsg = JSON.parse(callArgs.userMessage as string);
    expect(userMsg.snapshot.id).toBe(SNAPSHOT_ID);
    expect(userMsg.snapshot.courseCode).toBe('GC 4800');
    expect(userMsg.snapshot.profile).toEqual(mockProfile);
    // Increment A: a band per competency, keyed by statement.
    expect(Array.isArray(userMsg.competencyBands)).toBe(true);
    expect(userMsg.competencyBands).toHaveLength(mockProfile.competencies.length);
    expect(userMsg.competencyBands[0]).toHaveProperty('band');
    expect(userMsg.competencyBands[0]).toHaveProperty('statement');
  });

  it('passes rawPaths to the provider so LLM can link them', async () => {
    const provider = {
      model: 'gpt-5.5',
      complete: vi.fn().mockResolvedValue({ data: mockLLMResponse, costUsdCents: 150, durationMs: 3000, cachedTokens: 0, uncachedPromptTokens: 5000, completionTokens: 1500 }),
    };
    (getProviderForFunction as ReturnType<typeof vi.fn>).mockResolvedValue(provider);

    await updateWikiForSnapshot(SNAPSHOT_ID);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    const userMsg = JSON.parse(callArgs.userMessage as string);
    expect(userMsg.rawPaths.snapshotJson).toMatch(/^raw\/snapshots\/gc-4800\//);
  });

  it('throws on invalid LLM response (missing pages field)', async () => {
    const badProvider = {
      model: 'gpt-5.5',
      complete: vi.fn().mockResolvedValue({
        data: { pages: null, log_entry: 'something' },
        costUsdCents: 10,
        durationMs: 100,
        cachedTokens: 0,
        uncachedPromptTokens: 100,
        completionTokens: 50,
      }),
    };
    // The validate fn runs inside provider.complete — simulate it throwing.
    badProvider.complete.mockImplementation(({ validate }: { validate: (raw: unknown) => unknown }) => {
      try {
        validate({ pages: null, log_entry: 'something' });
      } catch (err) {
        return Promise.reject(err);
      }
      return Promise.resolve({ data: {}, costUsdCents: 0, durationMs: 0, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 });
    });
    (getProviderForFunction as ReturnType<typeof vi.fn>).mockResolvedValue(badProvider);

    await expect(updateWikiForSnapshot(SNAPSHOT_ID)).rejects.toThrow();
  });
});
