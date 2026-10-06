/**
 * Course codes named in a course sheet "prerequisites" line. Shared by the
 * scores + stress-test routes and the sheet prerequisite map
 * (lib/curriculum/sheet-prereq-graph.ts). GC codes only (the sheet's own
 * vocabulary); the Clemson catalog is the planned authoritative source.
 */
const COURSE_CODE_RE = /GC\s+\d{4}[a-z]{0,2}/gi;

export function extractPrereqCodes(prerequisites: string, selfCode: string): string[] {
  const codes = (prerequisites.match(COURSE_CODE_RE) ?? [])
    .map(c => c.replace(/\s+/, ' ').toUpperCase().replace(/GC (\d)/, 'GC $1'));
  return Array.from(new Set(codes)).filter(c => c !== selfCode);
}
