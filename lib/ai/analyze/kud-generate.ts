import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { courseKudResultSchema, courseKudResultJsonSchema } from '@/lib/ai/schemas';
import type { CourseKudResult } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface GenerateCourseKudArgs {
  title: string;
  description: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
  notes?: string;
  conversationContext?: string;
}

function formatInput(args: GenerateCourseKudArgs): string {
  const objLines = args.learningObjectives.length > 0
    ? args.learningObjectives.map((o, i) => `${i + 1}. ${o}`)
    : ['(none)'];
  const projLines = args.majorProjects.length > 0
    ? args.majorProjects.map((p, i) => `${i + 1}. ${p}`)
    : ['(none — KUD draft will rely on catalog description only)'];
  const skillLines = args.skillsRequired.length > 0
    ? args.skillsRequired.map((s, i) => `${i + 1}. ${s}`)
    : ['(none)'];

  const parts = [
    `**Course:** ${args.title}`,
    `**Description:** ${args.description || '(none)'}`,
    '',
    '**Learning objectives:**',
    ...objLines,
    '',
    '**Major projects (highest-stakes first):**',
    ...projLines,
    '',
    '**Required incoming skills:**',
    ...skillLines,
  ];

  if (args.notes?.trim()) {
    parts.push('', '**Instructor guidance for this run:**', args.notes.trim());
  }

  if (args.conversationContext?.trim()) {
    parts.push('', '**Conversation with instructor (use this to inform KUD generation):**', args.conversationContext.trim());
  }

  return parts.join('\n');
}

export async function generateCourseKud(args: GenerateCourseKudArgs): Promise<{
  data: CourseKudResult;
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('extract-course-kud');
  const provider = getProvider();
  const result = await provider.complete({
    systemPrompt,
    userMessage: formatInput(args),
    schemaName: 'course_kud_result',
    jsonSchema: courseKudResultJsonSchema,
    validate: (raw) => courseKudResultSchema.parse(raw),
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
