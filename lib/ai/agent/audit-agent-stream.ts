/**
 * Streaming variant of runAuditAgent. Yields progressive events as the
 * model thinks, calls retrieval tools, and emits the structured per-turn
 * response. Persists the assistant turn after the final event.
 *
 * The chat route consumes this generator and re-emits each event as NDJSON
 * over SSE-style chunked HTTP. The client renders text deltas progressively.
 */

import { getProviderForFunction } from '@/lib/ai/provider';
import type { StreamEvent } from '@/lib/ai/tool-use-types';
import {
  AuditResponseSchema,
  AuditResponseJsonSchema,
  type AuditResponse,
} from './audit-response-schema';
import { buildAgentCall, persistAssistantTurn, type AuditAgentInput } from './audit-agent';

export type AuditStreamEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'final'; response: AuditResponse; toolCallsUsed: number }
  | { kind: 'error'; message: string };

export async function* streamAuditAgent(
  input: AuditAgentInput,
): AsyncGenerator<AuditStreamEvent, void, unknown> {
  yield { kind: 'session', sessionId: input.sessionId };

  let built;
  try {
    built = await buildAgentCall(input);
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  const provider = await getProviderForFunction('capture-chat-agent');

  let finalValue: AuditResponse | null = null;
  let finalToolCallsUsed: { id: string; toolName: string; args: Record<string, unknown> }[] = [];

  try {
    const stream = provider.streamWithTools<AuditResponse>({
      systemPrompt: built.systemPrompt,
      messages: built.messages,
      tools: built.tools,
      schemaName: 'audit_response',
      jsonSchema: AuditResponseJsonSchema,
      validate: (raw) => AuditResponseSchema.parse(raw),
      maxToolCalls: 2,
    });

    for await (const ev of stream as AsyncIterable<StreamEvent<AuditResponse>>) {
      if (ev.kind === 'tool-start') {
        yield { kind: 'tool-start', toolName: ev.toolName, args: ev.args };
      } else if (ev.kind === 'text-delta') {
        yield { kind: 'text-delta', delta: ev.delta };
      } else if (ev.kind === 'final') {
        finalValue = ev.value;
        finalToolCallsUsed = ev.toolCallsUsed;
      } else if (ev.kind === 'error') {
        yield { kind: 'error', message: ev.message };
        return;
      }
    }
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  if (!finalValue) {
    yield { kind: 'error', message: 'stream ended without a final response' };
    return;
  }

  try {
    await persistAssistantTurn({
      sessionId: input.sessionId,
      courseCode: input.courseCode,
      isOpeningTurn: built.isOpeningTurn,
      userTurnIndex: built.userTurnIndex,
      response: finalValue,
      toolCallsUsed: finalToolCallsUsed,
      instructorName: input.instructorName ?? null,
    });
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  yield {
    kind: 'final',
    response: finalValue,
    toolCallsUsed: finalToolCallsUsed.length,
  };
}
