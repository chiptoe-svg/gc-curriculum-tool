import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { ModelGuideSchema, modelGuideJsonSchema, type ModelGuide, type ObjectiveGuide } from './schema';
import { parseCanvasAssignmentNames, type KnownNames } from './canvas-names';
import { findGuideProblems, finalizeGuide } from './check';

export interface GuideGenerationInput {
  courseCode: string;
  courseTitle: string;
  /** Usable syllabus materials only (never an ignored / set-aside one). */
  syllabi: Array<{ fileName: string; text: string }>;
  /** Usable `Canvas: Assignments` text, ignored items already removed. */
  assignmentsText: string;
  profile: CaptureProfile;
}

export interface GuideGenerationResult {
  guide: ObjectiveGuide;
  droppedNames: string[];
  model: string;
  costUsdCents: number;
  attempts: 1 | 2;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function buildGuideUserMessage(input: GuideGenerationInput, known: KnownNames): string {
  const syllabi = input.syllabi.map((s) => `### ${s.fileName}\n\n${s.text.trim()}`).join('\n\n');

  const validNames = known.assignments.length > 0
    ? known.assignments
        .map((a) => [`- ${a.name}`, ...a.rubricRows.map((r) => `  - rubric row: ${r}`)].join('\n'))
        .join('\n')
    : '(none)';

  const p = input.profile;
  const competencies = (p.competencies ?? []).map((c) => {
    const depth = c.type === 'foundational'
      ? `D${c.d_depth}`
      : `K${c.k_depth ?? '–'} U${c.u_depth ?? '–'} D${c.d_depth}`;
    const evidence = [c.evidence_k, c.evidence_u, c.evidence_d]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => `  evidence: ${clip(s.trim(), 300)}`);
    const cited = (c.citations ?? []).slice(0, 3).map((x) => `  cited: "${x.excerpt}"`);
    return [`- ${c.statement} (${depth})`, ...evidence, ...cited].join('\n');
  }).join('\n') || '(none)';

  const emphasis = (p.course_emphasis ?? [])
    .map((e) => `- ${e.competency}: ${e.points} pts (${e.share_pct}%)`)
    .join('\n') || '(none recorded)';
  const misalignments = (p.audit_notes?.objective_misalignments ?? []).map((s) => `- ${s}`).join('\n') || '(none)';
  const catalogVsEvidence = (p.verification_summary?.catalog_vs_evidence ?? []).map((s) => `- ${s}`).join('\n') || '(none)';

  return [
    `# Course: ${input.courseCode} ${input.courseTitle}`,
    '',
    '## Syllabus (the only source of the learning objectives)',
    '',
    syllabi,
    '',
    '## Canvas assignments',
    '',
    input.assignmentsText.trim(),
    '',
    '## Valid names (copy exactly; use no others)',
    '',
    validNames,
    '',
    '## What the review of the course found',
    '',
    '### Competencies students show',
    competencies,
    '',
    '### Graded points by competency',
    emphasis,
    '',
    '### Where the stated objectives and the evidence disagree',
    misalignments,
    '',
    '### Catalog claims against the evidence',
    catalogVsEvidence,
  ].join('\n');
}

export function buildRetryNote(problems: string[]): string {
  return [
    '## Corrections needed',
    '',
    'Your previous answer used names or objectives that are not in the inputs:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Answer again in full. Use only names from "Valid names", copied exactly, and quote each objective exactly as the syllabus words it.',
  ].join('\n');
}

/**
 * One structured call, then the deterministic check. Any miss gets exactly one
 * corrective retry; whatever is still unmatched is dropped by finalizeGuide and
 * returned as droppedNames. Spend is recorded per call.
 */
export async function generateObjectiveGuide(input: GuideGenerationInput): Promise<GuideGenerationResult> {
  const known = parseCanvasAssignmentNames(input.assignmentsText);
  const syllabusText = input.syllabi.map((s) => s.text).join('\n\n');
  const [provider, systemPrompt] = await Promise.all([
    getProviderForFunction('objective-evidence-guide'),
    loadPrompt('objective-evidence-guide'),
  ]);
  const baseMessage = buildGuideUserMessage(input, known);

  let costUsdCents = 0;
  const call = async (userMessage: string): Promise<ModelGuide> => {
    const res = await provider.complete<ModelGuide>({
      systemPrompt,
      userMessage,
      schemaName: 'objective_evidence_guide',
      jsonSchema: modelGuideJsonSchema as unknown as object,
      validate: (raw) => ModelGuideSchema.parse(raw),
    });
    costUsdCents += res.costUsdCents;
    await recordSpend(res.costUsdCents);
    return res.data;
  };

  let draft = await call(baseMessage);
  let attempts: 1 | 2 = 1;
  const problems = findGuideProblems(draft, known, syllabusText);
  if (problems.length > 0) {
    draft = await call(`${baseMessage}\n\n${buildRetryNote(problems)}`);
    attempts = 2;
  }

  const { guide, dropped } = finalizeGuide(draft, known, syllabusText);
  return { guide, droppedNames: dropped, model: provider.model, costUsdCents, attempts };
}
