export interface CompletionTelemetry {
  costUsdCents: number;
  durationMs: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
}

export interface TranscribeDocumentArgs {
  fileBytes: Buffer;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  /** Max pages to transcribe. Default: 40. */
  maxPages?: number;
}

export interface TranscribeDocumentResult {
  text: string;
  costUsdCents: number;
  /** True when the file exceeded maxPages and was truncated. */
  truncated: boolean;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;

  /**
   * Call the model with a system prompt and a user message.
   * Validates the response against the supplied JSON schema (provider-side validation
   * via response_format when the provider supports it; client-side validation always).
   * Returns the parsed object plus token/cost telemetry.
   */
  complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;            // for OpenAI structured outputs naming
    jsonSchema: object;
    validate: (raw: unknown) => T; // typically the Zod schema's parse
  }): Promise<{ data: T } & CompletionTelemetry>;

  /**
   * Send raw file bytes to a vision-capable model and return transcribed text.
   * Used only for image-based PDFs that yield too little text from pdf-parse.
   * Cost is NOT recorded here — caller is responsible for checkDailyCap + recordSpend.
   */
  transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult>;
}

import { OpenAIProvider } from './openai';

export function getProvider(): AIProvider {
  // Trim every env var defensively — Vercel sometimes preserves trailing
  // newlines from pasted values, and OpenAI rejects an API key with CR/LF.
  const which = process.env.AI_PROVIDER?.trim() || 'openai';
  if (which === 'openai') {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY not set');
    return new OpenAIProvider(process.env.OPENAI_MODEL?.trim() || 'gpt-5.4', key);
  }
  throw new Error(`Unknown AI provider: ${which}`);
}
