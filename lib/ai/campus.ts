import OpenAI from 'openai';
import { z } from 'zod';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall, StreamEvent } from './tool-use-types';
import { renderToolDescription } from './tool-use-types';

/**
 * Convert our ToolDefinitions into OpenAI tool-call format. `parameters` MUST
 * be a real JSON Schema — `inputSchema` is a Zod schema, so it is converted via
 * z.toJSONSchema, never cast. A raw cast ships Zod's internal serialization
 * ({ def, type }) with no `properties`, leaving the model blind to argument
 * names/types. Exported for testing.
 */
export function toOpenAiToolDefs(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: renderToolDescription(t),
      parameters: z.toJSONSchema(t.inputSchema) as Record<string, unknown>,
    },
  }));
}

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

    // The campus model (qwen3.6) doesn't work reliably with the AI SDK's
    // Output.object + tools combination — it either ignores schema field names
    // or confuses tool-call JSON with the structured output step. Instead, use
    // the OpenAI client directly for a manual tool-call loop, then a final
    // json_object call for the structured response. Same pattern as `complete()`.

    // --- Phase 1: tool-call loop ---
    // Convert schema into OpenAI tool format (Zod → JSON Schema; see
    // toOpenAiToolDefs). The OpenAI/Local providers avoid this conversion by
    // handing inputSchema to the AI SDK, which converts internally; the campus
    // path uses the raw OpenAI client and must do it here.
    const oaiTools: ChatCompletionTool[] = toOpenAiToolDefs(args.tools);

    // Convert our Message[] into OpenAI messages. The system prompt is
    // passed separately.
    const oaiMessages: ChatCompletionMessageParam[] = args.messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: m.toolCallId ?? '',
          content: typeof m.result === 'string' ? m.result : JSON.stringify(m.result),
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content ?? null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
          })),
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content ?? '',
      };
    });

    const history: ChatCompletionMessageParam[] = [...oaiMessages];
    const allToolCallsUsed: ToolCall[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const maxSteps = (args.maxToolCalls ?? 2) + 1;

    for (let step = 0; step < maxSteps; step++) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'system', content: args.systemPrompt }, ...history],
        tools: oaiTools.length > 0 ? oaiTools : undefined,
        tool_choice: oaiTools.length > 0 ? 'auto' : undefined,
        temperature: 0.2,
      });
      totalPromptTokens += response.usage?.prompt_tokens ?? 0;
      totalCompletionTokens += response.usage?.completion_tokens ?? 0;

      const msg = response.choices[0]?.message;
      if (!msg) throw new Error('Campus model returned no message');

      history.push(msg);

      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) break; // model stopped calling tools

      // Execute each tool call and append results. ChatCompletionMessageToolCall
      // is a discriminated union (function / custom in the v5 SDK); narrow on
      // type === 'function' so we can access the .function payload.
      for (const tc of toolCalls) {
        if (tc.type !== 'function') continue;
        let result: unknown;
        const toolDef = args.tools.find(t => t.name === tc.function.name);
        if (toolDef) {
          let parsedArgs: Record<string, unknown> = {};
          try { parsedArgs = JSON.parse(tc.function.arguments); } catch { /* empty args */ }
          result = await (toolDef.execute as (a: unknown) => Promise<unknown>)(parsedArgs);
        } else {
          result = { error: `Unknown tool: ${tc.function.name}` };
        }
        allToolCallsUsed.push({
          id: tc.id,
          toolName: tc.function.name,
          args: JSON.parse(tc.function.arguments || '{}'),
        });
        history.push({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
    }

    // --- Phase 2: structured final response ---
    // Append the schema to the system prompt and call with json_object mode.
    // Include the full tool-call history so the model can summarize it.
    const systemWithSchema =
      `${args.systemPrompt}\n\nRespond with valid JSON that matches this schema:\n` +
      JSON.stringify(args.jsonSchema, null, 2);

    const finalResponse = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: systemWithSchema }, ...history],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
    totalPromptTokens += finalResponse.usage?.prompt_tokens ?? 0;
    totalCompletionTokens += finalResponse.usage?.completion_tokens ?? 0;

    const content = finalResponse.choices[0]?.message?.content ?? '';
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(content);
    } catch {
      throw new Error(`Campus model returned non-JSON in final step: ${content.slice(0, 300)}`);
    }
    const value = args.validate(parsedRaw);

    return {
      kind: 'response',
      value,
      toolCallsUsed: allToolCallsUsed,
      telemetry: {
        costUsdCents: 0,
        durationMs: Date.now() - start,
        cachedTokens: 0,
        uncachedPromptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
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
