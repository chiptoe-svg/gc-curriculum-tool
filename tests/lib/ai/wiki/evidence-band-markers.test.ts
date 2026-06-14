import { describe, it, expect } from 'vitest';
import {
  detectBands,
  pagePassesBandFloor,
  bandRank,
  BAND_MARKER,
  readEvidenceBandsFrontmatter,
  resolvePageBands,
} from '@/lib/ai/wiki/evidence-band-markers';

describe('detectBands', () => {
  it('finds the markers present, deduped and in ladder order', () => {
    const md = `
- [[a|A]] — K2/U1/D1 ${BAND_MARKER.claimed} — x
- [[b|B]] — K4/U3/D3 ${BAND_MARKER.artifact_verified} — y
- [[c|C]] — K3/U2/D2 ${BAND_MARKER.materials_supported} — z
- [[d|D]] — K1/U0/D0 ${BAND_MARKER.claimed} — w
`;
    expect(detectBands(md)).toEqual(['claimed', 'materials_supported', 'artifact_verified']);
  });

  it('returns empty for a page with no markers (legacy page)', () => {
    expect(detectBands('# Page\n- [[a|A]] — K2/U1/D1 — x\n')).toEqual([]);
  });
});

describe('bandRank', () => {
  it('orders the ladder low → high', () => {
    expect(bandRank('claimed')).toBeLessThan(bandRank('materials_supported'));
    expect(bandRank('materials_supported')).toBeLessThan(bandRank('artifact_verified'));
  });
});

describe('pagePassesBandFloor', () => {
  it('keeps a page with no markers regardless of floor (legacy not hidden)', () => {
    expect(pagePassesBandFloor([], 'artifact_verified')).toBe(true);
  });

  it('keeps a page that has a marker at or above the floor', () => {
    expect(pagePassesBandFloor(['materials_supported', 'artifact_verified'], 'artifact_verified')).toBe(true);
    expect(pagePassesBandFloor(['materials_supported'], 'materials_supported')).toBe(true);
  });

  it('drops a page whose markers are all below the floor', () => {
    expect(pagePassesBandFloor(['claimed'], 'materials_supported')).toBe(false);
    expect(pagePassesBandFloor(['claimed', 'materials_supported'], 'artifact_verified')).toBe(false);
  });
});

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
