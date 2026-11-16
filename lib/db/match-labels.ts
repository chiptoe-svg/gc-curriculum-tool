/** Parsing for the owner's labeling sheet ("1F 2P 3N …": pair number + F fully / P partly / N not). */
export type Label = 'fully' | 'partly' | 'not';
const WORD: Record<string, Label> = { F: 'fully', P: 'partly', N: 'not' };

/** Pair number -> label. Throws on a token that is not <number><F|P|N> or on a number given twice. */
export function parseLabels(s: string): Map<number, Label> {
  const out = new Map<number, Label>();
  for (const tok of s.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+)([FPNfpn])$/.exec(tok);
    if (!m) throw new Error(`Cannot read "${tok}": expected a pair number then F, P or N (for example 12F).`);
    const i = Number(m[1]);
    if (out.has(i)) throw new Error(`Pair ${i} is labeled twice.`);
    out.set(i, WORD[m[2]!.toUpperCase()]!);
  }
  return out;
}
