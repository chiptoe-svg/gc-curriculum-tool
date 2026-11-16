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

/** One record of the spike's pairs file: `later`/`earlier` are course codes, `required` and `supplies` the skill texts, `need` the required levels. */
export type SpikePair = {
  i: number; later: string; required: string; need?: { k: number; u: number; d: number }; earlier: string; supplies: string;
  pFully?: number | null; pPartly?: number | null;
};

/** The decision row for a labeled spike pair (texts as written; no snapshot ids; judge P is the spike's qwen3.8-27b-fp8 / m1). */
export function spikeDecision(p: SpikePair, label: Label, by: string, titles: Map<string, string>, hash: (s: string) => string) {
  return {
    requiredHash: hash(p.required), suppliedHash: hash(p.supplies),
    requiredText: p.required, suppliedText: p.supplies,
    requiredCourse: p.later, requiredCourseTitle: titles.get(p.later) ?? null,
    suppliedCourse: p.earlier, suppliedCourseTitle: titles.get(p.earlier) ?? null,
    label, draft: false, source: 'labeling_sheet' as const, decidedBy: by,
    judgeModel: 'qwen3.8-27b-fp8', promptVersion: 'm1', judgePFully: p.pFully ?? null, judgePPartly: p.pPartly ?? null,
  };
}
