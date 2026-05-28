import OpenAI from 'openai';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';
// v6 Vercel AI SDK: structured output with tools uses generateText + Output.object, not generateObject.
// tool() in v6 uses `inputSchema` (not `parameters`), matching our ToolDefinition shape directly.
// jsonSchema() wraps a plain JSON Schema object into the SDK's Schema type for Output.object.
import { generateText, streamText, tool as aiTool, Output, stepCountIs, jsonSchema as aiJsonSchema } from 'ai';
import { openai as aiOpenai } from '@ai-sdk/openai';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall, StreamEvent } from './tool-use-types';
import { renderToolDescription } from './tool-use-types';

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
  private apiKey: string;

  constructor(model: string, apiKey: string) {
    this.model = model;
    this.apiKey = apiKey;
    this.client = new OpenAI({ apiKey });
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
      max_completion_tokens: 4096,
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

  async completeWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
  }): Promise<CompleteWithToolsResult<T>> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
    const start = Date.now();

    // Convert our ToolDefinition[] into the Vercel AI SDK v6 tool shape.
    // v6: tool() uses `inputSchema` (not `parameters`), which matches our ToolDefinition directly.
    // Cast to Record<string, never> to satisfy the ToolSet constraint in generateText's tools parameter.
    const sdkTools: Record<string, ReturnType<typeof aiTool<never, never>>> = {};
    for (const t of args.tools) {
      sdkTools[t.name] = aiTool({
        description: renderToolDescription(t),
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
      model: aiOpenai(this.model),
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

  async *streamWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
  }): AsyncGenerator<StreamEvent<T>, void, unknown> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
    const start = Date.now();

    const sdkTools: Record<string, ReturnType<typeof aiTool<never, never>>> = {};
    for (const t of args.tools) {
      sdkTools[t.name] = aiTool({
        description: renderToolDescription(t),
        inputSchema: t.inputSchema as never,
        execute: t.execute as never,
      });
    }

    const sdkMessages = args.messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: [{
            type: 'tool-result' as const,
            toolCallId: m.toolCallId,
            toolName: 'unknown',
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

    const result = streamText({
      model: aiOpenai(this.model),
      system: args.systemPrompt,
      messages: sdkMessages,
      tools: sdkTools,
      experimental_output: Output.object({
        schema: aiJsonSchema(args.jsonSchema as never),
        name: args.schemaName,
      }),
      stopWhen: stepCountIs((args.maxToolCalls ?? 4) + 1),
    });

    try {
      for await (const part of result.fullStream) {
        if (part.type === 'tool-call') {
          yield {
            kind: 'tool-start',
            toolName: part.toolName,
            args: (part as unknown as { input?: Record<string, unknown> }).input ?? {},
          };
        } else if (part.type === 'text-delta') {
          // v6: text-delta carries `text` (the delta string itself).
          const delta = (part as unknown as { text?: string }).text ?? '';
          if (delta) yield { kind: 'text-delta', delta };
        } else if (part.type === 'error') {
          yield {
            kind: 'error',
            message: part.error instanceof Error ? part.error.message : String(part.error),
          };
          return;
        }
      }

      const usage = await result.usage;
      const finalToolCalls = await result.toolCalls;
      const finalOutput = await result.output;

      const value = args.validate(finalOutput);
      const toolCallsUsed: ToolCall[] = (finalToolCalls ?? []).map(tc => ({
        id: tc.toolCallId,
        toolName: tc.toolName,
        args: (tc as unknown as { input: Record<string, unknown> }).input ?? {},
      }));

      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;
      const cachedTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
      const uncachedPromptTokens = Math.max(0, inputTokens - cachedTokens);
      const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
      const costUsdCents =
        toCents((uncachedPromptTokens / 1_000_000) * pricing.input) +
        toCents((cachedTokens / 1_000_000) * pricing.input * 0.1) +
        toCents((outputTokens / 1_000_000) * pricing.output);

      yield {
        kind: 'final',
        value,
        toolCallsUsed,
        telemetry: {
          costUsdCents,
          durationMs: Date.now() - start,
          cachedTokens,
          uncachedPromptTokens,
          completionTokens: outputTokens,
        },
      };
    } catch (err) {
      yield {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
