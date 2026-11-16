/** The labeled-pair dataset: one record per faculty decision (spec 2026-11-16 §2), as JSON Lines or CSV. */
import type { Decision } from '@/lib/db/match-queries';

export const EXPORT_FIELDS = [
  'required_text', 'supplied_text', 'required_course', 'required_course_title', 'supplied_course', 'supplied_course_title',
  'label', 'latest', 'draft', 'decided_by', 'decided_at', 'plan_id', 'source', 'judge_model', 'prompt_version',
  'judge_p_fully', 'judge_p_partly',
] as const;

export type ExportRecord = Record<(typeof EXPORT_FIELDS)[number], string | number | boolean | null>;

/** `rows` is the full history; `latest` marks the decision that counts for its pair (newest non-draft; every draft counts as its own). */
export function toRecords(rows: Decision[]): ExportRecord[] {
  const newest = new Map<string, Decision>();
  for (const r of rows) {
    if (r.draft) continue;
    const k = `${r.requiredHash}|${r.suppliedHash}`;
    const prev = newest.get(k);
    if (!prev || r.decidedAt > prev.decidedAt || (r.decidedAt.getTime() === prev.decidedAt.getTime() && r.id > prev.id)) newest.set(k, r);
  }
  return rows.map((r) => ({
    required_text: r.requiredText, supplied_text: r.suppliedText,
    required_course: r.requiredCourse, required_course_title: r.requiredCourseTitle,
    supplied_course: r.suppliedCourse, supplied_course_title: r.suppliedCourseTitle,
    label: r.label,
    latest: r.draft || newest.get(`${r.requiredHash}|${r.suppliedHash}`)?.id === r.id,
    draft: r.draft, decided_by: r.decidedBy, decided_at: r.decidedAt.toISOString(), plan_id: r.planId, source: r.source,
    judge_model: r.judgeModel, prompt_version: r.promptVersion, judge_p_fully: r.judgePFully, judge_p_partly: r.judgePPartly,
  }));
}

export const toJsonl = (recs: ExportRecord[]): string => recs.map((r) => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : '');

const cell = (v: string | number | boolean | null): string => {
  if (v === null) return '';
  let s = String(v);
  // A spreadsheet reads a leading = + - @ (or tab / CR) as a formula; a leading quote makes it text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (recs: ExportRecord[]): string =>
  [EXPORT_FIELDS.join(','), ...recs.map((r) => EXPORT_FIELDS.map((f) => cell(r[f])).join(','))].join('\r\n') + '\r\n';
