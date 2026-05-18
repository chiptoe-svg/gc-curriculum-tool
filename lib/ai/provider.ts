export interface CompletionTelemetry {
  costUsdCents: number;
  durationMs: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
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
}

import { OpenAIProvider } from './openai';

export function getProvider(): AIProvider {
  const which = process.env.AI_PROVIDER ?? 'openai';
  if (which === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    return new OpenAIProvider(process.env.OPENAI_MODEL ?? 'gpt-4o', key);
  }
  throw new Error(`Unknown AI provider: ${which}`);
}
