import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { coursePrereqsSchema, coursePrereqsJsonSchema } from '@/lib/ai/schemas';
import type { CoursePrereqCompetency, KUDOutcomes } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface ExtractPrereqsArgs {
  syllabusText: string;
  courseKud: KUDOutcomes;
}

export async function extractCoursePrereqs({ syllabusText, courseKud }: ExtractPrereqsArgs): Promise<{
  data: CoursePrereqCompetency[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('extract-course-prereqs');
  const provider = getProvider();
  const userMessage = [
    'Focal course KUD outcomes:',
    `Description: ${courseKud.description}`,
    `Know: ${courseKud.know.join('; ')}`,
    `Understand: ${courseKud.understand.join('; ')}`,
    `Do: ${courseKud.do.join('; ')}`,
    '',
    'Syllabus text:',
    syllabusText,
  ].join('\n');
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'course_prereqs',
    jsonSchema: coursePrereqsJsonSchema,
    validate: (raw) => coursePrereqsSchema.parse((raw as { prereqs: unknown }).prereqs),
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
