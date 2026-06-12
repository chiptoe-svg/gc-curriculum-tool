import { describe, it, expect } from 'vitest';
import {
  captureCompetencySchema,
  captureCompetencySchemaV2,
  type CaptureCompetency,
} from '@/lib/ai/capture/schema';
import { withDerivedCompetencySources } from '@/lib/ai/synthesis/source-derivation';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const CHUNK_CITATION = { type: 'chunk' as const, chunkId: 'abc123', messageId: null, excerpt: 'graded rubric line' };

function competency(o: Partial<CaptureCompetency>): unknown {
  return {
    statement: 'Mixes spot-color inks',
    type: 'technical',
    k_depth: 3,
    u_depth: 2,
    d_depth: 3,
    evidence_k: 'k evidence',
    evidence_u: 'u evidence',
    evidence_d: 'd evidence',
    rationale: 'because',
    ...o,
  };
}

describe('captureCompetencySchemaV2 (A9 — provenance required)', () => {
  it('rejects a competency with no source (legacy schema accepts it)', () => {
    const c = competency({ citations: [CHUNK_CITATION] });
    expect(captureCompetencySchema.safeParse(c).success).toBe(true);
    expect(captureCompetencySchemaV2.safeParse(c).success).toBe(false);
  });

  it('rejects a competency with no citations array', () => {
    const c = competency({ source: 'materials' });
    expect(captureCompetencySchemaV2.safeParse(c).success).toBe(false);
  });

  it('rejects a non-inferred source with an empty citations array', () => {
    const c = competency({ source: 'materials', citations: [] });
    const res = captureCompetencySchemaV2.safeParse(c);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some(i => /requires at least one resolvable citation/.test(i.message))).toBe(true);
    }
  });

  it('accepts inferred with empty citations, and materials with a real citation', () => {
    expect(captureCompetencySchemaV2.safeParse(competency({ source: 'inferred', citations: [] })).success).toBe(true);
    expect(captureCompetencySchemaV2.safeParse(competency({ source: 'materials', citations: [CHUNK_CITATION] })).success).toBe(true);
  });
});

describe('withDerivedCompetencySources (provenance is derived, not self-reported)', () => {
  it('downgrades a citation-less claim to inferred and upgrades per citation types', () => {
    const profile = {
      competencies: [
        competency({ source: 'materials', citations: [] }),               // misclaimed → inferred
        competency({ source: 'inferred', citations: [CHUNK_CITATION] }),  // chunk-cited → materials
      ],
    } as unknown as CaptureProfile;
    const out = withDerivedCompetencySources(profile);
    expect(out.competencies[0]!.source).toBe('inferred');
    expect(out.competencies[1]!.source).toBe('materials');
    // pure: input untouched
    expect((profile.competencies[0] as { source?: string }).source).toBe('materials');
  });
});
