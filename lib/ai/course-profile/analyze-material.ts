import { getProviderForFunction } from '@/lib/ai/provider';
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
  /** Raw file bytes. When present (Anthropic provider), sent as a native document block
   *  instead of pasting extractedText into the user message. */
  documentBytes?: Buffer;
  documentMimeType?: string;
}

export async function analyzeMaterial({
  courseContext,
  fileName,
  extractedText,
  documentBytes,
  documentMimeType,
}: AnalyzeMaterialArgs): Promise<{ data: AnalysisFinding; telemetry: CallTelemetry }> {
  const systemPrompt = await loadPrompt('analyze-material');
  const provider = await getProviderForFunction('materials-analysis');

  const useNativeDoc = documentBytes !== undefined && documentBytes.length > 0 && !!documentMimeType;

  const contextLines = [
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
  ];

  const userMessage = useNativeDoc
    ? [...contextLines, `# Document`, `The full document is attached. Please analyze its content directly.`].join('\n')
    : [...contextLines, `# Extracted text`, extractedText].join('\n');

  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'analysis_finding',
    jsonSchema: analysisFindingJsonSchema,
    validate: (raw) => analysisFindingSchema.parse(raw),
    ...(useNativeDoc
      ? { documents: [{ bytes: documentBytes as Buffer, mimeType: documentMimeType as string }] }
      : {}),
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
