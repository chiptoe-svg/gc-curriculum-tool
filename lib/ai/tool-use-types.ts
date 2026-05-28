/**
 * Shared types for the tool-using agent path. Used by the provider
 * abstraction (lib/ai/provider.ts) and all four implementations
 * (openai/anthropic/local/fake).
 *
 * Designed to be compatible with the Vercel AI SDK's tool/message
 * shapes, since the OpenAI and Anthropic providers wrap that SDK
 * under the hood. The Fake and Local providers use these types
 * directly without an SDK dependency.
 */

import { z } from 'zod';

/** Definition of one tool the agent can call. */
export interface ToolDefinition {
  /** Tool name as the model will see it. snake_case by convention. */
  name: string;
  /** Human-readable description shown to the model. */
  description: string;
  /** Zod schema for the tool's input args. */
  inputSchema: z.ZodSchema;
  /** Async function that actually executes the tool when the model calls it. */
  execute: (args: unknown) => Promise<unknown>;
  /**
   * Optional usage policy co-located with the tool. Surfaced to the model
   * by appending under a "**Usage:**" marker to the rendered description.
   * Use for per-tool guidance ("call this when X, not when Y; pass course-
   * code from session metadata"). General retrieval discipline (per-turn
   * budgets, when-to-retrieve-vs-ask) belongs in the system prompt.
   */
  usagePolicy?: string;
}

/**
 * Render a tool's description for the model — description verbatim when no
 * usagePolicy is set; description plus a "**Usage:**" appendage otherwise.
 * Centralizes the rendering so all four providers stay in sync.
 */
export function renderToolDescription(t: ToolDefinition): string {
  const policy = t.usagePolicy?.trim();
  return policy ? `${t.description}\n\n**Usage:** ${policy}` : t.description;
}

/** One tool invocation issued by the model. */
export interface ToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** Result of executing one tool call. */
export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

/**
 * Message types the provider accepts and emits during a tool-using session.
 *
 * `assistant` content is nullable: when the model issues only tool calls and no
 * text body, content is null. Matches the `capture_messages.content` nullable
 * column and the Vercel AI SDK's assistant-message shape.
 *
 * `role: 'tool'` carries one tool result per Message. The DB stores tool results
 * as an array (`capture_messages.toolResult: Array<...>`) because a single
 * assistant turn can produce multiple tool calls that resolve into multiple
 * results in one logical "tool turn." When rehydrating a session from the DB
 * for the agent loop, callers must EXPAND each `tool`-role row's array into
 * one `Message` entry per array element. Stage 3 will provide that helper.
 */
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; result: unknown };

/**
 * Result of one `completeWithTools` call. Either the model returned a
 * final structured response, or it issued tool calls that the caller
 * needs to dispatch and reinvoke with the results.
 *
 * NOTE: All current SDK-backed providers (OpenAI, Anthropic, Local) delegate
 * the tool-dispatch loop to the Vercel AI SDK and always return
 * `kind: 'response'` with `toolCallsUsed` listing the tools the SDK fired
 * internally. The `kind: 'tool_calls'` variant is currently UNREACHABLE for
 * those providers and is reserved for a future provider that yields mid-loop
 * (e.g., a streaming implementation that surfaces tool calls before
 * dispatching). Stage 3's agent loop should call `completeWithTools`
 * expecting `kind: 'response'` always; FakeProvider's scripted mode also
 * resolves to `kind: 'response'` after running scripted tool steps.
 */
export type CompleteWithToolsResult<T> =
  | {
      kind: 'response';
      value: T;
      /** Tool calls the model made and that the runtime executed during this call. */
      toolCallsUsed: ToolCall[];
      telemetry: {
        costUsdCents: number;
        durationMs: number;
        cachedTokens: number;
        uncachedPromptTokens: number;
        completionTokens: number;
      };
    }
  | {
      kind: 'tool_calls';
      calls: ToolCall[];
      telemetry: {
        costUsdCents: number;
        durationMs: number;
        cachedTokens: number;
        uncachedPromptTokens: number;
        completionTokens: number;
      };
    };

/**
 * One event yielded by `streamWithTools`. The stream begins with zero or more
 * `tool-start` events (one per tool the model calls during retrieval),
 * followed by `text-delta` events as the structured output's text fields
 * stream in, and ends with one `final` event carrying the validated value
 * plus telemetry. `error` may appear at any point and terminates the stream.
 */
export type StreamEvent<T> =
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'final'; value: T; toolCallsUsed: ToolCall[]; telemetry: {
      costUsdCents: number;
      durationMs: number;
      cachedTokens: number;
      uncachedPromptTokens: number;
      completionTokens: number;
    } }
  | { kind: 'error'; message: string };
