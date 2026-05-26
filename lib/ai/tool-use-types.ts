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

/** Message types the provider accepts and emits during a tool-using session. */
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; result: unknown };

/**
 * Result of one `completeWithTools` call. Either the model returned a
 * final structured response, or it issued tool calls that the caller
 * needs to dispatch and reinvoke with the results.
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
