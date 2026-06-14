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

/**
 * Read the structured `evidence_bands: [...]` list from a page's YAML
 * frontmatter — the machine-readable counterpart to the prose markers.
 * Returns the deduped bands in ladder order, `[]` when the field is present
 * but empty, and `null` when the field (or frontmatter) is ABSENT — so a
 * caller can fall back to prose-scraping legacy pages.
 */
export function readEvidenceBandsFrontmatter(markdown: string): EvidenceBand[] | null {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const line = fm[1]!.match(/^evidence_bands:\s*(.*)$/m);
  if (!line) return null;
  const items = line[1]!
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const present = new Set(items);
  return BAND_ORDER.filter(b => present.has(b));
}

/**
 * The single read-time accessor: structured frontmatter when stamped, prose
 * markers as a graceful fallback for legacy / not-yet-backfilled pages.
 */
export function resolvePageBands(markdown: string): EvidenceBand[] {
  return readEvidenceBandsFrontmatter(markdown) ?? detectBands(markdown);
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Pure: filter null, dedupe, and order an evidence-band list by the ladder. */
export function dedupeBands(bands: ReadonlyArray<EvidenceBand | null>): EvidenceBand[] {
  const present = new Set(bands.filter((b): b is EvidenceBand => b !== null));
  return BAND_ORDER.filter(b => present.has(b));
}

/**
 * Pure: stamp `evidence_bands: [a, b]` into a page's YAML frontmatter — the
 * structured counterpart to the prose band markers. Replace-if-present,
 * append-into-block if absent, prepend a block if the page has no frontmatter.
 */
export function stampEvidenceBands(content: string, bands: EvidenceBand[]): string {
  const line = `evidence_bands: [${bands.join(', ')}]`;
  const m = content.match(FRONTMATTER_RE);
  if (m) {
    const body = /^evidence_bands:\s*.*$/m.test(m[1]!)
      ? m[1]!.replace(/^evidence_bands:\s*.*$/m, line)
      : `${m[1]!}\n${line}`;
    return content.replace(FRONTMATTER_RE, `---\n${body}\n---\n`);
  }
  return `---\n${line}\n---\n\n${content}`;
}
