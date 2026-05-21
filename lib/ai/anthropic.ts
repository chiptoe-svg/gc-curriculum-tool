import Anthropic from '@anthropic-ai/sdk';
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';

// USD per 1M tokens. Update from https://docs.anthropic.com/en/docs/about-claude/models
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':           { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6':         { input:  3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input:  0.80, output: 4.0 },
};
const FALLBACK_PRICING = { input: 3.0, output: 15.0 };

function toCents(usd: number): number {
  return Math.ceil(usd * 100 * 100);
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor(model: string, apiKey: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    documents?: Array<{ bytes: Buffer; mimeType: string }>;
  }): Promise<{ data: T } & CompletionTelemetry> {
    const started = Date.now();

    const userContent = args.documents?.length
      ? [
          ...args.documents.map((doc) => ({
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: doc.mimeType as 'application/pdf',
              data: doc.bytes.toString('base64'),
            },
          })),
          { type: 'text' as const, text: args.userMessage },
        ]
      : args.userMessage;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: [{ type: 'text', text: args.systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: args.schemaName,
          description: 'Extract structured data according to the schema.',
          input_schema: args.jsonSchema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: args.schemaName },
      messages: [{ role: 'user', content: userContent }],
    });

    const durationMs = Date.now() - started;

    const toolBlock = response.content.find((b): b is ToolUseBlock => b.type === 'tool_use');
    if (!toolBlock) throw new Error('No tool_use block in Anthropic response');

    const data = args.validate(toolBlock.input);

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const cacheReadTokens = (response.usage as { cache_read_input_tokens?: number } | undefined)
      ?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = (response.usage as { cache_creation_input_tokens?: number } | undefined)
      ?.cache_creation_input_tokens ?? 0;
    const uncachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);

    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((uncachedInputTokens / 1_000_000) * pricing.input) +
      toCents((cacheWriteTokens / 1_000_000) * pricing.input * 1.25) +
      toCents((cacheReadTokens / 1_000_000) * pricing.input * 0.1) +
      toCents((outputTokens / 1_000_000) * pricing.output);

    return {
      data,
      costUsdCents,
      durationMs,
      cachedTokens: cacheReadTokens,
      uncachedPromptTokens: uncachedInputTokens + cacheWriteTokens,
      completionTokens: outputTokens,
    };
  }

  async transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    const { fileBytes, mimeType } = args;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mimeType as 'application/pdf',
                data: fileBytes.toString('base64'),
              },
            },
            {
              type: 'text',
              text: 'Please transcribe every piece of text visible in this document. Return plain text only, preserving the reading order. Do not add commentary. If pages are cut off, transcribe what is visible.',
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((inputTokens / 1_000_000) * pricing.input) +
      toCents((outputTokens / 1_000_000) * pricing.output);

    return { text, costUsdCents, truncated: false };
  }
}
