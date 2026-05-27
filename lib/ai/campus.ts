import OpenAI from 'openai';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';
import { generateText, tool as aiTool, Output, stepCountIs, jsonSchema as aiJsonSchema } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall } from './tool-use-types';

/**
 * Campus-hosted LLM provider (Clemson RCD). Speaks the OpenAI-compatible
 * chat-completions + tool-use protocol exposed by the RCD vLLM/SGLang
 * deployment at https://llm.rcd.clemson.edu/v1. The default model is
 * qwen3.6-35b-a3b-fp8 — MoE with 3B active params, ~180 tok/s on the
 * shared cluster, the right speed/quality balance for hot-path calls.
 * Set CAMPUS_LLM_DEFAULT_MODEL or pass a per-call model override to use
 * glm-5.1-fp8 (754B, deepest reasoning but ~4 tok/s), deepseek-v4-pro
 * (1M context, ~15 tok/s), or any other model the endpoint exposes via
 * /v1/models.
 *
 * Cost is reported as 0 — campus inference is free at the point of use,
 * but concurrency is shared (GLM=128, DeepSeek=48). Don't blast it with
 * parallel batch jobs without coordination.
 */
export class CampusProvider implements AIProvider {
  readonly name = 'campus' as const;
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
      throw new Error(`Campus model returned non-JSON: ${content.slice(0, 200)}`);
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

  // Campus text-generation models cannot process raw PDF/DOCX bytes via this
  // path. (qwen3-omni-30b-a3b is multimodal but is not wired here.) The
  // extract-text caller wraps this in try/catch and returns status:'failed'.
  async transcribeDocument(_args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    throw new Error(
      'Campus provider does not support document vision transcription. ' +
      'Set AI_PROVIDER=openai for image-based PDF ingestion, or wire qwen3-omni separately.',
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
    if (!this.baseURL) throw new Error('CAMPUS_LLM_BASE_URL not set');
    if (!this.apiKey) throw new Error('CAMPUS_LLM_API_KEY not set');
    const start = Date.now();

    const sdkTools: Record<string, ReturnType<typeof aiTool<never, never>>> = {};
    for (const t of args.tools) {
      sdkTools[t.name] = aiTool({
        description: t.description,
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

    const compat = createOpenAICompatible({
      name: 'campus-rcd',
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });

    const { output, usage, toolCalls } = await generateText({
      model: compat.chatModel(this.model),
      system: args.systemPrompt,
      messages: sdkMessages,
      tools: sdkTools,
      output: Output.object({ schema: aiJsonSchema(args.jsonSchema as never), name: args.schemaName }),
      stopWhen: stepCountIs((args.maxToolCalls ?? 4) + 1),
    });

    const value = args.validate(output);

    const toolCallsUsed: ToolCall[] = (toolCalls ?? []).map(tc => ({
      id: tc.toolCallId,
      toolName: tc.toolName,
      args: (tc as unknown as { input: Record<string, unknown> }).input ?? {},
    }));

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cachedTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
    const uncachedPromptTokens = Math.max(0, inputTokens - cachedTokens);

    return {
      kind: 'response',
      value,
      toolCallsUsed,
      telemetry: {
        costUsdCents: 0,
        durationMs: Date.now() - start,
        cachedTokens,
        uncachedPromptTokens,
        completionTokens: outputTokens,
      },
    };
  }
}
