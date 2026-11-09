/**
 * The interview on Pi as the chat screen's event stream (Pi plan Task 3).
 * Same events as the current loop (session is emitted by the caller):
 * tool-start per tool call, text-delta while the reply streams, then final or
 * error. Stores the assistant turn exactly as the current loop does.
 */
import { AiCreditsExhaustedError, isCreditsExhaustedError, markCreditsExhausted } from '@/lib/ai/credit-status';
import { captureRetrievedChunks, checkTurnCitations, persistAssistantTurn, type AuditAgentInput, type BuiltAgentCall } from '@/lib/ai/agent/audit-agent';
import type { AuditStreamEvent } from '@/lib/ai/agent/audit-agent-stream';
import type { AuditResponse } from '@/lib/ai/agent/audit-response-schema';
import type { StreamEvent, ToolCall } from '@/lib/ai/tool-use-types';
import { piEndpointFor } from './endpoint';
import { runPiTurn, type PiTurnResult } from './turn';

/** Run one Pi turn (no streaming): the reply after the citation check, plus what Pi reported. */
export async function runPiInterviewTurn(
  input: AuditAgentInput,
  built: BuiltAgentCall,
  onEvent?: (e: StreamEvent<AuditResponse>) => void,
): Promise<{ response: AuditResponse; toolCallsUsed: ToolCall[]; result: PiTurnResult }> {
  const capture = captureRetrievedChunks(built.tools);
  const endpoint = await piEndpointFor();
  const turn = (requireSearchFirst: boolean) => runPiTurn({
    systemPrompt: built.systemPrompt,
    messages: built.messages,
    tools: capture.tools,
    userMessage: input.userMessage,
    fileNames: built.fileNames,
    courseCode: input.courseCode,
    endpoint,
    requireSearchFirst,
    maxToolCalls: 4,
    onEvent,
  });
  let result: PiTurnResult;
  try {
    result = await turn(Boolean(built.requireToolFirst));
  } catch (err) {
    if (isPiCreditsError(err)) {
      // Same as the current loop: record it (banner + owner alert) and show the friendly message (review I3).
      await markCreditsExhausted('request', String(err).slice(0, 300)).catch(() => {});
      throw new AiCreditsExhaustedError(undefined, { cause: err });
    }
    // A forced search the endpoint rejects must not cost the turn: retry once without it (review I2).
    if (!built.requireToolFirst || !/\b400\b/.test(String(err))) throw err;
    console.warn(`[audit-agent] ${input.courseCode}: forced search rejected (${String(err).slice(0, 200)}); retrying without it`);
    result = await turn(false);
  }
  if (result.controlEvents.length) console.warn(`[audit-agent] ${input.courseCode}: pi controls: ${result.controlEvents.join(' | ')}`);
  const response = checkTurnCitations(result.value, built.messages, capture.retrieved, input.courseCode);
  return { response, toolCallsUsed: result.toolCallsUsed, result };
}

export async function* streamPiInterview(input: AuditAgentInput, built: BuiltAgentCall): AsyncGenerator<AuditStreamEvent, void, unknown> {
  const queue: AuditStreamEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  let outcome: { response: AuditResponse; toolCallsUsed: ToolCall[] } | null = null;
  let failure: unknown = null;

  void runPiInterviewTurn(input, built, e => {
    if (e.kind === 'tool-start') queue.push({ kind: 'tool-start', toolName: e.toolName, args: e.args });
    else if (e.kind === 'text-delta') queue.push({ kind: 'text-delta', delta: e.delta });
    wake?.();
  }).then(o => { outcome = o; }, err => { failure = err; }).finally(() => { done = true; wake?.(); });

  for (;;) {
    while (queue.length) yield queue.shift()!;
    if (done) break;
    await new Promise<void>(r => { wake = r; });
    wake = null;
  }

  if (failure || !outcome) {
    const err = failure ?? new Error('Pi turn ended without a reply');
    const credits = err instanceof AiCreditsExhaustedError;
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err), ...(credits ? { code: 'ai_credits_exhausted' as const } : {}) };
    return;
  }
  const { response, toolCallsUsed } = outcome as { response: AuditResponse; toolCallsUsed: ToolCall[] };
  try {
    await persistAssistantTurn({
      sessionId: input.sessionId,
      courseCode: input.courseCode,
      isOpeningTurn: built.isOpeningTurn,
      userTurnIndex: built.userTurnIndex,
      response,
      toolCallsUsed,
      instructorName: input.instructorName ?? null,
    });
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }
  yield { kind: 'final', response, toolCallsUsed: toolCallsUsed.length };
}

/** Pi reports a gateway quota error as text in its error message. */
function isPiCreditsError(err: unknown): boolean {
  return err instanceof AiCreditsExhaustedError || isCreditsExhaustedError(err) || /quota_denied|credits are exhausted/i.test(String(err));
}

