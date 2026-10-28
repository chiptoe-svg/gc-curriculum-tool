/**
 * "Both sources" label (owner, 2026-10-27): a finding citing the instructor AND
 * a course file was labeled 'inferred' — the same as no evidence — so the
 * best-supported findings showed "The AI inferred this" and ranked 'claimed'.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));

import { CaptureProfileSource } from '@/lib/ai/capture/schema';
import { deriveSourceFlag } from '@/lib/ai/synthesis/source-derivation';
import { deriveEvidenceBand } from '@/lib/program/evidence-ladder';
import { captureProfileJsonSchema, captureProfileJsonSchemaV2 } from '@/lib/ai/analyze/capture-scores';
import { humanizeSource, sourceLabel, statusTagFor } from '@/app/capture/[code]/ProfileReviewPanel';
import { relabelProfile } from '@/scripts/capture/relabel-both-sources';

const mixed = [
  { type: 'instructor' as const, messageId: 'm1', excerpt: 'we grade it on the rubric' },
  { type: 'chunk' as const, chunkId: 'c1', excerpt: 'Registration: 20 pts' },
];

describe('both sources', () => {
  it('is a valid source value', () => {
    expect(CaptureProfileSource.parse('both')).toBe('both');
  });

  it('a mixed finding ranks as backed by materials, not as claimed', () => {
    expect(deriveEvidenceBand({ source: deriveSourceFlag(mixed), citations: mixed })).toBe('materials_supported');
  });

  it('every strict source enum the scoring model must follow lists it', () => {
    const enums: unknown[][] = [];
    const walk = (node: unknown, key?: string) => {
      if (Array.isArray(node)) { node.forEach(n => walk(n)); return; }
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (key === 'source' && Array.isArray(o.enum)) enums.push(o.enum);
      for (const [k, v] of Object.entries(o)) walk(v, k);
    };
    walk(captureProfileJsonSchema);
    walk(captureProfileJsonSchemaV2);
    expect(enums.length).toBeGreaterThanOrEqual(7);
    for (const e of enums) expect(e).toContain('both');
  });

  it('review screen: its own plain label, not flagged as inferred', () => {
    expect(sourceLabel('both')).toBe('From your interview and course materials');
    expect(humanizeSource('both')).toBe('you said + materials');
    expect(statusTagFor({ source: 'both', citations: mixed }, false)?.label).toBe('From your interview and course materials');
  });
});

describe('relabelProfile', () => {
  const comp = (source: string | undefined, citations: unknown[] | undefined) => ({ statement: 's', source, citations });

  it("relabels only competencies stored as 'inferred' whose citations are mixed", () => {
    const profile = {
      competencies: [
        comp('inferred', mixed),
        comp('inferred', []),
        comp('instructor', [mixed[0]]),
        comp(undefined, undefined),
      ],
    };
    const { profile: out, changed } = relabelProfile(profile as never);
    expect(changed).toBe(1);
    expect((out as typeof profile).competencies.map(c => c.source)).toEqual(['both', 'inferred', 'instructor', undefined]);
    expect(profile.competencies[0]!.source).toBe('inferred'); // input untouched
  });

  it('leaves a profile with nothing to change identical', () => {
    const profile = { competencies: [comp('materials', [mixed[1]])] };
    expect(relabelProfile(profile as never)).toEqual({ profile, changed: 0 });
  });
});
