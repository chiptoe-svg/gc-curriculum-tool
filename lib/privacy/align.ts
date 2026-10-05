import { STUDENT_NAME } from './types';

/**
 * Guard for the AI name pass (privacy-scrub spec 2026-10-05).
 *
 * The model returns a copy of the input with student names replaced by
 * [student]. We accept the copy only when, token by token, every difference
 * is a [student] standing in for 1–6 name tokens (capitalised words, plus
 * name joiners and particles). On success the redacted text is REBUILT FROM
 * THE INPUT, so the stored text keeps the input's exact whitespace and
 * characters and the model's own text is never stored.
 *
 * Failure reasons name token positions only, never material text, because
 * they are stored (course_materials.redactions.failedReason) and logged.
 */

// "[student]" first so an existing placeholder stays one token.
const TOKEN = /\[student\]|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
const MAX_NAME_TOKENS = 6;
const JOINERS = new Set(["'", '’', '-', '.']);
const PARTICLES = new Set(['de', 'del', 'della', 'der', 'di', 'da', 'du', 'la', 'le', 'van', 'von', 'bin', 'al']);
const CAPITALISED = /^\p{Lu}/u;

interface Tok { t: string; start: number; end: number }

function tokenize(s: string): Tok[] {
  return [...s.matchAll(TOKEN)].map(m => ({ t: m[0], start: m.index!, end: m.index! + m[0].length }));
}

/** Tokens [from, from+len) look like one person's name. */
function isNameSpan(toks: Tok[], from: number, len: number): boolean {
  if (!CAPITALISED.test(toks[from]!.t) || !CAPITALISED.test(toks[from + len - 1]!.t)) return false;
  for (let x = from; x < from + len; x++) {
    const t = toks[x]!.t;
    if (CAPITALISED.test(t) || JOINERS.has(t) || PARTICLES.has(t)) continue;
    return false;
  }
  return true;
}

export type AlignResult = { ok: true; text: string; names: number } | { ok: false; reason: string };

export function applyNameRedactions(input: string, output: string): AlignResult {
  const nonSpaceIn = input.replace(/\s+/g, '').length;
  const nonSpaceOut = output.replace(/\s+/g, '').length;
  if (Math.abs(nonSpaceOut - nonSpaceIn) > Math.max(50, nonSpaceIn * 0.2)) {
    return { ok: false, reason: `length changed beyond tolerance (${nonSpaceIn} -> ${nonSpaceOut} non-space chars)` };
  }

  const a = tokenize(input);
  const b = tokenize(output);
  const spans: Array<[number, number]> = [];
  let i = 0;
  for (let j = 0; j < b.length; j++) {
    const bt = b[j]!.t;
    if (bt === STUDENT_NAME && a[i]?.t !== STUDENT_NAME) {
      const next = b[j + 1]?.t;
      let taken = 0;
      for (let k = 1; k <= MAX_NAME_TOKENS && i + k <= a.length; k++) {
        if (!isNameSpan(a, i, k)) continue;
        const after = a[i + k]?.t;
        const fits = next === undefined ? i + k === a.length : next === STUDENT_NAME || after === next;
        if (fits) { taken = k; break; }
      }
      if (taken === 0) return { ok: false, reason: `placeholder at output token ${j} does not stand in for a name` };
      spans.push([a[i]!.start, a[i + taken - 1]!.end]);
      i += taken;
      continue;
    }
    if (a[i]?.t !== bt) return { ok: false, reason: `text changed at input token ${i}` };
    i++;
  }
  if (i !== a.length) return { ok: false, reason: `output stops early at input token ${i} of ${a.length}` };

  let text = '';
  let cursor = 0;
  for (const [s, e] of spans) {
    text += input.slice(cursor, s) + STUDENT_NAME;
    cursor = e;
  }
  text += input.slice(cursor);
  return { ok: true, text, names: spans.length };
}

/** Split on line boundaries into pieces of at most `maxChars`; `join('')` restores the text. */
export function splitForNamePass(text: string, maxChars = 6000): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split(/(?<=\n)/)) {
    for (let piece = line; piece.length > 0; piece = piece.slice(maxChars)) {
      const part = piece.slice(0, maxChars);
      if (current.length > 0 && current.length + part.length > maxChars) {
        chunks.push(current);
        current = '';
      }
      current += part;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
