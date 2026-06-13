/**
 * Decompose a course code into structured identity. The `code` string
 * ("GC 4900ap") stays the canonical PK; these parts drive display, sort,
 * and the add-flow. Spec: docs/superpowers/specs/2026-06-13-structured-course-identity-and-bundling-design.md
 */
export interface ParsedCode {
  prefix: string;
  number: number | null; // integer; null only when no digit group is present
  suffix: string;
}

const CODE_RE = /^\s*([A-Za-z]+)\s*(\d+)\s*([A-Za-z]*)\s*$/;

export function parseCourseCode(code: string): ParsedCode {
  const m = CODE_RE.exec(code ?? '');
  if (!m) return { prefix: '', number: null, suffix: '' };
  return {
    prefix: m[1]!.toUpperCase(),
    number: parseInt(m[2]!, 10),
    suffix: (m[3] ?? '').toLowerCase(),
  };
}

/** Inverse of parseCourseCode: "GC" + 4900 + "ap" → "GC 4900ap". Empty when number is null. */
export function composeCourseCode(p: ParsedCode): string {
  if (p.number === null) return '';
  return `${p.prefix} ${p.number}${p.suffix}`;
}

/**
 * Display label for a (possibly bundled) course. No paired codes → the bare
 * code. Paired codes sharing the prefix collapse to "GC 3460/3461"; differing
 * prefixes join with " + ". Spec 2026-06-13.
 *
 * Pure function — no db import. Client components import from here directly.
 */
export function formatCourseLabel(
  code: string,
  pairedCodes: ReadonlyArray<{ pairedCode: string }>,
): string {
  if (pairedCodes.length === 0) return code;
  const base = parseCourseCode(code);
  const parsed = pairedCodes.map(p => ({ raw: p.pairedCode, pc: parseCourseCode(p.pairedCode) }));
  const sameAll = base.number !== null && parsed.every(p => p.pc.prefix === base.prefix && p.pc.number !== null);
  if (sameAll) {
    // shared prefix → collapse to "GC 3460/3461[/...]"
    return `${code}/${parsed.map(p => `${p.pc.number}${p.pc.suffix}`).join('/')}`;
  }
  // any differing prefix → join full codes so no prefix is ever dropped
  return `${code} + ${parsed.map(p => p.raw).join(' + ')}`;
}
