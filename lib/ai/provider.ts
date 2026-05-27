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
  }): Promise<CompleteWithToolsResult<T>>;
}

import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { LocalProvider } from './local';
import { CampusProvider } from './campus';
import { resolveModelForFunction, type AIFunctionId } from './function-settings';

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
  override?: { model?: string },
): Promise<AIProvider> {
  if (override?.model) return buildProvider(override.model);
  const resolved = await resolveModelForFunction(functionId);
  return buildProvider(resolved);
}

function buildProvider(modelOverride: string | undefined): AIProvider {
  // Trim every env var defensively — Vercel sometimes preserves trailing
  // newlines from pasted values, and OpenAI rejects an API key with CR/LF.
  const which = process.env.AI_PROVIDER?.trim() || 'openai';
  if (which === 'openai') {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY not set');
    const model = modelOverride ?? process.env.OPENAI_MODEL?.trim() ?? 'gpt-5.4';
    return new OpenAIProvider(model, key);
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
    const model = modelOverride ?? process.env.LOCAL_MODEL?.trim() ?? 'gemma-4-31B-it-MLX-4bit';
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
    return new CampusProvider(model, baseURL, apiKey);
  }
  throw new Error(`Unknown AI provider: ${which}`);
}

export type { ToolDefinition, ToolCall, ToolResult, Message, CompleteWithToolsResult } from './tool-use-types';
