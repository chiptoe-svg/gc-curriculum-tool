import type { SalaryDistribution } from './queries';

export interface TargetInput {
  id: string;
  name: string;
  shortDefinition: string;
  knowDescriptors: string[];
  understandDescriptors: string[];
  doDescriptors: string[];
}

export interface SubmissionInput {
  partnerId: string;
  firstName: string;
  lastName: string;
  company: string;
  weight: number;
  positionTitle: string;
  responsibilities: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  interviewQuestions: string[];
  additionalNotes: string;
  salaryRangeLow: number | null;
  salaryRangeHigh: number | null;
  salaryCurrency: string;
}

export interface BuildArgs {
  target: TargetInput;
  submissions: SubmissionInput[];
  salaryDistribution: SalaryDistribution;
}

function numberedList(items: string[]): string {
  if (items.length === 0) return '(none currently)';
  return items.map((it, i) => `  [${i}] ${it}`).join('\n');
}

function formatSubmission(s: SubmissionInput, idx: number): string {
  const parts: string[] = [];
  parts.push(`### Submission ${idx + 1} — partnerId: ${s.partnerId}`);
  parts.push(`Partner: ${s.firstName} ${s.lastName} (${s.company}, weight: ${s.weight})`);
  parts.push(`Position title: ${s.positionTitle}`);
  if (s.responsibilities.trim()) parts.push(`Responsibilities: ${s.responsibilities.trim()}`);
  if (s.requiredSkills.length > 0) parts.push(`Required skills: ${s.requiredSkills.join(', ')}`);
  if (s.niceToHaveSkills.length > 0) parts.push(`Nice-to-have skills: ${s.niceToHaveSkills.join(', ')}`);
  if (s.interviewQuestions.length > 0) {
    parts.push(`Interview questions:\n${s.interviewQuestions.map(q => `  - ${q}`).join('\n')}`);
  }
  if (s.additionalNotes.trim()) parts.push(`Additional notes: ${s.additionalNotes.trim()}`);
  if (s.salaryRangeLow != null || s.salaryRangeHigh != null) {
    const lo = s.salaryRangeLow ?? '—';
    const hi = s.salaryRangeHigh ?? '—';
    parts.push(`Salary range: ${lo}–${hi} ${s.salaryCurrency}`);
  }
  return parts.join('\n');
}

export function buildSynthesisUserMessage({ target, submissions, salaryDistribution }: BuildArgs): string {
  return [
    `# Career target`,
    ``,
    `id: ${target.id}`,
    `name: ${target.name}`,
    `definition: ${target.shortDefinition}`,
    ``,
    `## Current descriptors`,
    ``,
    `Know:\n${numberedList(target.knowDescriptors)}`,
    ``,
    `Understand:\n${numberedList(target.understandDescriptors)}`,
    ``,
    `Do:\n${numberedList(target.doDescriptors)}`,
    ``,
    `# Salary distribution (pre-computed — pass through unchanged)`,
    ``,
    '```json',
    JSON.stringify(salaryDistribution, null, 2),
    '```',
    ``,
    `# Partner submissions (${submissions.length})`,
    ``,
    submissions.map(formatSubmission).join('\n\n'),
  ].join('\n');
}
