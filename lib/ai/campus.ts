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
 * A campus model's reasoning level. 'off' turns thinking off; the others set
 * how hard it thinks. Each model family accepts a different set and a
 * different wire format (2026-11-01 probe against RCD; spec
 * docs/superpowers/specs/2026-11-01-local-models-and-role-benchmark-design.md).
 */
export type CampusReasoning = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const CAMPUS_REASONING_FAMILIES: Array<{
  name: string;
  match: RegExp;
  levels: CampusReasoning[];
  wire: 'top-level' | 'template';
}> = [
  { name: 'GLM', match: /glm/i, levels: ['off', 'low', 'medium', 'high'], wire: 'top-level' },
  { name: 'DeepSeek', match: /deepseek/i, levels: ['off', 'low', 'high', 'xhigh', 'max'], wire: 'top-level' },
  { name: 'gpt-oss', match: /gpt-?oss/i, levels: ['low', 'medium', 'high'], wire: 'top-level' },
  { name: 'Qwen3.8', match: /qwen3\.8/i, levels: ['off', 'low', 'medium', 'xhigh'], wire: 'template' },
];

/** Request-body fields that set `level` on `model`. Throws for a moving alias
 *  (tiger, cub), an unknown model, or a level the model does not accept, so a
 *  setting is never silently dropped. */
export function campusReasoningParams(model: string, level: CampusReasoning | undefined): Record<string, unknown> {
  if (!level) return {};
  if (/^(tiger|cub)$/i.test(model)) {
    throw new Error(`Campus alias "${model}" moves between models; name the exact model to set its reasoning level`);
  }
  const family = CAMPUS_REASONING_FAMILIES.find(f => f.match.test(model));
  if (!family) throw new Error(`No known reasoning setting for campus model "${model}"`);
  if (!family.levels.includes(level)) {
    throw new Error(`${family.name} (${model}) does not accept reasoning level "${level}"; it accepts ${family.levels.join(', ')}`);
  }
  if (level === 'off') return { chat_template_kwargs: { enable_thinking: false } };
  if (family.wire === 'template') return { chat_template_kwargs: { enable_thinking: true, reasoning_effort: level } };
  return { reasoning_effort: level };
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
/** A campus call hit the token cap or the time limit twice (Part 2 Task 3). */
export class CampusRunawayError extends Error {
  constructor(model: string, cause: string) {
    super(`Campus model ${model} ran away twice (${cause}); not retrying`);
    this.name = 'CampusRunawayError';
  }
}

/** Per-request limits on campus calls (Part 2 spec): a token cap and a 90 s abort. */
export const CAMPUS_MAX_TOKENS = 8000;
export const CAMPUS_TIMEOUT_MS = 90_000;

const isTimeout = (e: unknown) => e instanceof Error && /timeout|abort/i.test(`${e.name} ${e.message}`);

export class CampusProvider implements AIProvider {
  readonly name = 'campus' as const;
  readonly model: string;
  private client: OpenAI;
  private baseURL: string;
  private apiKey: string;
  /** Reasoning fields sent on every request (campusReasoningParams). */
  private reasoningParams: Record<string, unknown>;

  /** `reasoning` sets the level for any known campus model. `reasoningEffort`
   *  is the older gpt-oss form; it isolates reasoning into a separate response
   *  field so `content` stays clean JSON. */
  constructor(model: string, baseURL: string, apiKey: string, opts?: { reasoningEffort?: 'low' | 'medium' | 'high'; reasoning?: CampusReasoning }) {
    this.model = model;
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.reasoningParams = opts?.reasoning
      ? campusReasoningParams(model, opts.reasoning)
      : opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {};
    this.client = new OpenAI({ apiKey, baseURL });
  }

  /** Reasoning fields for the runaway retry: thinking off where the family has it, else none. */
  private offParams(): Record<string, unknown> {
    try { return campusReasoningParams(this.model, 'off'); } catch { return {}; }
  }

  /**
   * One non-streaming request with the runaway guard: capped at
   * CAMPUS_MAX_TOKENS and CAMPUS_TIMEOUT_MS. A response cut at the cap
   * (finish_reason 'length') or a timeout is retried once with thinking off;
   * a second runaway throws CampusRunawayError. Never switches provider.
   */
  private async guardedCreate(body: Record<string, unknown>): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    let cause = '';
    for (const reasoning of [this.reasoningParams, this.offParams()]) {
      try {
        const res = await this.client.chat.completions.create(
          { max_tokens: CAMPUS_MAX_TOKENS, ...body, ...reasoning } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
          { timeout: CAMPUS_TIMEOUT_MS, maxRetries: 0 },
        );
        if (res.choices[0]?.finish_reason !== 'length') return res;
        cause = 'token cap';
      } catch (e) {
        if (!isTimeout(e)) throw e;
        cause = 'time limit';
      }
      console.warn(`[campus] ${this.model} hit the ${cause}; retrying once with thinking off`);
    }
    throw new CampusRunawayError(this.model, cause);
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

    const response = await this.guardedCreate({
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
      const response = await this.guardedCreate({
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

    const finalResponse = await this.guardedCreate({
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
