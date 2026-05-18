import OpenAI from 'openai';
import type { AIProvider } from './provider';

// Per-model pricing in USD per 1M tokens. Update from
// https://developers.openai.com/api/docs/pricing when adding models.
// Cached input (prefix caching) is billed at 10% of input price by OpenAI,
// but we don't track cache hits separately yet — the estimate below is the
// upper bound (no cache).
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
  }): Promise<{ data: T; costUsdCents: number; durationMs: number }> {
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
    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((promptTokens / 1_000_000) * pricing.input) +
      toCents((completionTokens / 1_000_000) * pricing.output);

    return { data, costUsdCents, durationMs };
  }
}
