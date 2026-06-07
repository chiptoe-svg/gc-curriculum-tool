/**
 * Regex-based FERPA risk detector. Conservative bias — false positives
 * are fine (override is one click); false negatives matter because a
 * missed student-name leak is harmful.
 *
 * Levels:
 *   low    — no signals matched
 *   medium — one "Submitted by" / "Posted by" name, or a roster-shaped
 *            table of person names
 *   high   — gradebook columns, CUIDs, multiple student emails, or
 *            multiple medium signals stacked
 *
 * The gradebook signal matches any markdown table whose header carries a
 * name-ish column AND a grade-ish column (e.g. "Student | Score",
 * "First Name | Last Name | Final", "Last, First | Points") — not just the
 * literal "Name | Grade" — because Docling renders Canvas/Excel gradebooks
 * with varied headers.
 */

export interface FerpaResult {
  level: 'low' | 'medium' | 'high';
  matches: Array<{ rule: string; sample: string }>;
}

const SUBMITTED_BY = /(?:^|\n)\s*Submitted by\s+[A-Z][a-z]+(?:\s+[A-Z][a-z\-']+)+/g;
const POSTED_BY = /(?:^|\n)\s*Posted by\s+[A-Z][a-z]+(?:\s+[A-Z][a-z\-']+)+\s+on\s+/g;
const CUID = /\bC\d{8}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Header-cell signals for gradebook/roster table detection.
const NAME_HEADER = /\b(?:names?|students?|first|last)\b/i;
const GRADE_HEADER = /(?:\bgrades?\b|\bscores?\b|\bpoints?\b|\bmarks?\b|\bgpa\b|\bfinal\b|\btotals?\b|\baverages?\b|\bavg\b|\boverall\b|%)/i;
const FIRST_HEADER = /\bfirst\b/i;
const LAST_HEADER = /\blast\b/i;
// A table cell that looks like a person name: 2+ capitalized tokens, optionally
// "Last, First". Deliberately loose — a few false positives (e.g. a two-word
// course title) are acceptable per the conservative bias; this is the weakest
// signal and only contributes at the `medium` level.
const PERSON_NAME_CELL = /^[A-Z][a-z'’.-]+,?(?:\s+[A-Z][a-z'’.-]+)+$/;
const ROSTER_NAME_THRESHOLD = 4;

function tableLines(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

function looksLikeGradebookTable(rows: string[][]): boolean {
  return rows.some(cells => {
    const nameAndGrade = cells.some(c => NAME_HEADER.test(c)) && cells.some(c => GRADE_HEADER.test(c));
    // Split-name roster header ("First Name | Last Name | ...") is gradebook-shaped
    // even without an explicit grade column.
    const firstAndLast = cells.some(c => FIRST_HEADER.test(c)) && cells.some(c => LAST_HEADER.test(c));
    return nameAndGrade || firstAndLast;
  });
}

function countPersonNameCells(rows: string[][]): number {
  let count = 0;
  for (const cells of rows) {
    for (const c of cells) {
      if (PERSON_NAME_CELL.test(c)) count++;
    }
  }
  return count;
}

export function detectFerpaRisk(text: string | null | undefined): FerpaResult {
  if (!text) return { level: 'low', matches: [] };
  const matches: FerpaResult['matches'] = [];

  for (const m of text.matchAll(SUBMITTED_BY)) {
    matches.push({ rule: 'submitted-by', sample: m[0].trim().slice(0, 80) });
  }
  for (const m of text.matchAll(POSTED_BY)) {
    matches.push({ rule: 'posted-by', sample: m[0].trim().slice(0, 80) });
  }
  for (const m of text.matchAll(CUID)) {
    matches.push({ rule: 'cuid', sample: m[0] });
  }

  // Distinct emails. A single email is almost always the instructor's own
  // contact (not FERPA); two or more distinct addresses look like a roster.
  const emails = new Set<string>();
  for (const m of text.matchAll(EMAIL)) emails.add(m[0].toLowerCase());
  if (emails.size >= 2) {
    matches.push({ rule: 'emails', sample: `${emails.size} distinct email addresses` });
  }

  const rows = tableLines(text);
  if (looksLikeGradebookTable(rows)) {
    matches.push({ rule: 'gradebook', sample: 'name + grade table columns detected' });
  }
  const personNameCells = countPersonNameCells(rows);
  if (personNameCells >= ROSTER_NAME_THRESHOLD) {
    matches.push({ rule: 'roster-names', sample: `${personNameCells} person-name table cells` });
  }

  const hasHighSignal = matches.some(
    m => m.rule === 'cuid' || m.rule === 'gradebook' || m.rule === 'emails',
  );
  const mediumCount = matches.filter(
    m => m.rule === 'submitted-by' || m.rule === 'posted-by' || m.rule === 'roster-names',
  ).length;

  let level: 'low' | 'medium' | 'high' = 'low';
  if (hasHighSignal || mediumCount >= 2) level = 'high';
  else if (mediumCount >= 1) level = 'medium';

  return { level, matches };
}
