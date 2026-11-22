/**
 * Code-checked evidence measures for the agent-vs-single-call benchmark.
 * Pure functions: no DB, no network, no model calls.
 */
import { depthBand } from '@/lib/program/depth-band';

export type Dim = 'k' | 'u' | 'd';

/** Lowercase, unify curly quotes and dashes, collapse whitespace. */
export function normalizeForQuote(s: string): string {
  return s
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quotes shorter than this cannot ground anything. */
const MIN_QUOTE_LENGTH = 12;

/** Whole-quote match after normalization. Too-short quotes never match. */
export function findQuote(
  quote: string,
  sources: Array<{ id: string; text: string }>,
): { found: boolean; sourceId: string | null } {
  const q = normalizeForQuote(quote);
  if (q.length < MIN_QUOTE_LENGTH) return { found: false, sourceId: null };
  for (const src of sources) {
    if (normalizeForQuote(src.text).includes(q)) return { found: true, sourceId: src.id };
  }
  return { found: false, sourceId: null };
}

/** Evidence floors: K above 1, U above 0, D above 0 require evidence. Null K/U is never a break. */
export function evidenceBreaks(
  cell: { k: number | null; u: number | null; d: number; excerpt: string },
  sources: Array<{ id: string; text: string }>,
): Dim[] {
  const above: Dim[] = [];
  if ((cell.k ?? 0) > 1) above.push('k');
  if ((cell.u ?? 0) > 0) above.push('u');
  if (cell.d > 0) above.push('d');
  if (above.length === 0) return [];
  return findQuote(cell.excerpt, sources).found ? [] : above;
}

/**
 * Share of (cell, dim) pairs whose depth band is identical across all runs.
 * Same definition as scripts/bench/role-judge.ts: bands via depthBand (null
 * maps to 'none'), agreement 1 if every run's band matches, averaged over dims.
 * Fewer than two runs gives NaN, as role-judge's average does.
 */
export function stability(runs: Array<{ k: number | null; u: number | null; d: number }>): number {
  if (runs.length < 2) return NaN;
  const band = (v: number | null) => depthBand(v)?.key ?? 'none';
  const dims: Dim[] = ['k', 'u', 'd'];
  const agree: number[] = dims.map(dim => {
    const bands = runs.map(r => band(r[dim]));
    return bands.every(b => b === bands[0]) ? 1 : 0;
  });
  return agree.reduce((a, b) => a + b, 0) / dims.length;
}
