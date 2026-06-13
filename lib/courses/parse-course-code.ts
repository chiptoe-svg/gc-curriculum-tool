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
