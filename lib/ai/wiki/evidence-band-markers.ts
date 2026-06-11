/**
 * Evidence-band markers in compiled wiki prose (increment A).
 *
 * The wiki-update prompt renders a compact evidence-band marker after each
 * competency's K/U/D chip on the course page — `·claimed` / `·materials` /
 * `·artifact` — so a reader can tell instructor-claimed from materials-cited
 * from artifact-verified. These helpers let the read-time tools (search_wiki /
 * read_wiki) detect the markers present on a page and apply an optional
 * band floor ("only artifact-verified"). Pure string functions — no I/O.
 *
 * Band semantics come from `lib/program/evidence-ladder.ts` (deriveEvidenceBand).
 */

import type { EvidenceBand } from '@/lib/program/evidence-ladder';

/** Ladder order, lowest → highest credibility. */
export const BAND_ORDER: readonly EvidenceBand[] = [
  'claimed',
  'materials_supported',
  'artifact_verified',
] as const;

/** The literal token rendered in page prose for each band. */
export const BAND_MARKER: Record<EvidenceBand, string> = {
  claimed: '·claimed',
  materials_supported: '·materials',
  artifact_verified: '·artifact',
};

/** Numeric rank for floor comparison (0 = lowest). */
export function bandRank(band: EvidenceBand): number {
  return BAND_ORDER.indexOf(band);
}

/**
 * Which evidence-band markers appear in a page's markdown, deduped and
 * returned in ladder order. Empty when the page carries no markers (legacy /
 * not-yet-recompiled pages).
 */
export function detectBands(markdown: string): EvidenceBand[] {
  return BAND_ORDER.filter(band => markdown.includes(BAND_MARKER[band]));
}

/**
 * Does a page clear a band floor? A page passes when it has NO markers at all
 * (legacy page — we don't hide it) OR at least one marker at or above the
 * floor. Only a page that carries markers and whose markers are ALL below the
 * floor is filtered out.
 */
export function pagePassesBandFloor(present: EvidenceBand[], floor: EvidenceBand): boolean {
  if (present.length === 0) return true;
  const floorRank = bandRank(floor);
  return present.some(b => bandRank(b) >= floorRank);
}
