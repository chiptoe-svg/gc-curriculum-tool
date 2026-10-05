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
