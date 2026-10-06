/**
 * Parser for the Clemson catalog's prerequisite / corequisite prose (the
 * clemson-advising project's `course.prereq_text` / `coreq_text`). Its
 * `prereq_parsed` column is a flat code list that drops "or" groups and the
 * "Preq or concurrent enrollment:" distinction, so we parse the text.
 *
 * Grammar handled (what the GC-relevant catalog rows actually use):
 *   main clause [". Preq or concurrent enrollment: " clause] [". Preq: " clause]
 *   clause      = part (";" | " and ") part ...
 *   part        = ["either "] alternative (" or " alternative)*
 * Non-course conditions ("Graphic Communications major", "Junior standing",
 * "consent of instructor") become notes, never edges. A course alternative
 * inside an "or" group carries that group's number; a group that also allows
 * a non-course alternative gets a "one of: …" note so readers know the course
 * is not strictly required.
 */
export type CatalogEdgeKind = 'prereq' | 'concurrent_ok' | 'coreq';

export interface CatalogEdge {
  code: string;
  kind: CatalogEdgeKind;
  /** null = required on its own; same number = any one of these satisfies. */
  anyOfGroup: number | null;
}

export interface ParsedCatalogPrereqs {
  edges: CatalogEdge[];
  notes: string[];
}

const CODE_RE = /\b([A-Z]{2,4})\s*(\d{4})\b/g;
const SEGMENT_RE = /(?:^|\.)\s*(Preq or concurrent enrollment|Preq)\s*:\s*/gi;
// "C or better", "620 or higher": a grade/score qualifier, not an alternative.
const QUALIFIER_RE = /(\S+)\s+or\s+(better|higher|above)\b/gi;
const QUALIFIER_MARK = '\u0000';

function codesIn(s: string): string[] {
  return [...s.matchAll(CODE_RE)].map(m => `${m[1]} ${m[2]}`);
}

function clean(s: string): string {
  return s
    .replace(/^\s*(?:and|either)\s+/i, '')
    .replace(/[.;,\s]+$/, '')
    .trim();
}

function splitSegments(text: string): Array<{ kind: 'prereq' | 'concurrent_ok'; body: string }> {
  const out: Array<{ kind: 'prereq' | 'concurrent_ok'; body: string }> = [];
  let kind: 'prereq' | 'concurrent_ok' = 'prereq';
  let last = 0;
  for (const m of text.matchAll(SEGMENT_RE)) {
    out.push({ kind, body: text.slice(last, m.index) });
    kind = /concurrent/i.test(m[1]!) ? 'concurrent_ok' : 'prereq';
    last = m.index! + m[0].length;
  }
  out.push({ kind, body: text.slice(last) });
  return out.filter(s => s.body.trim().length > 0);
}

/** Undo the qualifier protection for human-readable notes. */
function restore(s: string): string {
  return s.replaceAll(QUALIFIER_MARK, ' or ');
}

export function parseCatalogPrereqs(text: string | null | undefined): ParsedCatalogPrereqs {
  const edges: CatalogEdge[] = [];
  const notes: string[] = [];
  if (!text || !text.trim()) return { edges, notes };
  let group = 0;

  const add = (code: string, kind: 'prereq' | 'concurrent_ok', anyOfGroup: number | null) => {
    const existing = edges.find(e => e.code === code);
    if (!existing) { edges.push({ code, kind, anyOfGroup }); return; }
    // Stricter wins: a plain prerequisite beats "before or alongside", and a
    // standalone requirement beats membership in an any-of group.
    if (existing.kind === 'concurrent_ok' && kind === 'prereq') existing.kind = 'prereq';
    if (existing.anyOfGroup !== null && anyOfGroup === null) existing.anyOfGroup = null;
  };

  for (const seg of splitSegments(text)) {
    const body = seg.body.replace(QUALIFIER_RE, `$1${QUALIFIER_MARK}$2`);
    const parts = body
      .split(';')
      .flatMap(p => clean(p).split(/\s+and\s+/i))
      .map(clean)
      .filter(Boolean);
    for (const part of parts) {
      const alternatives = part.split(/\s*,?\s+or\s+/i).map(clean).filter(Boolean);
      if (alternatives.length <= 1) {
        const codes = codesIn(part);
        if (codes.length === 0) notes.push(restore(part));
        for (const c of codes) add(c, seg.kind, null);
        continue;
      }
      const withCodes = alternatives.map(a => ({ a, codes: codesIn(a) }));
      if (withCodes.every(x => x.codes.length === 0)) { notes.push(restore(part)); continue; }
      group += 1;
      for (const x of withCodes) for (const c of x.codes) add(c, seg.kind, group);
      if (withCodes.some(x => x.codes.length === 0)) notes.push(`one of: ${restore(part)}`);
    }
  }
  return { edges, notes };
}

export function parseCatalogCoreqs(text: string | null | undefined): CatalogEdge[] {
  if (!text) return [];
  return [...new Set(codesIn(text))].map(code => ({ code, kind: 'coreq' as const, anyOfGroup: null }));
}
