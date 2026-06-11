import { describe, it, expect } from 'vitest';
import { deriveCompetencyBands } from '@/lib/ai/wiki/update';

// deriveCompetencyBands is a pure named export of update.ts (no I/O) — it maps
// each competency's provenance (source + citations) onto an evidence band via
// deriveEvidenceBand. Band rules themselves are covered by evidence-ladder tests.

describe('deriveCompetencyBands', () => {
  it('keys bands by statement and derives the band from provenance', () => {
    const bands = deriveCompetencyBands([
      { statement: 'Inferred craft', source: 'inferred', citations: [] },
      { statement: 'Materials-cited', source: 'materials', citations: [{ type: 'chunk', chunkId: 'c1', excerpt: 'x' }] },
      { statement: 'Instructor only', source: 'instructor', citations: [{ type: 'instructor', messageId: 'aaaaaaaa', excerpt: 'y' }] },
    ]);
    expect(bands).toEqual([
      { statement: 'Inferred craft', band: 'claimed' },
      { statement: 'Materials-cited', band: 'materials_supported' },
      { statement: 'Instructor only', band: 'claimed' },
    ]);
  });

  it('defaults to claimed when provenance is absent (pre-v2 competency)', () => {
    const bands = deriveCompetencyBands([{ statement: 'Legacy', source: undefined, citations: undefined }]);
    expect(bands).toEqual([{ statement: 'Legacy', band: 'claimed' }]);
  });

  it('preserves order and one entry per competency', () => {
    const bands = deriveCompetencyBands([
      { statement: 'A' },
      { statement: 'B' },
      { statement: 'C' },
    ]);
    expect(bands.map(b => b.statement)).toEqual(['A', 'B', 'C']);
  });
});
