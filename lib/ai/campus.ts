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

  async completeWithTools<T>(args: ToolCallArgs<T>): Promise<CompleteWithToolsResult<T>> {
    const start = Date.now();
    const loop = this.toolLoop(args);
    let step = await loop.next();
    while (!step.done) step = await loop.next(); // tool-start events are for the stream only
    const { history, toolCallsUsed, promptTokens, completionTokens } = step.value;

    // --- Phase 2: structured final response (json_object mode, full tool history) ---
    const finalResponse = await this.guardedCreate({
      model: this.model,
      messages: [{ role: 'system', content: withSchema(args) }, ...history],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
    const content = finalResponse.choices[0]?.message?.content ?? '';
    return {
      kind: 'response',
      value: parseFinal(content, args.validate),
      toolCallsUsed,
      telemetry: {
        costUsdCents: 0,
        durationMs: Date.now() - start,
        cachedTokens: 0,
        uncachedPromptTokens: promptTokens + (finalResponse.usage?.prompt_tokens ?? 0),
        completionTokens: completionTokens + (finalResponse.usage?.completion_tokens ?? 0),
      },
    };
  }

  /**
   * Streamed tool use (Part 2 Task 4), with the OpenAI provider's event order:
   * a `tool-start` per tool call, `text-delta`s while the reply is written, then
   * `final` (or `error`). The tool steps run as in completeWithTools; the final
   * JSON reply streams. That request has the token cap and time limit but no
   * thinking-off retry, since text has already reached the reader.
   */
  async *streamWithTools<T>(args: ToolCallArgs<T>): AsyncGenerator<StreamEvent<T>, void, unknown> {
    const start = Date.now();
    try {
      const loop = this.toolLoop(args);
      let step = await loop.next();
      while (!step.done) { yield step.value; step = await loop.next(); }
      const { history, toolCallsUsed, promptTokens, completionTokens } = step.value;

      const stream = await this.client.chat.completions.create(
        {
          max_tokens: CAMPUS_MAX_TOKENS,
          model: this.model,
          messages: [{ role: 'system', content: withSchema(args) }, ...history],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          stream: true,
          stream_options: { include_usage: true },
          ...this.reasoningParams,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        { timeout: CAMPUS_TIMEOUT_MS, maxRetries: 0 },
      );
      let content = '';
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) { content += delta; yield { kind: 'text-delta', delta }; }
        if (chunk.usage) usage = chunk.usage;
      }
      yield {
        kind: 'final',
        value: parseFinal(content, args.validate),
        toolCallsUsed,
        telemetry: {
          costUsdCents: 0,
          durationMs: Date.now() - start,
          cachedTokens: 0,
          uncachedPromptTokens: promptTokens + (usage?.prompt_tokens ?? 0),
          completionTokens: completionTokens + (usage?.completion_tokens ?? 0),
        },
      };
    } catch (err) {
      yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * The tool-call phase shared by completeWithTools and streamWithTools: the
   * raw OpenAI client in a manual loop (the AI SDK's Output.object + tools
   * combination is unreliable on campus models). Yields a `tool-start` per
   * tool call; returns the history for the final structured step.
   *
   * requireToolFirst: the first request offers only those tools with
   * tool_choice "required". If the endpoint answers 400 to that, the step is
   * retried without forcing and a warning is logged once. Only a 400 does
   * this: in the 2026-11 benchmark every "forced search rejected" was a
   * reply failing validation (a quote over 200 characters), not a refusal.
   */
  private async *toolLoop<T>(args: ToolCallArgs<T>): AsyncGenerator<StreamEvent<T>, ToolLoopResult, unknown> {
    if (!this.baseURL) throw new Error('CAMPUS_LLM_BASE_URL not set');
    if (!this.apiKey) throw new Error('CAMPUS_LLM_API_KEY not set');
    const oaiTools: ChatCompletionTool[] = toOpenAiToolDefs(args.tools);
    const history: ChatCompletionMessageParam[] = args.messages.map(toOpenAiMessage);
    const toolCallsUsed: ToolCall[] = [];
    let promptTokens = 0;
    let completionTokens = 0;
    const maxSteps = (args.maxToolCalls ?? 2) + 1;
    let forced = oaiTools.filter(t => t.type === 'function' && args.requireToolFirst?.includes(t.function.name));

    for (let step = 0; step < maxSteps; step++) {
      const base = { model: this.model, messages: [{ role: 'system', content: args.systemPrompt }, ...history], temperature: 0.2 };
      const open = { tools: oaiTools.length > 0 ? oaiTools : undefined, tool_choice: oaiTools.length > 0 ? 'auto' : undefined };
      let response: OpenAI.Chat.Completions.ChatCompletion;
      if (step === 0 && forced.length > 0) {
        try {
          response = await this.guardedCreate({ ...base, tools: forced, tool_choice: 'required' });
        } catch (e) {
          if ((e as { status?: number }).status !== 400) throw e;
          console.warn(`[campus] ${this.model}: forced tool choice rejected (400: ${(e as Error).message.slice(0, 160)}); retrying without it`);
          forced = [];
          response = await this.guardedCreate({ ...base, ...open });
        }
      } else {
        response = await this.guardedCreate({ ...base, ...open });
      }
      promptTokens += response.usage?.prompt_tokens ?? 0;
      completionTokens += response.usage?.completion_tokens ?? 0;

      const msg = response.choices[0]?.message;
      if (!msg) throw new Error('Campus model returned no message');
      history.push(msg);

      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) break; // model stopped calling tools

      // ChatCompletionMessageToolCall is a union (function / custom); only function calls run.
      for (const tc of calls) {
        if (tc.type !== 'function') continue;
        let parsedArgs: Record<string, unknown> = {};
        try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch { /* empty args */ }
        yield { kind: 'tool-start', toolName: tc.function.name, args: parsedArgs };
        const toolDef = args.tools.find(t => t.name === tc.function.name);
        const result = toolDef
          ? await (toolDef.execute as (a: unknown) => Promise<unknown>)(parsedArgs)
          : { error: `Unknown tool: ${tc.function.name}` };
        toolCallsUsed.push({ id: tc.id, toolName: tc.function.name, args: parsedArgs });
        history.push({ role: 'tool' as const, tool_call_id: tc.id, content: typeof result === 'string' ? result : JSON.stringify(result) });
      }
    }
    return { history, toolCallsUsed, promptTokens, completionTokens };
  }
}

interface ToolCallArgs<T> {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  schemaName: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
  maxToolCalls?: number;
  /** Force one of these tools on the first request (the interview's search check). */
  requireToolFirst?: string[];
}

interface ToolLoopResult {
  history: ChatCompletionMessageParam[];
  toolCallsUsed: ToolCall[];
  promptTokens: number;
  completionTokens: number;
}

/** The system prompt with the reply's JSON schema appended (json_object mode). */
function withSchema(args: { systemPrompt: string; jsonSchema: object }): string {
  return `${args.systemPrompt}\n\nRespond with valid JSON that matches this schema:\n` + JSON.stringify(args.jsonSchema, null, 2);
}

function parseFinal<T>(content: string, validate: (raw: unknown) => T): T {
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(content);
  } catch {
    throw new Error(`Campus model returned non-JSON in final step: ${content.slice(0, 300)}`);
  }
  return validate(parsedRaw);
}

/** Our Message → an OpenAI chat message (the system prompt is passed separately). */
function toOpenAiMessage(m: Message): ChatCompletionMessageParam {
  if (m.role === 'tool') {
    return { role: 'tool' as const, tool_call_id: m.toolCallId ?? '', content: typeof m.result === 'string' ? m.result : JSON.stringify(m.result) };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant' as const,
      content: m.content ?? null,
      tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.toolName, arguments: JSON.stringify(tc.args) } })),
    };
  }
  return { role: m.role as 'system' | 'user' | 'assistant', content: m.content ?? '' } as ChatCompletionMessageParam;
}

