export interface CompletionTelemetry {
  costUsdCents: number;
  durationMs: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
}

export interface TranscribeDocumentArgs {
  fileBytes: Buffer;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  /** Max pages to transcribe. Default: 40. */
  maxPages?: number;
  /** Force every page to the DGX offload endpoint, bypassing the small-doc size
   *  tier. Used by the hard-scan OCR lane so all pages run on the benched Spark
   *  variant. Ignored by providers without an offload path (OpenAI/Anthropic/campus). */
  forceOffload?: boolean;
}

export interface TranscribeDocumentResult {
  text: string;
  costUsdCents: number;
  /** True when the file exceeded maxPages and was truncated. */
  truncated: boolean;
}

import type {
  ToolDefinition,
  Message,
  CompleteWithToolsResult,
  StreamEvent,
} from './tool-use-types';

export interface AIProvider {
  readonly name: 'openai' | 'anthropic' | 'fake' | 'local' | 'campus';
  readonly model: string;

  /**
   * Call the model with a system prompt and a user message.
   * Validates the response against the supplied JSON schema (provider-side validation
   * via response_format when the provider supports it; client-side validation always).
   * Returns the parsed object plus token/cost telemetry.
   */
  complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;            // for OpenAI structured outputs naming
    jsonSchema: object;
    validate: (raw: unknown) => T; // typically the Zod schema's parse
    /** Optional raw file bytes to send as native document blocks (Anthropic only; ignored by OpenAI). */
    documents?: Array<{ bytes: Buffer; mimeType: string }>;
  }): Promise<{ data: T } & CompletionTelemetry>;

  /**
   * Send raw file bytes to a vision-capable model and return transcribed text.
   * Used only for image-based PDFs that yield too little text from pdf-parse.
   * Cost is NOT recorded here — caller is responsible for checkDailyCap + recordSpend.
   */
  transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult>;

  /**
   * Tool-use enabled completion. The caller supplies the system prompt,
   * the full message history (assistant turns + tool results inclusive),
   * and the tool definitions the model is allowed to call.
   *
   * Returns either a final structured response (kind: 'response') OR
   * a set of tool calls the model wants made (kind: 'tool_calls').
   * Callers loop: execute the tools, append the tool-result messages,
   * reinvoke with the updated message history, until kind === 'response'.
   *
   * Tool execution can also be handled by the provider itself when the
   * underlying SDK supports it (Vercel AI SDK does); in that case the
   * resolved `value` is returned directly with `toolCallsUsed` listing
   * the tools that fired during the run.
   */
  completeWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    /** Maximum tool calls allowed per top-level invocation. Default: 4. */
    maxToolCalls?: number;
    /** The first step must call one of these tools (lib/ai/require-tool-first.ts).
     *  Honored by the OpenAI provider; others ignore it. */
    requireToolFirst?: string[];
  }): Promise<CompleteWithToolsResult<T>>;

  /**
   * Streaming variant of `completeWithTools`. Yields progressive events as
   * tools fire and text generates, ending with a `final` event carrying the
   * validated structured value. Errors terminate the stream with a `kind: 'error'` event.
   *
   * Providers that don't yet stream may throw "not implemented" — callers
   * must either gate on a feature flag or fall back to `completeWithTools`.
   */
  streamWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
    requireToolFirst?: string[];
  }): AsyncIterable<StreamEvent<T>>;
}

import { OpenAIProvider, functionEffort } from './openai';
import { AnthropicProvider } from './anthropic';
import { LocalProvider } from './local';
import { CampusProvider, type CampusReasoning } from './campus';
import { resolveForFunction, type AIFunctionId } from './function-settings';
import { visionModel, DEFAULT_LOCAL_VISION_MODEL } from './vision-models';
import { ROLE_SETTINGS } from './models';

export interface GetProviderOptions {
  /** When set, the provider uses the model assigned to this function via
   *  the AI settings table (with the function's compiled-in default tier
   *  as fallback). Without this, the env-default model is used. */
  functionId?: AIFunctionId;
  /** Explicit override; takes precedence over functionId. */
  model?: string;
}

/**
 * Synchronous variant: builds a provider using only env defaults. Used by
 * legacy call sites that haven't been migrated to functionId-aware calls.
 * New code should prefer `getProviderForFunction` (async).
 */
export function getProvider(): AIProvider {
  return buildProvider(undefined);
}

/**
 * Async variant: looks up the per-function model from the settings table
 * (with TTL-cached resolution) before constructing the provider. Each AI
 * helper should call this with its functionId.
 */
export async function getProviderForFunction(
  functionId: AIFunctionId,
  override?: { model?: string; reasoningEffort?: string },
): Promise<AIProvider> {
  if (override?.model) return buildProvider(override.model, override.reasoningEffort, true);
  const resolved = await resolveForFunction(functionId);
  // A campus role runs on its campus model whatever AI_PROVIDER says; its
  // effort is the campus reasoning level (Part 2, 2026-11-09).
  if (resolved.provider === 'campus') {
    const campus = buildCampusProvider(resolved.model, resolved.effort);
    return resolved.fallback
      ? new FallbackProvider(campus, buildProvider(resolved.fallback.model, functionEffort(resolved.fallback.effort)))
      : campus;
  }
  // The evaluation knob OPENAI_REASONING_EFFORT stays above the role's effort.
  return buildProvider(resolved.model, functionEffort(resolved.effort));
}

/**
 * Campus first, OpenAI if the campus call fails (Part 2 Task 2). The one place
 * the fallback lives; call sites never handle it. A stream falls back only if
 * it fails before its first event, so a reader never sees two replies.
 */
export class FallbackProvider implements AIProvider {
  readonly name: AIProvider['name'];
  readonly model: string;
  constructor(private primary: AIProvider, private secondary: AIProvider) {
    this.name = primary.name;
    this.model = primary.model;
  }
  private warn(op: string, err: unknown) {
    console.warn(`[ai-fallback] ${this.primary.name}:${this.primary.model} ${op} failed (${err instanceof Error ? err.message.slice(0, 160) : String(err)}); using ${this.secondary.name}:${this.secondary.model}`);
  }
  async complete<T>(args: Parameters<AIProvider['complete']>[0] & { validate: (raw: unknown) => T }) {
    try { return await this.primary.complete<T>(args); } catch (e) { this.warn('complete', e); return this.secondary.complete<T>(args); }
  }
  async transcribeDocument(args: TranscribeDocumentArgs) {
    try { return await this.primary.transcribeDocument(args); } catch (e) { this.warn('transcribeDocument', e); return this.secondary.transcribeDocument(args); }
  }
  async completeWithTools<T>(args: Parameters<AIProvider['completeWithTools']>[0] & { validate: (raw: unknown) => T }) {
    try { return await this.primary.completeWithTools<T>(args); } catch (e) { this.warn('completeWithTools', e); return this.secondary.completeWithTools<T>(args); }
  }
  async *streamWithTools<T>(args: Parameters<AIProvider['streamWithTools']>[0] & { validate: (raw: unknown) => T }): AsyncIterable<StreamEvent<T>> {
    let started = false;
    try {
      for await (const e of this.primary.streamWithTools<T>(args)) { started = true; yield e; }
    } catch (e) {
      if (started) throw e;
      this.warn('streamWithTools', e);
      yield* this.secondary.streamWithTools<T>(args);
    }
  }
}

/** A CampusProvider for an exact campus model and reasoning level. */
function buildCampusProvider(model: string, reasoning: string | undefined): AIProvider {
  const baseURL = process.env.CAMPUS_LLM_BASE_URL?.trim();
  if (!baseURL) throw new Error('CAMPUS_LLM_BASE_URL not set');
  const apiKey = process.env.CAMPUS_LLM_API_KEY?.trim();
  if (!apiKey) throw new Error('CAMPUS_LLM_API_KEY not set');
  return new CampusProvider(model, baseURL, apiKey, reasoning ? { reasoning: reasoning as CampusReasoning } : undefined);
}

/** `explicitEffort`: the effort came from an explicit caller override (an
 *  evaluation script), not a role. Only then is it sent to a campus model, as
 *  that model's reasoning level; a role effort is an OpenAI setting. */
function buildProvider(modelOverride: string | undefined, reasoningEffort?: string, explicitEffort = false): AIProvider {
  // Trim every env var defensively — Vercel sometimes preserves trailing
  // newlines from pasted values, and OpenAI rejects an API key with CR/LF.
  //
  // Fail closed: an unset/empty AI_PROVIDER must NOT silently default to the
  // paid 'openai' provider (a misconfiguration footgun — see audit F11). Require
  // it to be set explicitly. Deployed envs set AI_PROVIDER (.env.local), so this
  // only catches accidental omission.
  const which = process.env.AI_PROVIDER?.trim();
  if (!which) {
    throw new Error(
      'AI_PROVIDER is not set — refusing to default to a paid provider. ' +
      'Set AI_PROVIDER to one of: openai | anthropic | local | campus.',
    );
  }
  if (which === 'openai') {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY not set');
    const model = modelOverride ?? ROLE_SETTINGS.write.model;
    return new OpenAIProvider(model, key, reasoningEffort);
  }
  if (which === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    return new AnthropicProvider(
      modelOverride ?? process.env.ANTHROPIC_MODEL?.trim() ?? 'claude-sonnet-4-6',
      key,
    );
  }
  if (which === 'local') {
    // Default to a STANDARDIZED resident omlx model (gemma-4-26B-A4B, one of the
    // three we keep loaded) so the dormant AI_PROVIDER=local path can never pull
    // a 4th model and force a swap. (Was gemma-4-31B-it-MLX-4bit. 2026-06-27)
    const model = modelOverride ?? process.env.LOCAL_MODEL?.trim() ?? DEFAULT_LOCAL_VISION_MODEL;
    const baseURL = process.env.LOCAL_BASE_URL?.trim() || 'http://localhost:8000/v1';
    const apiKey = process.env.LOCAL_API_KEY?.trim();
    if (!apiKey) throw new Error('LOCAL_API_KEY not set');
    return new LocalProvider(model, baseURL, apiKey);
  }
  if (which === 'campus') {
    const baseURL = process.env.CAMPUS_LLM_BASE_URL?.trim();
    if (!baseURL) throw new Error('CAMPUS_LLM_BASE_URL not set');
    const apiKey = process.env.CAMPUS_LLM_API_KEY?.trim();
    if (!apiKey) throw new Error('CAMPUS_LLM_API_KEY not set');
    // CAMPUS_LLM_DEFAULT_MODEL always wins for campus — the DB stores OpenAI
    // model names (e.g. gpt-5.4-mini) which are meaningless on the campus
    // endpoint. When set, prefer it over any modelOverride from the DB.
    // Default to qwen3.6-35b-a3b-fp8: MoE with 3B active params, ~2s and ~180
    // tok/s on a 400-token output. GLM-5.1 was the initial choice but its
    // 4 tok/s throughput makes any hot-path call unworkable on the shared
    // cluster; pass it explicitly via per-call model override when reasoning
    // depth justifies the latency.
    const model =
      process.env.CAMPUS_LLM_DEFAULT_MODEL?.trim() ??
      modelOverride ??
      'qwen3.6-35b-a3b-fp8';
    // CAMPUS_LLM_REASONING (benchmarks): a reasoning level for every role call on the
    // pinned CAMPUS_LLM_DEFAULT_MODEL. An explicit override's level still wins.
    const reasoning = explicitEffort && reasoningEffort ? reasoningEffort : process.env.CAMPUS_LLM_REASONING?.trim();
    return new CampusProvider(model, baseURL, apiKey, reasoning ? { reasoning: reasoning as CampusReasoning } : undefined);
  }
  throw new Error(`Unknown AI provider: ${which}`);
}

/**
 * Build a LocalProvider (omlx) for vision transcription, independent of the
 * global AI_PROVIDER. Used by the ingest worker's local-only mode to route
 * image-PDF transcription to omlx while the rest of the app stays on OpenAI.
 * Model resolution: explicit arg → the vision registry's `docTranscribe` model
 * (LOCAL_VISION_MODEL env → Qwen3.6-35B-A3B default since 2026-10-05; Gemma retired).
 */
export function buildLocalProvider(model?: string): AIProvider {
  const baseURL = process.env.LOCAL_BASE_URL?.trim() || 'http://localhost:8000/v1';
  const apiKey = process.env.LOCAL_API_KEY?.trim();
  if (!apiKey) throw new Error('LOCAL_API_KEY not set');
  const resolved = model ?? visionModel('docTranscribe').model;
  return new LocalProvider(resolved, baseURL, apiKey);
}

export type { ToolDefinition, ToolCall, ToolResult, Message, CompleteWithToolsResult, StreamEvent } from './tool-use-types';
