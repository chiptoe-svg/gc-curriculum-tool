import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { analysisFindingSchema, analysisFindingJsonSchema, type AnalysisFinding } from './schema';
import type { CallTelemetry } from '@/lib/ai/analyze/accum';

export interface CourseContext {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
}

export interface AnalyzeMaterialArgs {
  courseContext: CourseContext;
  fileName: string;
  extractedText: string;
}

export async function analyzeMaterial({
  courseContext,
  fileName,
  extractedText,
}: AnalyzeMaterialArgs): Promise<{ data: AnalysisFinding; telemetry: CallTelemetry }> {
  const systemPrompt = await loadPrompt('analyze-material');
  const provider = getProvider();

  const userMessage = [
    `# Course context`,
    `Code: ${courseContext.code}`,
    `Title: ${courseContext.title}`,
    `Level: ${courseContext.level}`,
    `Track: ${courseContext.track}`,
    `Catalog description: ${courseContext.description}`,
    ``,
    `# File name`,
    fileName,
    ``,
    `# Extracted text`,
    extractedText,
  ].join('\n');

  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'analysis_finding',
    jsonSchema: analysisFindingJsonSchema,
    validate: (raw) => analysisFindingSchema.parse(raw),
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
