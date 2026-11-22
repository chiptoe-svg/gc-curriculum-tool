/**
 * Code-checked evidence measures for the agent-vs-single-call benchmark.
 * Pure functions: no DB, no network, no model calls.
 */
import { depthBand } from '@/lib/program/depth-band';

export type Dim = 'k' | 'u' | 'd';

/**
 * Lowercase, unify dash variants, strip quote marks (as role-judge's normText
 * does, from both source and fragments), collapse whitespace.
 */
export function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[‘’“”"'`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fragments shorter than this cannot ground anything. */
const MIN_FRAGMENT_LENGTH = 12;

/**
 * Split the raw excerpt into quote fragments the way scripts/reliability/grounding.ts
 * does (ellipses, quote marks, semicolons, spaced em/en dashes), normalize each, strip
 * edge punctuation, and keep fragments of MIN_FRAGMENT_LENGTH or more.
 */
function quoteFragments(quote: string): string[] {
  return quote
    .split(/\.\.\.|…|[“”"]|;\s|\s—\s|\s–\s/)
    .map(normalizeForQuote)
    .map(f => f.replace(/^[,.:;\-\s]+|[,.:;\-\s]+$/g, ''))
    .filter(f => f.length >= MIN_FRAGMENT_LENGTH);
}

/** Same rule as grounding.ts: a fragment over 80 chars may match on any 60-char window. */
function fragmentInText(frag: string, normalizedText: string): boolean {
  if (normalizedText.includes(frag)) return true;
  if (frag.length > 80) {
    for (let i = 0; i + 60 <= frag.length; i += 20) {
      if (normalizedText.includes(frag.slice(i, i + 60))) return true;
    }
  }
  return false;
}

/**
 * Excerpt grounding, matching role-judge's grounded(): the quote is found only
 * if every fragment (each >= 12 normalized chars) appears in some source. An
 * all-short quote is not found. sourceId is the source holding the first fragment.
 */
export function findQuote(
  quote: string,
  sources: Array<{ id: string; text: string }>,
): { found: boolean; sourceId: string | null } {
  const frags = quoteFragments(quote);
  if (frags.length === 0) return { found: false, sourceId: null };
  const texts = sources.map(src => ({ id: src.id, text: normalizeForQuote(src.text) }));
  let firstSourceId: string | null = null;
  for (const frag of frags) {
    const hit = texts.find(t => fragmentInText(frag, t.text));
    if (!hit) return { found: false, sourceId: null };
    firstSourceId ??= hit.id;
  }
  return { found: true, sourceId: firstSourceId };
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
 * Per-dim agreement share for ONE cell across runs: the fraction of its three
 * dims (k, u, d) whose depth band is identical in every run. Same definition
 * as scripts/bench/role-judge.ts (bands via depthBand, null maps to 'none').
 * Callers average the result over cells. Fewer than two runs gives NaN.
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
