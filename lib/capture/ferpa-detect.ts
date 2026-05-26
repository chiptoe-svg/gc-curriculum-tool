/**
 * Regex-based FERPA risk detector. Conservative bias — false positives
 * are fine (override is one click); false negatives matter because a
 * missed student-name leak is harmful.
 *
 * Levels:
 *   low    — no signals matched
 *   medium — one "Submitted by" / "Posted by" style signal
 *   high   — gradebook columns, CUIDs, or multiple medium signals stacked
 */

export interface FerpaResult {
  level: 'low' | 'medium' | 'high';
  matches: Array<{ rule: string; sample: string }>;
}

const SUBMITTED_BY = /(?:^|\n)\s*Submitted by\s+[A-Z][a-z]+(?:\s+[A-Z][a-z\-']+)+/g;
const POSTED_BY = /(?:^|\n)\s*Posted by\s+[A-Z][a-z]+(?:\s+[A-Z][a-z\-']+)+\s+on\s+/g;
const CUID = /\bC\d{8}\b/g;
const GRADEBOOK = /(?:^|\n)\s*Name\s*\|\s*Grade\b/i;

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
  if (GRADEBOOK.test(text)) {
    matches.push({ rule: 'gradebook', sample: 'Name | Grade table detected' });
  }

  const hasHighSignal = matches.some(m => m.rule === 'cuid' || m.rule === 'gradebook');
  const mediumCount = matches.filter(m => m.rule === 'submitted-by' || m.rule === 'posted-by').length;

  let level: 'low' | 'medium' | 'high' = 'low';
  if (hasHighSignal || mediumCount >= 2) level = 'high';
  else if (mediumCount >= 1) level = 'medium';

  return { level, matches };
}
