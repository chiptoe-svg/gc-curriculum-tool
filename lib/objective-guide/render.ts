import type { GuideEvidence, GuideMeasure, ObjectiveGuide } from './schema';

export const MEASURE_LABEL: Record<GuideMeasure, string> = {
  clear: 'Clearly measured',
  partial: 'Partly measured',
  none: 'No graded measure yet',
};

export const CLASS_LEVEL_NOTE =
  "Report class-level numbers only, such as score distributions and the share of students at each level. Do not include any student's name or individual grade.";

export function formatEvidence(e: GuideEvidence): string {
  return e.rubric_row ? `${e.assignment}, rubric row "${e.rubric_row}"` : e.assignment;
}

/**
 * The plain-text guide: what the Copy-as-text button copies and what a faculty
 * member can hand, unchanged, to a Canvas-connected agent. It must read as
 * ordinary instructions to a person, not as an AI prompt.
 */
export function renderGuideText(guide: ObjectiveGuide, course: { code: string; title: string }): string {
  const lines: string[] = [
    `Assessing the course objectives: ${course.code} ${course.title}`,
    '',
    guide.intro.trim(),
    '',
  ];
  if (guide.objectives.length === 0) {
    lines.push('No learning objectives could be quoted from the syllabus.', '');
  }
  guide.objectives.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.objective}`);
    lines.push(`   How it is measured now: ${MEASURE_LABEL[o.measure]}`);
    lines.push(`   Where the evidence is: ${o.evidence.length > 0 ? o.evidence.map(formatEvidence).join('; ') : 'no graded item yet'}`);
    lines.push(`   What to gather: ${o.gather.trim()}`);
    if (o.suggestion) lines.push(`   Smallest change that would help: ${o.suggestion.trim()}`);
    lines.push('');
  });
  if (guide.checklist.length > 0) {
    lines.push('Items to pull from Canvas at the end of the semester:');
    for (const c of guide.checklist) lines.push(`- ${formatEvidence(c)}`);
    lines.push('');
  }
  lines.push(CLASS_LEVEL_NOTE);
  return lines.join('\n');
}

function formatCanvasPullItem(e: GuideEvidence): string {
  return e.rubric_row ? `${e.assignment} (rubric row: ${e.rubric_row})` : `${e.assignment} (assignment score)`;
}

/**
 * Deterministic (no AI call) prompt built from the stored guide, for a
 * faculty member to paste into a Canvas-connected AI agent. "[term]" is a
 * literal placeholder left for the instructor to fill in — it is not
 * substituted here. Unlike renderGuideText, this never carries guide.intro
 * or guide.checklist; it is addressed to the AI agent, not the instructor.
 */
export function renderGuideCanvasPrompt(guide: ObjectiveGuide, course: { code: string; title: string }): string {
  const lines: string[] = [
    `You have access to my Canvas course "${course.code} ${course.title}" for the [term] semester. ` +
      'Produce an objective-attainment report using class-level data only. ' +
      'Never include student names, IDs, or individual scores.',
    '',
    'Method: for each objective below, pull the listed items and compute the number of students with a score, ' +
      'the class mean, the median, and the score distribution — by rubric rating level where a rubric row is named, ' +
      'otherwise in 10% bands — and the share of students at or above 80% (or "Proficient" or higher where a rubric row ' +
      'is named). Judge the objective MET if at least 70% of students are at or above that level, PARTLY MET if 50-69%, ' +
      'and NOT MET if below 50%.',
    '',
  ];

  guide.objectives.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.objective}`);
    if (o.evidence.length > 0) {
      lines.push('Pull:');
      for (const e of o.evidence) lines.push(`- ${formatCanvasPullItem(e)}`);
    }
    if (o.measure === 'partial') {
      lines.push(`Note: ${o.gather.trim()}`);
    }
    if (o.measure === 'none') {
      let line = 'No graded evidence yet — report "no graded evidence" for this objective and do not estimate.';
      if (o.suggestion) line += ` Suggested fix: ${o.suggestion.trim()}`;
      lines.push(line);
    }
    lines.push('');
  });

  lines.push(
    'Output: one table (objective | items used | n | mean | % at or above level | judgment), then one sentence per ' +
      'objective on what the evidence shows, then a list of anything not found in Canvas (instead of guessing).'
  );

  return lines.join('\n');
}
