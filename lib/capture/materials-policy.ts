/**
 * Auto-set-aside rules. Pure logic, no I/O.
 *
 * Per the CourseCapture v2 spec (Phase A — Auto-set-aside policy), every
 * material is evaluated against a small ruleset that returns a recommended
 * inclusion decision. Faculty can override every decision with one click;
 * `auto_set_aside` records the policy's recommendation for audit purposes
 * while `ignored` is the operational flag the audit context loader reads.
 */

import { classifySource } from './material-compression';

export interface PolicyInput {
  fileName: string;
  extractedText: string | null;
  courseHasLearningObjectives: boolean;
}

export interface PolicyDecision {
  included: boolean;
  reason: string;                              // empty string when included
  ferpaRisk: 'low' | 'medium' | 'high';
  overridable: true;
}

const COMMA_ONLY = /^[,\s\n]+$/;

function looksLikeMalformedCsv(text: string | null): boolean {
  if (!text) return true;
  if (text.trim().length === 0) return true;
  if (COMMA_ONLY.test(text)) return true;
  const stripped = text.replace(/[,\s\n]/g, '');
  return stripped.length < 20;
}

/**
 * A course syllabus: the Canvas syllabus page, or a file whose name says
 * syllabus. Syllabi are public documents and the source of a course's stated
 * objectives (owner, 2026-10-05), so they are never set aside, neither as a
 * duplicate of the catalog nor for FERPA (instructor/TA emails trip that rule).
 */
export function isSyllabusFileName(fileName: string): boolean {
  return fileName === 'Canvas: Syllabus' || /syllab/i.test(fileName);
}

export function evaluateMaterialsPolicy(input: PolicyInput): PolicyDecision {
  const { fileName, extractedText } = input;

  // Canvas: Discussions is no longer set aside: student names in it are
  // privacy-scrubbed before storage (spec 2026-10-05).

  // xlsx/xls/xlsm: default to included. Auto-exclude only when the
  // filename matches gradebook-shaped patterns where the content is
  // almost certainly student data (FERPA-sensitive and not audit-relevant).
  // Faculty retain the manual `ignore` checkbox for course-specific calls.
  if (/^Canvas File:.*\.(xlsx?|xlsm)$/i.test(fileName)
      && /(?<![a-zA-Z])(gradebook|grades?|attendance|roster|scores?|enrolment|enrollment)(?![a-zA-Z])/i.test(fileName)) {
    return {
      included: false,
      reason: 'Filename looks like grades/roster data',
      ferpaRisk: 'high',
      overridable: true,
    };
  }

  if (looksLikeMalformedCsv(extractedText)) {
    return {
      included: false,
      reason: 'Empty or malformed import',
      ferpaRisk: 'low',
      overridable: true,
    };
  }

  return {
    included: true,
    reason: '',
    ferpaRisk: 'low',
    overridable: true,
  };
}

export { classifySource };
