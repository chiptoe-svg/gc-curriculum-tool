import { STUDENT_NAME } from './types';

/**
 * AI name pass helpers (privacy-scrub spec 2026-10-05, name-list redesign).
 *
 * The model only LISTS the student names it sees; the code replaces them in
 * the original text. Nothing but whole-word, case-sensitive occurrences of an
 * accepted name can change, so the model can never alter, drop or invent any
 * other part of the stored text.
 *
 * These helpers return counts only; callers must never log or store the
 * names themselves.
 */

const MAX_NAME_TOKENS = 6;
const CAPITALISED = /^\p{Lu}/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word: not preceded or followed by a letter or digit. A match also
 * takes in capitalised parts hyphen-joined to it, so listing "Mary" (or
 * "Jane") redacts all of "Mary-Jane" instead of leaving half the name
 * (review finding 2026-10-05). Lowercase hyphen parts ("Jane-designed") are
 * not taken.
 */
const HYPHEN_PART = '\\p{Lu}[\\p{L}\\p{N}]*';
function wholeWord(source: string): string {
  return `(?<![\\p{L}\\p{N}])(?:${HYPHEN_PART}-)*(?:${source})(?:-${HYPHEN_PART})*(?![\\p{L}\\p{N}])`;
}

/**
 * Keep the model's names that look like a name and occur, whole-word and
 * verbatim, in the chunk the model was shown. Everything else is ignored and
 * only counted.
 */
export function acceptNames(chunk: string, names: string[]): { accepted: string[]; ignored: number } {
  const accepted: string[] = [];
  let ignored = 0;
  for (const raw of names) {
    // Trailing punctuation ("Jane." at a sentence end) is not part of the name.
    const name = raw.trim().replace(/[^\p{L}\p{N}]+$/u, '');
    if (accepted.includes(name)) continue;
    const tokens = name.split(/\s+/).filter(Boolean).length;
    const ok = name.length > 0
      && CAPITALISED.test(name)
      && !/[\r\n]/.test(name)
      && tokens >= 1 && tokens <= MAX_NAME_TOKENS
      && new RegExp(wholeWord(escapeRegExp(name)), 'u').test(chunk);
    if (ok) accepted.push(name);
    else ignored++;
  }
  return { accepted, ignored };
}

/**
 * Replace every whole-word, case-sensitive occurrence of each name with
 * [student], longest name first ("Jane Doe" before "Jane"). One left-to-right
 * pass, so a placeholder is never matched again. A possessive keeps its
 * ending: "Jane's" -> "[student]'s".
 */
export function redactNames(text: string, names: string[]): string {
  if (names.length === 0) return text;
  const alternation = [...new Set(names)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return text.replace(new RegExp(wholeWord(alternation), 'gu'), STUDENT_NAME);
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
