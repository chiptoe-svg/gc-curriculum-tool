/**
 * Is a model's evidence excerpt actually present in the source it was given?
 * Excerpts are often several quotes stitched with "..." / "…" / ";" and curly
 * quotes, plus short connective words, so: normalise, split into fragments,
 * and require every substantive fragment (≥ 20 chars) to appear verbatim in the
 * normalised source. Long fragments (> 80 chars) may match on any 60-char window
 * (models trim or rejoin long quotes). An excerpt with no substantive fragment
 * counts as grounded only if it appears whole.
 */
export const normText = (s: string) =>
  s.toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/\s+/g, ' ').trim();

export function excerptFragments(excerpt: string): string[] {
  return excerpt
    .split(/\.\.\.|…|[“”"]|;\s|\s—\s|\s–\s/)
    .map(normText)
    .map(f => f.replace(/^[,.:;\-\s]+|[,.:;\-\s]+$/g, ''))
    .filter(f => f.length >= 20);
}

function fragmentFound(frag: string, haystack: string): boolean {
  if (haystack.includes(frag)) return true;
  if (frag.length > 80) for (let i = 0; i + 60 <= frag.length; i += 20) if (haystack.includes(frag.slice(i, i + 60))) return true;
  return false;
}

/** haystack must already be normText()-ed. */
export function grounded(excerpt: string, haystack: string): boolean {
  const frags = excerptFragments(excerpt);
  if (frags.length === 0) { const whole = normText(excerpt); return !!whole && haystack.includes(whole); }
  return frags.every(f => fragmentFound(f, haystack));
}
