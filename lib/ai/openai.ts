import OpenAI from 'openai';
import { openAIBaseURL } from './openai-base-url';
import { MODEL_PRICING, FALLBACK_PRICING, DEFAULT_REASONING_EFFORT, usesResponsesApi } from './models';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';
// v6 Vercel AI SDK: structured output with tools uses generateText + Output.object, not generateObject.
// tool() in v6 uses `inputSchema` (not `parameters`), matching our ToolDefinition shape directly.
// jsonSchema() wraps a plain JSON Schema object into the SDK's Schema type for Output.object.
import { generateText, streamText, tool as aiTool, Output, stepCountIs, jsonSchema as aiJsonSchema } from 'ai';
import { openai as aiOpenai } from '@ai-sdk/openai';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall, StreamEvent } from './tool-use-types';
import { renderToolDescription } from './tool-use-types';
import { AiCreditsExhaustedError, isCreditsExhaustedError, markCreditsExhausted, markCreditsOk } from './credit-status';

function toCents(usd: number): number {
  return Math.ceil(usd * 100 * 100); // 1/100 of a cent
}

/** Pre-call cost estimate (dry runs, --max-cost guards). Same table and
 * rounding as complete(); no prefix-cache discount, so it errs high. */
export function estimateCostCents(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  return toCents((promptTokens / 1_000_000) * pricing.input) + toCents((completionTokens / 1_000_000) * pricing.output);
}

/**
 * Per-call limits for the OpenAI gateway. The SDK defaults (10 min per attempt,
 * 2 retries) let one hung call stall for ~30 min before failing; the longest
 * legitimate single call observed is ~3 min (course profile, 2026-10-05).
 * 5 min x 2 attempts caps a hang at 10 min while still retrying a 502 once.
 */
export const OPENAI_TIMEOUT_MS = 5 * 60_000;
export const OPENAI_MAX_RETRIES = 1;

/**
 * Effort for a function call: the evaluation knob OPENAI_REASONING_EFFORT
 * (when set and non-empty) above the role's effort. Pass the result to the
 * provider / effectiveReasoningEffort as the explicit effort.
 */
export function functionEffort(roleEffort: string | undefined): string | undefined {
  return process.env.OPENAI_REASONING_EFFORT?.trim() || roleEffort;
}

export function effectiveReasoningEffort(model: string, explicit: string | undefined): string | undefined {
  return explicit ?? process.env.OPENAI_REASONING_EFFORT?.trim() ?? DEFAULT_REASONING_EFFORT[model];
}

/**
 * Model + providerOptions for the Vercel AI SDK tool-using calls
 * (completeWithTools / streamWithTools). gpt-6* models go through the
 * stateless Responses API (see the comment at the top of completeWithTools
 * for why); every other model keeps the existing Chat Completions path
 * untouched.
 */
function toolUseModelConfig(model: string, effort: string | undefined) {
  if (usesResponsesApi(model)) {
    return {
      model: aiOpenai.responses(model),
      providerOptions: {
        openai: {
          store: false,
          include: ['reasoning.encrypted_content' as const],
          forceReasoning: true,
          ...(effort ? { reasoningEffort: effort } : {}),
        },
      },
    };
  }
  return { model: aiOpenai.chat(model), providerOptions: undefined };
}

/**
 * Extract a readable message from a streamText `error` stream part. The
 * error can arrive as a real Error, or as a plain object (e.g. an API error
 * body) whose message may be nested under `.error.message`; naively
 * String()-ing the latter renders "[object Object]".
 */
function describeStreamError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const obj = error as { error?: { message?: string }; message?: string } | null | undefined;
  return obj?.error?.message ?? obj?.message ?? String(error);
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly model: string;
  private client: OpenAI;
  private apiKey: string;

  /** Optional reasoning effort for structured completions (evaluation use; production passes none). */
  private reasoningEffort?: string;

  constructor(model: string, apiKey: string, reasoningEffort?: string) {
    this.model = model;
    this.reasoningEffort = reasoningEffort;
    this.apiKey = apiKey;
    this.client = new OpenAI({ apiKey, baseURL: openAIBaseURL(), timeout: OPENAI_TIMEOUT_MS, maxRetries: OPENAI_MAX_RETRIES });
  }


  /**
   * Shared-credit detection (owner, 2026-10-19). Wraps each gateway call: a
   * quota_denied failure is recorded (status file + owner alert trigger) and
   * rethrown as AiCreditsExhaustedError; a success clears a stale "exhausted"
   * status (markCreditsOk only writes on a change). Retries and every other
   * error are untouched.
   */
  private async creditsMapped(err: unknown, op: string): Promise<unknown> {
    if (err instanceof AiCreditsExhaustedError || !isCreditsExhaustedError(err)) return err;
    await markCreditsExhausted('request', `${this.model} ${op}`);
    return new AiCreditsExhaustedError(undefined, { cause: err });
  }

  private async withCredits<R>(op: string, call: () => Promise<R>): Promise<R> {
    let result: R;
    try {
      result = await call();
    } catch (err) {
      throw await this.creditsMapped(err, op);
    }
    void markCreditsOk('request');
    return result;
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
    // Explicit effort, then the evaluation env knob, then the model's default.
    const effort = effectiveReasoningEffort(this.model, this.reasoningEffort);
    const response = await this.withCredits('complete', () => this.client.chat.completions.create({
      model: this.model,
      ...(effort ? { reasoning_effort: effort as 'low' | 'medium' | 'high' } : {}),
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
      // OpenAI's gpt-5 family rejects any temperature ≠ 1 (the wiki-update
      // function 400'd with "Unsupported value: 'temperature' does not
      // support 0.2 with this model"). For structured outputs the JSON
      // schema constrains the response shape regardless of temperature;
      // the previous 0.2 override gave a marginal determinism boost that
      // no longer earns its keep. Default (1) works across all current
      // OpenAI models.
    }));
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

    const response = await this.withCredits('transcribeDocument', () => this.client.chat.completions.create({
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
      // No temperature override — gpt-5 family rejects non-default values.
    }));

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
    //
    // Model selection: gpt-6* models 400 on Chat Completions when function tools are
    // present ("use /v1/responses"), so those go through the Responses API instead, with
    // providerOptions.openai.store:false so the SDK resends full function_call/reasoning
    // items inline each step rather than a server-side item_reference (store defaults to
    // true, which 404s "Item fc_… not found" through RCD's stateless proxy — vercel/ai
    // #7543). gpt-5.x and earlier keep the existing Chat Completions path untouched, since
    // it already works and backs the live interview. (Investigated 2026-10-06.)
    const effort = effectiveReasoningEffort(this.model, this.reasoningEffort);
    const { model: toolUseModel, providerOptions } = toolUseModelConfig(this.model, effort);
    const { output, totalUsage, steps } = await this.withCredits('completeWithTools', () => generateText({
      model: toolUseModel,
      ...(providerOptions ? { providerOptions } : {}),
      system: args.systemPrompt,
      messages: sdkMessages,
      tools: sdkTools,
      // v6: Output.object requires a Schema (not a plain object); aiJsonSchema() wraps the raw JSON schema.
      output: Output.object({ schema: aiJsonSchema(args.jsonSchema as never), name: args.schemaName }),
      // Add 1 to maxToolCalls to account for the structured output step itself (v6 requirement).
      stopWhen: stepCountIs((args.maxToolCalls ?? 4) + 1),
    }));

    const value = args.validate(output);

    // v6: StaticToolCall has `toolCallId`, `toolName`, and `input` (not `args`). `toolCalls`
    // on the top-level result is LAST-STEP ONLY; build the full list from every step so
    // multi-step tool loops report all the calls they made, not just the final step's.
    const toolCallsUsed: ToolCall[] = steps.flatMap(s => s.toolCalls).map(tc => ({
      id: tc.toolCallId,
      toolName: tc.toolName,
      args: (tc as unknown as { input: Record<string, unknown> }).input ?? {},
    }));

    // v6: LanguageModelUsage uses `inputTokens`/`outputTokens`/`inputTokenDetails.cacheReadTokens`
    // (not `promptTokens`/`completionTokens`/`cachedPromptTokens` from the plan's v4 reference).
    // `totalUsage` (not `usage`, which is last-step only) sums all steps, so multi-step tool
    // loops record their full spend rather than just the final step's.
    const inputTokens = totalUsage?.inputTokens ?? 0;
    const outputTokens = totalUsage?.outputTokens ?? 0;
    const cachedTokens = totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0;
    const uncachedPromptTokens = Math.max(0, inputTokens - cachedTokens);

    // Per-token cost, mirroring complete()/streamWithTools(). The non-streaming
    // tool path previously reported 0, so any tool-using OpenAI call (e.g. the
    // partner position interview via position-capture/run.ts) recorded no spend
    // and under-counted the daily cap. Compute it for real.
    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((uncachedPromptTokens / 1_000_000) * pricing.input) +
      toCents((cachedTokens / 1_000_000) * pricing.input * 0.1) +
      toCents((outputTokens / 1_000_000) * pricing.output);

    return {
      kind: 'response',
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

    // Model selection mirrors completeWithTools above: gpt-6* models go through the
    // stateless Responses API (store:false) because Chat Completions rejects function
    // tools on them; gpt-5.x and earlier keep the existing Chat Completions path.
    const effort = effectiveReasoningEffort(this.model, this.reasoningEffort);
    const { model: toolUseModel, providerOptions } = toolUseModelConfig(this.model, effort);
    const result = streamText({
      model: toolUseModel,
      ...(providerOptions ? { providerOptions } : {}),
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
          if (isCreditsExhaustedError(part.error)) throw part.error; // mapped in the catch below
          yield {
            kind: 'error',
            message: describeStreamError(part.error),
          };
          return;
        }
      }

      // `usage`/`toolCalls` on the result are LAST-STEP ONLY; `totalUsage` sums all
      // steps, and the full tool-call list comes from flattening every step's calls —
      // mirrors completeWithTools above.
      const totalUsage = await result.totalUsage;
      const steps = await result.steps;
      const finalOutput = await result.output;

      const value = args.validate(finalOutput);
      const toolCallsUsed: ToolCall[] = steps.flatMap(s => s.toolCalls).map(tc => ({
        id: tc.toolCallId,
        toolName: tc.toolName,
        args: (tc as unknown as { input: Record<string, unknown> }).input ?? {},
      }));

      const inputTokens = totalUsage?.inputTokens ?? 0;
      const outputTokens = totalUsage?.outputTokens ?? 0;
      const cachedTokens = totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0;
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
      const mapped = await this.creditsMapped(err, 'streamWithTools');
      if (mapped instanceof AiCreditsExhaustedError) throw mapped;
      yield {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }
    void markCreditsOk('request');
  }
}
