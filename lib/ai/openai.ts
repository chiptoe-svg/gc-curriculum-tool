import OpenAI from 'openai';
import type { AIProvider } from './provider';

// gpt-4o price per 1M tokens (as of 2026-05; tune later)
const PRICE_INPUT_PER_M_USD = 2.5;
const PRICE_OUTPUT_PER_M_USD = 10;

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
    const costUsdCents =
      toCents((promptTokens / 1_000_000) * PRICE_INPUT_PER_M_USD) +
      toCents((completionTokens / 1_000_000) * PRICE_OUTPUT_PER_M_USD);

    return { data, costUsdCents, durationMs };
  }
}
