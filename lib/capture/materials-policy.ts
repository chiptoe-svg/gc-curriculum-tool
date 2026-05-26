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

export function evaluateMaterialsPolicy(input: PolicyInput): PolicyDecision {
  const { fileName, extractedText, courseHasLearningObjectives } = input;

  if (fileName === 'Canvas: Syllabus' && courseHasLearningObjectives) {
    return {
      included: false,
      reason: 'Sheets has LOs — Canvas syllabus duplicates them',
      ferpaRisk: 'low',
      overridable: true,
    };
  }

  if (fileName === 'Canvas: Discussions') {
    return {
      included: false,
      reason: 'Contains student posts',
      ferpaRisk: 'high',
      overridable: true,
    };
  }

  if (/^Canvas File:.*\.(xlsx?|xlsm)$/i.test(fileName)) {
    return {
      included: false,
      reason: 'Spreadsheet — usually data, not audit material',
      ferpaRisk: 'low',
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
