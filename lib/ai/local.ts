import OpenAI from 'openai';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';
// v6 Vercel AI SDK: structured output with tools uses generateText + Output.object, not generateObject.
// tool() in v6 uses `inputSchema` (not `parameters`), matching our ToolDefinition shape directly.
// jsonSchema() wraps a plain JSON Schema object into the SDK's Schema type for Output.object.
import { generateText, tool as aiTool, Output, stepCountIs, jsonSchema as aiJsonSchema } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall, StreamEvent } from './tool-use-types';
import { renderToolDescription } from './tool-use-types';

export class LocalProvider implements AIProvider {
  readonly name = 'local' as const;
  readonly model: string;
  private client: OpenAI;
  private baseURL: string;
  private apiKey: string;

  constructor(model: string, baseURL: string, apiKey: string) {
    this.model = model;
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.client = new OpenAI({ apiKey, baseURL });
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

    // Append schema to system prompt — local models don't support strict json_schema
    // mode, but they follow schema instructions reliably at 27B+ parameter scale.
    const systemWithSchema =
      `${args.systemPrompt}\n\nRespond with valid JSON that matches this schema:\n` +
      JSON.stringify(args.jsonSchema, null, 2);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemWithSchema },
        { role: 'user', content: args.userMessage },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
    const durationMs = Date.now() - started;

    const content = response.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Local model returned non-JSON: ${content.slice(0, 200)}`);
    }
    const data = args.validate(parsed);

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;

    return {
      data,
      costUsdCents: 0,
      durationMs,
      cachedTokens: 0,
      uncachedPromptTokens: promptTokens,
      completionTokens,
    };
  }

  // Local text-generation models cannot process raw PDF/DOCX bytes.
  // The extract-text caller wraps this in try/catch and returns status:'failed'.
  async transcribeDocument(_args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    throw new Error(
      'Local provider does not support document vision transcription. ' +
      'Set AI_PROVIDER=openai for image-based PDF ingestion.',
    );
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
    if (!this.baseURL) throw new Error('LOCAL_BASE_URL not set');
    if (!this.apiKey) throw new Error('LOCAL_API_KEY not set');
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

    // Build the openai-compatible model via @ai-sdk/openai-compatible.
    // This adapter speaks the OpenAI chat completions protocol, which omlx exposes.
    const compat = createOpenAICompatible({
      name: 'omlx-local',
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });

    // v6: Use generateText + Output.object (not generateObject) for structured output with tools.
    // Output.object accepts a Zod schema; the result is in `result.output`.
    // stopWhen: use maxToolCalls+1 steps (extra step for the structured output generation itself).
    const { output, usage, toolCalls } = await generateText({
      model: compat.chatModel(this.model),
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
        // Local model has no per-token cost — always 0.
        costUsdCents: 0,
        durationMs: Date.now() - start,
        cachedTokens,
        uncachedPromptTokens,
        completionTokens: outputTokens,
      },
    };
  }

  // eslint-disable-next-line require-yield
  async *streamWithTools<T>(_args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
  }): AsyncGenerator<StreamEvent<T>, void, unknown> {
    throw new Error(`${this.name} provider does not implement streamWithTools yet`);
  }
}
