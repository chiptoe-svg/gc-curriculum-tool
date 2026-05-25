import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import {
  courseProfileResultSchema,
  courseProfileResultJsonSchema,
  type CourseProfileResult,
  type AnalysisFinding,
} from './schema';
import type { CallTelemetry } from '@/lib/ai/analyze/accum';

export interface SynthesisCourse {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  learningObjectives: string[];
  skillsRequired: string[];
}

export interface FindingWithFileName {
  fileName: string;
  finding: AnalysisFinding;
}

export interface SynthesizeCourseProfileArgs {
  course: SynthesisCourse;
  findings: FindingWithFileName[];
}

function formatFinding(f: FindingWithFileName, idx: number): string {
  const parts: string[] = [
    `### Material ${idx + 1}: ${f.fileName} (${f.finding.materialType})`,
  ];
  if (f.finding.competencies.length > 0) {
    parts.push('Competencies evidenced:');
    for (const c of f.finding.competencies) {
      parts.push(`- ${c.name}: ${c.description}`);
      for (const q of c.evidenceQuotes) {
        parts.push(`  Quote: "${q}"`);
      }
    }
  }
  if (f.finding.skills.length > 0) {
    parts.push(`Skills: ${f.finding.skills.join(', ')}`);
  }
  if (f.finding.notes.trim()) {
    parts.push(`Notes: ${f.finding.notes.trim()}`);
  }
  return parts.join('\n');
}

export async function synthesizeCourseProfile({
  course,
  findings,
}: SynthesizeCourseProfileArgs): Promise<{ data: CourseProfileResult; telemetry: CallTelemetry }> {
  const systemPrompt = await loadPrompt('synthesize-course-profile');
  const provider = await getProviderForFunction('materials-analysis');

  const userMessage = [
    `# Course context`,
    `Code: ${course.code}`,
    `Title: ${course.title}`,
    `Level: ${course.level}`,
    `Track: ${course.track}`,
    `Catalog description: ${course.description}`,
    ``,
    `Catalog learning objectives:`,
    course.learningObjectives.length > 0
      ? course.learningObjectives.map((o) => `- ${o}`).join('\n')
      : '(none)',
    ``,
    `Catalog skills required:`,
    course.skillsRequired.length > 0
      ? course.skillsRequired.map((s) => `- ${s}`).join('\n')
      : '(none)',
    ``,
    `# Per-file analysis findings (${findings.length} file${findings.length === 1 ? '' : 's'})`,
    ``,
    findings.map(formatFinding).join('\n\n'),
  ].join('\n');

  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'course_profile_result',
    jsonSchema: courseProfileResultJsonSchema,
    validate: (raw) => courseProfileResultSchema.parse(raw),
  });

  return {
    data: result.data,
    telemetry: {
      costUsdCents: result.costUsdCents,
      cachedTokens: result.cachedTokens,
      uncachedPromptTokens: result.uncachedPromptTokens,
      completionTokens: result.completionTokens,
    },
  };
}
