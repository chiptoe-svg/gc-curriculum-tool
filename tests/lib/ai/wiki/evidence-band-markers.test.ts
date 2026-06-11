import { describe, it, expect } from 'vitest';
import {
  detectBands,
  pagePassesBandFloor,
  bandRank,
  BAND_MARKER,
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
