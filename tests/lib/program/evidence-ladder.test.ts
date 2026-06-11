import { describe, it, expect } from 'vitest';
import { deriveEvidenceBand } from '@/lib/program/evidence-ladder';
import type { EvidenceClaim } from '@/lib/program/evidence-ladder';

describe('deriveEvidenceBand', () => {
  it('returns claimed when there are no citations', () => {
    const claim: EvidenceClaim = { source: 'instructor', citations: [] };
    expect(deriveEvidenceBand(claim)).toBe('claimed');
  });

  it('returns claimed when citations is undefined', () => {
    const claim: EvidenceClaim = { source: 'instructor', citations: undefined };
    expect(deriveEvidenceBand(claim)).toBe('claimed');
  });

  it('returns claimed when citations is null', () => {
    const claim: EvidenceClaim = { source: 'instructor', citations: null };
    expect(deriveEvidenceBand(claim)).toBe('claimed');
  });

  it('returns claimed when source is inferred (even with chunk citations)', () => {
    // inferred = synthesizer could not attribute to a real source — treat as claimed
    const claim: EvidenceClaim = {
      source: 'inferred',
      citations: [{ type: 'chunk', chunkId: 'abc12345', excerpt: 'rubric text' }],
    };
    // NOTE: per spec, source==='inferred' → claimed regardless of citations
    // The spec says: "source === 'inferred', or only instructor-type citations → claimed"
    // A chunk citation with inferred source is ambiguous; spec says inferred → claimed.
    expect(deriveEvidenceBand(claim)).toBe('claimed');
  });

  it('returns claimed when source is undefined (pre-v2 / legacy)', () => {
    const claim: EvidenceClaim = { source: undefined, citations: undefined };
    expect(deriveEvidenceBand(claim)).toBe('claimed');
  });

  it('returns claimed when only instructor citations are present', () => {
    const claim: EvidenceClaim = {
      source: 'instructor',
      citations: [
        { type: 'instructor', messageId: 'a1b2c3d4', excerpt: 'faculty said X' },
      ],
    };
    expect(deriveEvidenceBand(claim)).toBe('claimed');
  });

  it('returns materials_supported when at least one chunk citation is present', () => {
    const claim: EvidenceClaim = {
      source: 'materials',
      citations: [{ type: 'chunk', chunkId: 'abc12345', excerpt: 'assignment text' }],
    };
    expect(deriveEvidenceBand(claim)).toBe('materials_supported');
  });

  it('returns materials_supported for mixed instructor + chunk citations', () => {
    const claim: EvidenceClaim = {
      source: 'materials',
      citations: [
        { type: 'instructor', messageId: 'a1b2c3d4', excerpt: 'faculty context' },
        { type: 'chunk', chunkId: 'deadbeef', excerpt: 'rubric criterion' },
      ],
    };
    expect(deriveEvidenceBand(claim)).toBe('materials_supported');
  });

  it('returns materials_supported when source is instructor but a chunk citation exists', () => {
    // source==='instructor' is the claim origin; a chunk citation still elevates the band
    const claim: EvidenceClaim = {
      source: 'instructor',
      citations: [{ type: 'chunk', chunkId: 'feedcafe', excerpt: 'syllabus passage' }],
    };
    expect(deriveEvidenceBand(claim)).toBe('materials_supported');
  });

  it('returns materials_supported when source is materials, even with no chunk citation', () => {
    // The synthesizer attributed the claim to course materials; `source` is
    // itself an L1 signal, so it's materials_supported, not a bare claim —
    // even if no chunk citation resolved (or only an instructor citation did).
    expect(deriveEvidenceBand({ source: 'materials', citations: [] })).toBe('materials_supported');
    expect(deriveEvidenceBand({ source: 'materials', citations: undefined })).toBe('materials_supported');
    expect(deriveEvidenceBand({
      source: 'materials',
      citations: [{ type: 'instructor', messageId: 'a1b2c3d4', excerpt: 'faculty note' }],
    })).toBe('materials_supported');
  });
});
