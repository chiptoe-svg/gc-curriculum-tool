/**
 * Plain-language rendering of K/U/D depth scores, for faculty who have never
 * seen the codes. Pure + deterministic — no React, no AI.
 *
 * `plainDepth(text)` rewrites score codes the AI wrote into its prose
 * ("— D3 via Budget", "K2/U2/D1", "D4–5", "D=0", "K1-only") at DISPLAY time,
 * so profiles generated before the prompt asked for plain language read
 * correctly without regeneration. Only an uppercase K/U/D followed by a single
 * digit 0–5 on a word boundary is touched — "GC 3800", "K-12", "CMYK4",
 * "D12" are left alone.
 *
 * The phrase tables paraphrase the authoritative rubric
 * (lib/ai/prompts/shared/depth-scale.md, mirrored in
 * lib/ai/capture/depth-anchors.ts). Keep them in step if the scale changes.
 */
import type { Dimension } from '@/lib/ai/capture/depth-anchors';

type Six = readonly [string, string, string, string, string, string];

export const PLAIN_DEPTH: Record<Dimension, Six> = {
  // Know — recall and identification of content
  k: [
    'not covered yet',                              // 0 Not present in this course
    'has met it',                                   // 1 Exposure — encountered in delivery
    'recognizes it',                                // 2 Recognize — identifies when shown options
    'recalls it without prompting',                 // 3 Recall — produces on cue, without prompt
    'uses the correct terms',                       // 4 Uses correct terminology
    'is fluent in the vocabulary, edge cases included', // 5 Fluent incl. conventions + edge cases
  ],
  // Understand — reasoning about the why
  u: [
    "doesn't yet reason about why",                 // 0 Not present
    'can restate the explanation',                  // 1 Restates the explanation as given
    'explains it in their own words',               // 2 Explains the rationale in own words
    'predicts consequences',                        // 3 Predicts consequences (if X then Y, because…)
    'reasons through new cases',                    // 4 Reasons through novel cases
    'critiques and extends it',                     // 5 Critiques, identifies limits, extends
  ],
  // Do — behavioral output
  d: [
    'no evidence students do it yet',               // 0 Not evidenced
    'does it with step-by-step direction',          // 1 Per-step direction or supervision
    'does it with a reference or checklist',        // 2 Using a reference or checklist
    'does it independently in familiar situations', // 3 Independently in familiar conditions
    'adapts it to new conditions',                  // 4 Adapts to new conditions or constraints
    'does it creatively and guides others',         // 5 Creatively, with judgment; guides others
  ],
};

export function plainDepthPhrase(dim: Dimension, level: number): string {
  return PLAIN_DEPTH[dim][level] ?? '';
}

/** Structured scores → one phrase: Know and Understand joined by "and", then "; " Do. */
export function plainScores(s: { k?: number | null; u?: number | null; d?: number | null }): string {
  const ku = (['k', 'u'] as const)
    .filter((dim) => s[dim] !== null && s[dim] !== undefined)
    .map((dim) => plainDepthPhrase(dim, s[dim] as number));
  const parts: string[] = [];
  if (ku.length > 0) parts.push(ku.join(' and '));
  if (s.d !== null && s.d !== undefined) parts.push(plainDepthPhrase('d', s.d));
  return parts.join('; ');
}

const HIGH_LOW: Record<string, string> = {
  'K-high': 'knows the terms well',
  'K-low': 'knows few of the terms',
  'U-high': 'reasons well about why',
  'U-low': 'little reasoning about why',
  'D-high': 'strong hands-on work',
  'D-low': 'little hands-on work',
};

// Assignment names that already say what kind of work they are.
const WORK_NOUN = /\b(assignment|project|report|lab|exam|quiz|test|portfolio|paper|sop|critique|presentation|brief|exercise|case study|capstone|final)s?$/i;

function viaClause(name: string): string {
  const n = name.trim();
  return WORK_NOUN.test(n) ? ` (${n})` : ` (${n} assignment)`;
}

const TOKEN = '[KUD][0-5]';
// Combo: two or more tokens separated by "/" or "·" (e.g. K2/U2/D1, K4 · U2 · D3).
const COMBO_RE = new RegExp(`\\b${TOKEN}(?:\\s*[/·]\\s*${TOKEN})+\\b`, 'g');
// Range: D4–5, D3–D4, U1-2.
const RANGE_RE = /\b([KUD])([0-5])\s*[–-]\s*(?:\1)?([0-5])\b/g;
// Equals: D=0, K = 3.
const EQUALS_RE = /\b([KUD])\s*=\s*([0-5])\b/g;
const SINGLE_RE = /\b([KUD])([0-5])\b/g;
// "via {Assignment}" that follows a rewritten score, up to punctuation or end.
const VIA_RE = /\u0000\s+via\s+(.+?)(?=[;,)]|\.\s|\.$|$)/g;

function dimOf(letter: string): Dimension {
  return letter.toLowerCase() as Dimension;
}

export function plainDepth(text: string): string {
  if (!text) return text;
  let out = text;

  // Shorthand that has its own meaning before digits are handled.
  out = out.replace(/\bK1-only\b/g, 'only mentioned, never practiced');
  out = out.replace(/\b([KUD])-(high|low)\b/g, (m) => HIGH_LOW[m] ?? m);
  out = out.replace(/\bK\/U\/D\b/g, 'knowing / reasoning / doing');

  // \u0000 marks "a score was just rewritten here" so a following "via X"
  // can become "(X assignment)"; stripped at the end.
  out = out.replace(COMBO_RE, (m) => {
    const scores: { k?: number; u?: number; d?: number } = {};
    for (const t of m.match(/[KUD][0-5]/g) ?? []) {
      scores[dimOf(t[0]!)] = Number(t[1]);
    }
    return plainScores(scores) + '\u0000';
  });
  out = out.replace(RANGE_RE, (_m, l: string, a: string, b: string) => {
    const dim = dimOf(l);
    return `${plainDepthPhrase(dim, Number(a))} or ${plainDepthPhrase(dim, Number(b))}\u0000`;
  });
  out = out.replace(EQUALS_RE, (_m, l: string, n: string) => plainDepthPhrase(dimOf(l), Number(n)) + '\u0000');
  out = out.replace(SINGLE_RE, (_m, l: string, n: string) => plainDepthPhrase(dimOf(l), Number(n)) + '\u0000');

  out = out.replace(VIA_RE, (_m, name: string) => viaClause(name));
  return out.replace(/\u0000/g, '');
}
