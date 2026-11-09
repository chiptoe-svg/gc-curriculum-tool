/**
 * The interview on Pi as the chat screen's event stream (Pi plan Task 3).
 * Same events as the current loop (session is emitted by the caller):
 * tool-start per tool call, text-delta while the reply streams, then final or
 * error. Stores the assistant turn exactly as the current loop does.
 */
import { AiCreditsExhaustedError, isCreditsExhaustedError } from '@/lib/ai/credit-status';
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
  const result = await runPiTurn({
    systemPrompt: built.systemPrompt,
    messages: built.messages,
    tools: capture.tools,
    userMessage: input.userMessage,
    fileNames: built.fileNames,
    courseCode: input.courseCode,
    endpoint: await piEndpointFor(),
    maxToolCalls: 4,
    onEvent,
  });
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
    const credits = err instanceof AiCreditsExhaustedError || isCreditsExhaustedError(err) || /quota_denied|credits are exhausted/i.test(String(err));
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
