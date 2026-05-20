import OpenAI from 'openai';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';

// Per-model pricing in USD per 1M tokens. Update from
// https://developers.openai.com/api/docs/pricing when adding models.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.5': { input: 5.0, output: 30.0 },
  'gpt-5.4': { input: 2.5, output: 15.0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  // Legacy fallbacks if these names still resolve on the API:
  'gpt-4.1': { input: 2.5, output: 10.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
};

const FALLBACK_PRICING = { input: 2.5, output: 15.0 };  // assume workhorse

function toCents(usd: number): number {
  return Math.ceil(usd * 100 * 100); // 1/100 of a cent
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly model: string;
  private client: OpenAI;

  constructor(model: string, apiKey: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey });
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
  }): Promise<{ data: T } & CompletionTelemetry> {
    const started = Date.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: args.userMessage },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: args.schemaName,
          schema: args.jsonSchema as Record<string, unknown>,
          strict: true,
        },
      },
      temperature: 0.2,
    });
    const durationMs = Date.now() - started;

    const content = response.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`OpenAI returned non-JSON content: ${content.slice(0, 200)}`);
    }
    const data = args.validate(parsed);

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    // OpenAI reports prefix-cache hits in prompt_tokens_details.cached_tokens.
    // The SDK types may not always include this field depending on SDK version,
    // so we use a narrow cast to access it safely.
    const cachedTokens =
      (response.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)
        ?.prompt_tokens_details?.cached_tokens ?? 0;
    const uncachedPromptTokens = Math.max(0, promptTokens - cachedTokens);
    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((uncachedPromptTokens / 1_000_000) * pricing.input) +
      toCents((cachedTokens / 1_000_000) * pricing.input * 0.1) +
      toCents((completionTokens / 1_000_000) * pricing.output);

    return { data, costUsdCents, durationMs, cachedTokens, uncachedPromptTokens, completionTokens };
  }

  async transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    const { fileBytes, maxPages = 40 } = args;
    const base64 = fileBytes.toString('base64');
    const dataUrl = `data:${args.mimeType};base64,${base64}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Please transcribe every piece of text visible in this document. Return plain text only, preserving the reading order. Do not add commentary. If pages are cut off, transcribe what is visible.`,
            },
            {
              type: 'file',
              file: {
                filename: 'document.pdf',
                file_data: dataUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const cachedTokens =
      (response.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)
        ?.prompt_tokens_details?.cached_tokens ?? 0;
    const uncachedPromptTokens = Math.max(0, promptTokens - cachedTokens);
    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((uncachedPromptTokens / 1_000_000) * pricing.input) +
      toCents((cachedTokens / 1_000_000) * pricing.input * 0.1) +
      toCents((completionTokens / 1_000_000) * pricing.output);

    const estimatedPages = Math.ceil(fileBytes.length / 75_000);
    const truncated = estimatedPages > maxPages;

    return { text, costUsdCents, truncated };
  }
}
