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
import { AiCreditsExhaustedError } from '@/lib/ai/credit-status';
import { buildAgentCall, captureRetrievedChunks, checkTurnCitations, persistAssistantTurn, type AuditAgentInput } from './audit-agent';

export type AuditStreamEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'final'; response: AuditResponse; toolCallsUsed: number }
  | { kind: 'error'; message: string; code?: 'ai_credits_exhausted' };

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
  const capture = captureRetrievedChunks(built.tools);

  let finalValue: AuditResponse | null = null;
  let finalToolCallsUsed: { id: string; toolName: string; args: Record<string, unknown> }[] = [];

  // Forced search first; if the model or gateway rejects it before anything
  // reached the client, retry once without it (no worse than before the check).
  const attempts: Array<string[] | undefined> = built.requireToolFirst ? [built.requireToolFirst, undefined] : [undefined];
  for (const requireToolFirst of attempts) {
    let emitted = false;
    let rejected: string | null = null;
    try {
      const stream = provider.streamWithTools<AuditResponse>({
        systemPrompt: built.systemPrompt,
        messages: built.messages,
        tools: capture.tools,
        ...(requireToolFirst ? { requireToolFirst } : {}),
        schemaName: 'audit_response',
        jsonSchema: AuditResponseJsonSchema,
        validate: (raw) => AuditResponseSchema.parse(raw),
        // Bumped 2→4 (2026-06-11): full-mode turns can now query course materials
        // AND program memory (wiki/graph) in the same turn.
        maxToolCalls: 4,
      });

      for await (const ev of stream as AsyncIterable<StreamEvent<AuditResponse>>) {
        if (ev.kind === 'tool-start') {
          emitted = true;
          yield { kind: 'tool-start', toolName: ev.toolName, args: ev.args };
        } else if (ev.kind === 'text-delta') {
          emitted = true;
          yield { kind: 'text-delta', delta: ev.delta };
        } else if (ev.kind === 'final') {
          finalValue = checkTurnCitations(ev.value, built.messages, capture.retrieved, input.courseCode);
          finalToolCallsUsed = ev.toolCallsUsed;
        } else if (ev.kind === 'error') {
          if (requireToolFirst && !emitted) { rejected = ev.message; break; }
          yield { kind: 'error', message: ev.message };
          return;
        }
      }
    } catch (err) {
      if (requireToolFirst && !emitted && !(err instanceof AiCreditsExhaustedError)) {
        rejected = err instanceof Error ? err.message : String(err);
      } else {
        yield {
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          ...(err instanceof AiCreditsExhaustedError ? { code: err.code } : {}),
        };
        return;
      }
    }
    if (rejected === null) break;
    console.warn(`[audit-agent] ${input.courseCode}: forced search rejected (${rejected}); retrying without it`);
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
