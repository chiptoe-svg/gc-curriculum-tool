/**
 * Fraction of non-empty lines that are DEGENERATE repeats — the signature of
 * the small-VLM repetition trap (a line identical to its immediate predecessor,
 * or a line that is only a junk token). Range 0..1. Pure. Clean docs ≈ 0.0;
 * the handwritten-scan repetition trap ≈ 0.9.
 */
const JUNK_LINE = /^[·.\-*•]+$/; // a line that is only bullet/dot/dash junk

export function repetitionRatio(markdown: string): number {
  const lines = markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return 0;
  let degenerate = 0;
  let prev: string | null = null;
  for (const line of lines) {
    if (JUNK_LINE.test(line) || (prev !== null && line === prev)) degenerate++;
    prev = line;
  }
  return degenerate / lines.length;
}
