import Anthropic from '@anthropic-ai/sdk';
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';
// v6 Vercel AI SDK: structured output with tools uses generateText + Output.object, not generateObject.
// tool() in v6 uses `inputSchema` (not `parameters`), matching our ToolDefinition shape directly.
// jsonSchema() wraps a plain JSON Schema object into the SDK's Schema type for Output.object.
import { generateText, tool as aiTool, Output, stepCountIs, jsonSchema as aiJsonSchema } from 'ai';
import { anthropic as aiAnthropic } from '@ai-sdk/anthropic';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall } from './tool-use-types';

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

  async completeWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
  }): Promise<CompleteWithToolsResult<T>> {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    const start = Date.now();

    // Convert our ToolDefinition[] into the Vercel AI SDK v6 tool shape.
    // v6: tool() uses `inputSchema` (not `parameters`), which matches our ToolDefinition directly.
    // Cast to Record<string, never> to satisfy the ToolSet constraint in generateText's tools parameter.
    const sdkTools: Record<string, ReturnType<typeof aiTool<never, never>>> = {};
    for (const t of args.tools) {
      sdkTools[t.name] = aiTool({
        description: t.description,
        inputSchema: t.inputSchema as never,
        execute: t.execute as never,
      });
    }

    // Convert our Message[] into the SDK's ModelMessage shape.
    // v6: tool-call content uses `input` key (not `args`); tool-result uses `output` wrapped in { type, value }.
    const sdkMessages = args.messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: [{
            type: 'tool-result' as const,
            toolCallId: m.toolCallId,
            toolName: 'unknown',
            // Cast to JSONValue: tool results from our interface are `unknown`; the SDK requires JSONValue.
            output: { type: 'json' as const, value: m.result as import('ai').JSONValue },
          }],
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.toolCalls.map(tc => ({
              type: 'tool-call' as const,
              toolCallId: tc.id,
              toolName: tc.toolName,
              input: tc.args,
            })),
          ],
        };
      }
      return { role: m.role as 'system' | 'user' | 'assistant', content: m.content ?? '' };
    });

    // v6: Use generateText + Output.object (not generateObject) for structured output with tools.
    // Output.object accepts a Zod schema; the result is in `result.output`.
    // stopWhen: use maxToolCalls+1 steps (extra step for the structured output generation itself).
    const { output, usage, toolCalls } = await generateText({
      model: aiAnthropic(this.model),
      system: args.systemPrompt,
      messages: sdkMessages,
      tools: sdkTools,
      // v6: Output.object requires a Schema (not a plain object); aiJsonSchema() wraps the raw JSON schema.
      output: Output.object({ schema: aiJsonSchema(args.jsonSchema as never), name: args.schemaName }),
      // Add 1 to maxToolCalls to account for the structured output step itself (v6 requirement).
      stopWhen: stepCountIs((args.maxToolCalls ?? 4) + 1),
    });

    const value = args.validate(output);

    // v6: StaticToolCall has `toolCallId`, `toolName`, and `input` (not `args`).
    const toolCallsUsed: ToolCall[] = (toolCalls ?? []).map(tc => ({
      id: tc.toolCallId,
      toolName: tc.toolName,
      args: (tc as unknown as { input: Record<string, unknown> }).input ?? {},
    }));

    // v6: LanguageModelUsage uses `inputTokens`/`outputTokens`/`inputTokenDetails.cacheReadTokens`
    // (not `promptTokens`/`completionTokens`/`cachedPromptTokens` from the plan's v4 reference).
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cachedTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
    const uncachedPromptTokens = Math.max(0, inputTokens - cachedTokens);

    return {
      kind: 'response',
      value,
      toolCallsUsed,
      telemetry: {
        // Stage 1: cost estimation is a placeholder — Stage 3 will wire per-token pricing.
        costUsdCents: 0,
        durationMs: Date.now() - start,
        cachedTokens,
        uncachedPromptTokens,
        completionTokens: outputTokens,
      },
    };
  }
}
