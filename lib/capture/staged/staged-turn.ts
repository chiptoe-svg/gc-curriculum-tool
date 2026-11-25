/**
 * One turn of the staged interview (plan 2026-11-25, Task 6, with the controller decisions in
 * .superpowers/sdd/2026-11-25-interview-stages/task-6-decisions.md).
 *
 * The ledger is never kept in memory between turns: it is rebuilt every turn from the stored rows
 * (ledgerEventsFromTranscript), so a reload, a resumed session and synthesis all see the same record.
 * Per assistant row, in stored order: its `finish` (staged.finishRequested), its accepted record_answer
 * calls, then its `asked` turn (staged block). A user row that is a skip message is a `skip` event.
 */
import { loadPrompt } from '@/lib/ai/prompts/load';
import { loadSkill } from '@/lib/ai/skills/load-skill';
import { appendMessage, getSessionMessages } from '@/lib/db/capture-messages-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getInterviewSession, type InterviewSessionRow } from '@/lib/db/capture-interview-sessions-queries';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import { AiCreditsExhaustedError, isCreditsExhaustedError, markCreditsExhausted } from '@/lib/ai/credit-status';
import {
  captureRetrievedChunks, includedMaterialsOf, persistAssistantTurn, renderAtRestContext,
  type AuditAgentInput, type AuditAgentResult,
} from '@/lib/ai/agent/audit-agent';
import type { AuditStreamEvent } from '@/lib/ai/agent/audit-agent-stream';
import type { AuditResponse, AuditStagedBlock } from '@/lib/ai/agent/audit-response-schema';
import { citableFromHistory, keepValidCitations, repairCitations } from '@/lib/ai/agent/interview-controls';
import { piEndpointFor } from '@/lib/ai/agent/pi/endpoint';
import { runPiTurn, type PiTurnResult } from '@/lib/ai/agent/pi/turn';
import type { Message, StreamEvent, ToolCall } from '@/lib/ai/tool-use-types';
import type { EvidenceMap } from './evidence-map';
import { buildLedger, type AskedTurn, type Ledger, type LedgerEvent } from './ledger';
import { checkTurn, engineState, type EngineState } from './engine';
import { HARD_CAP, STAGES, type StageId } from './stages';
import { toAuditResponse } from './adapter';
import {
  RecordAnswerArgs, STAGED_SUBMIT_DESCRIPTION, StagedSubmitJsonSchema, StagedSubmitSchema, buildStagedTools, toSlotRecord,
  type LiveLedger, type StagedSubmit,
} from './staged-tools';

/** A stored capture_messages row, as much of it as the ledger needs. */
export type CaptureMessageRow = {
  role: string;
  content: string | null;
  toolCalls?: Array<{ id: string; toolName: string; args: Record<string, unknown> }> | null;
};

export type StagedAgentInput = AuditAgentInput & { finish?: boolean };

const SKIP_RE = /^(skip|skip this question|move on|next question|pass)\.?$/i;
/** The instructor's skip: typed, or sent by the Skip button (which posts one of these phrases). */
export function isSkipMessage(text: string | null | undefined): boolean {
  return SKIP_RE.test((text ?? '').trim());
}

const MAX_TOOL_CALLS = 6;
export const WRONG_COURSE = 'session does not belong to this course';
export const ANSWER_ONLY_WITH_QUESTION = 'answer_only turns carry no question; put the question in a counted turn';
const RECENT_MESSAGES = 6;
const RECAP_SUMMARY_MAX = 500;

function stagedOf(row: CaptureMessageRow): AuditStagedBlock | null {
  if (row.role !== 'assistant' || !row.content) return null;
  try {
    const s = (JSON.parse(row.content) as { staged?: AuditStagedBlock }).staged;
    return s && typeof s === 'object' && typeof s.slotAsked === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** Ledger events from stored rows, in stored order (Ruling E). Task 7 (synthesis) imports this. */
export function ledgerEventsFromTranscript(rows: CaptureMessageRow[]): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  let lastSlot = '';
  for (const row of rows) {
    if (row.role === 'user') {
      if (isSkipMessage(row.content)) events.push({ type: 'skip', slot: lastSlot });
      continue;
    }
    if (row.role !== 'assistant') continue;
    const staged = stagedOf(row);
    if (staged?.finishRequested) events.push({ type: 'finish' });
    for (const tc of row.toolCalls ?? []) {
      if (tc.toolName !== 'record_answer') continue;
      const parsed = RecordAnswerArgs.safeParse(tc.args);
      if (parsed.success) events.push({ type: 'record', record: toSlotRecord(parsed.data) });
    }
    if (staged) {
      events.push({ type: 'asked', turn: { stage: staged.stage, slot: staged.slotAsked, kind: staged.kind } });
      if (staged.kind !== 'answer_only') lastSlot = staged.slotAsked;
    }
  }
  return events;
}

/** The note_for_lead notes, in order (synthesis shows them as `leadNotes`). */
export function leadNotesFromTranscript(rows: CaptureMessageRow[]): string[] {
  return rows.flatMap(r => (r.role === 'assistant' ? r.toolCalls ?? [] : []))
    .filter(tc => tc.toolName === 'note_for_lead' && typeof tc.args?.note === 'string')
    .map(tc => tc.args.note as string);
}

/** The part of the evidence map each stage needs; stages 1 and 6 get the whole map. */
const MAP_KEYS: Record<StageId, Array<keyof EvidenceMap> | 'all'> = {
  1: 'all',
  2: ['summary', 'graded_work', 'tests'],
  3: ['summary', 'graded_work', 'competencies'],
  4: ['summary', 'assumed_skills'],
  5: ['summary', 'competencies'],
  6: 'all',
};

function renderMapSection(map: EvidenceMap | null, stage: StageId): string {
  if (!map) return '(No evidence map: the materials could not be read. Ask instead of citing.)';
  const keys = MAP_KEYS[stage];
  const part = keys === 'all' ? map : Object.fromEntries(keys.map(k => [k, map[k]]));
  return JSON.stringify(part, null, 2);
}

/** The interview record block: settled slots, what this stage may ask, and the count. */
export function renderLedgerBlock(state: EngineState, ledger: Ledger): string {
  const settled = state.allSlots.filter(s => state.slotStatus[s] !== undefined);
  const answered = settled.length
    ? settled.map(s => `- ${s} (${state.slotStatus[s]}): ${ledger.slots[s]?.summary ?? ''}`.trimEnd()).join('\n')
    : '(nothing yet)';
  const stageTitle = STAGES[state.stage - 1]!.title;
  let open: string;
  if (state.done) open = 'Open in this stage: none. The interview is complete: ask nothing more. Answer only (kind answer_only, empty question).';
  else if (state.mustRecap) open = 'Open in this stage: recap. The next turn must be the recap (kind recap, slot recap), or one follow-up on it once it was asked.';
  else open = `Open in this stage: ${state.openSlots.join(', ') || '(none)'}`;
  return [
    `Current stage: ${state.stage} of 6 — ${stageTitle}`,
    `Answered so far:\n${answered}`,
    open,
    `Questions asked: ${state.questionsAsked} of ${HARD_CAP}`,
  ].join('\n\n');
}

function transcriptMessages(rows: Array<CaptureMessageRow & { id?: string }>): Message[] {
  return rows
    .filter(r => r.role === 'user' || r.role === 'assistant')
    .map((r): Message => (r.role === 'assistant'
      ? { role: 'assistant', content: r.content }
      : { role: 'user', content: `[messageId=${r.id ?? ''}]\n${r.content ?? ''}` }));
}

/** Chunk ids the evidence map cites (`source` fields): citable in every staged turn (decision 10). */
function mapChunkIds(map: EvidenceMap | null): string[] {
  if (!map) return [];
  return [...map.graded_work, ...map.tests, ...map.assumed_skills].map(x => x.source).filter(Boolean);
}

export interface StagedTurnOutcome {
  response: AuditResponse;
  toolCallsUsed: ToolCall[];
  /** The ledger and state after this turn (equal to a rebuild from the stored rows). */
  ledger: Ledger;
  state: EngineState;
  result: PiTurnResult<StagedSubmit>;
}

/** Run one staged turn and store it (user row first, then the assistant row). Throws on a model failure. */
export async function runStagedTurn(
  input: StagedAgentInput,
  session: InterviewSessionRow,
  onEvent?: (e: StreamEvent<AuditResponse>) => void,
): Promise<StagedTurnOutcome> {
  const { sessionId, courseCode, userMessage, instructorName } = input;
  // A session id from another course must never load that course's map and ledger (fix round 1).
  if (session.courseCode !== courseCode) throw new Error(WRONG_COURSE);
  const map = session.map;

  // 1. The user message, written as buildAgentCall writes it. Finish may arrive without one.
  const before = await getSessionMessages(courseCode, sessionId);
  if (!userMessage && before.length > 0 && !input.finish) {
    throw new Error('runStagedTurn: userMessage required when continuing an existing session');
  }
  if (userMessage) {
    await appendMessage({ sessionId, courseCode, turnIndex: before.length, role: 'user', content: userMessage, instructorName: instructorName ?? null });
  }
  const assistantTurnIndex = before.length + (userMessage ? 1 : 0);

  const [course, materials, rows] = await Promise.all([
    getCourseByCode(courseCode),
    listMaterialsByCourse(courseCode),
    getSessionMessages(courseCode, sessionId),
  ]);
  if (!course) throw new Error(`course not found: ${courseCode}`);

  // 2-3. Rebuild the ledger from stored rows; a Finish request adds one `finish` (at most once per session).
  const stored = ledgerEventsFromTranscript(rows);
  const finishRequested = input.finish === true && !buildLedger(map, stored).finished;
  const startEvents: LedgerEvent[] = finishRequested ? [...stored, { type: 'finish' }] : stored;
  const startState = engineState(map, buildLedger(map, startEvents));

  // 4. Context: core prompt + the active stage's skill (stage 6 when the recap is due).
  const bloom = process.env.INTERVIEW_BLOOM !== 'off';
  const skillStage: StageId = startState.mustRecap ? 6 : startState.stage;
  const systemPrompt = `${await loadPrompt('capture-interview-core')}\n\n${loadSkill(STAGES[skillStage - 1]!.skill, { bloom }).body}`;

  const fullTranscript = transcriptMessages(rows);
  const context = [
    renderAtRestContext(course, materials, 'index'),
    `# Evidence map (stage ${skillStage})\n\n${renderMapSection(map, skillStage)}`,
    `# Interview record\n\n${renderLedgerBlock(startState, buildLedger(map, startEvents))}`,
  ].join('\n\n');
  const messages: Message[] = [{ role: 'user', content: context }, ...fullTranscript.slice(-RECENT_MESSAGES)];
  if (messages[messages.length - 1]!.role !== 'user' || messages.length === 1) {
    messages.push({
      role: 'user',
      content: finishRequested
        ? 'The instructor pressed Finish. Deliver the recap now (kind recap, slot recap).'
        : 'Begin the interview now: ask the first open slot of stage 1, opening with what the materials show.',
    });
  }

  // 5. Forced search only for a readable file added in this session after the last assistant turn (decision 15).
  const lastAssistant = [...before].reverse().find(r => r.role === 'assistant') as { createdAt?: Date | string } | undefined;
  const requireSearchFirst = Boolean(userMessage && lastAssistant?.createdAt) && includedMaterialsOf(materials).some(m =>
    (m as { addedInSession?: string | null }).addedInSession === sessionId
    && new Date((m as { uploadedAt: Date | string }).uploadedAt).getTime() > new Date(lastAssistant!.createdAt!).getTime());

  const live: LiveLedger = { map, events: [...startEvents], accepted: new WeakSet(), bloom };
  const capture = captureRetrievedChunks(buildStagedTools(courseCode, live));
  // The stage is the app's (decision 5): the engine's stage after this turn's records so far.
  const current = (v: StagedSubmit) => {
    const ledger = buildLedger(map, live.events);
    const state = engineState(map, ledger);
    const turn: AskedTurn = { stage: state.stage, slot: v.slot_asked, kind: v.kind };
    return { ledger, state, turn };
  };
  const msgsForRepair = fullTranscript as Array<{ role: string; content: string | null }>;

  const endpoint = await piEndpointFor();
  const call = (forceSearch: boolean) => runPiTurn<StagedSubmit>({
    systemPrompt,
    messages,
    tools: capture.tools,
    userMessage,
    fileNames: [],
    courseCode,
    endpoint,
    requireSearchFirst: forceSearch,
    maxToolCalls: MAX_TOOL_CALLS,
    onEvent,
    submit: {
      jsonSchema: StagedSubmitJsonSchema as unknown as Record<string, unknown>,
      parse: raw => StagedSubmitSchema.parse(repairCitations(raw, msgsForRepair)),
      description: STAGED_SUBMIT_DESCRIPTION,
    },
    // checkTurn (decision 6; it already enforces the recap), plus: an uncounted turn may not carry a question
    // while the interview runs, or it would slip past the cap and the follow-up limits (fix round 1).
    checkSubmit: v => {
      const { ledger, state, turn } = current(v as StagedSubmit);
      if (turn.kind === 'answer_only' && (v as StagedSubmit).question.trim() !== '' && !state.done) return ANSWER_ONLY_WITH_QUESTION;
      const r = checkTurn(state, ledger, turn);
      return r.ok ? null : r.sendBack;
    },
  });
  let result: PiTurnResult<StagedSubmit>;
  try {
    result = await call(requireSearchFirst);
  } catch (err) {
    if (isPiCreditsError(err)) {
      await markCreditsExhausted('request', String(err).slice(0, 300)).catch(() => {});
      throw new AiCreditsExhaustedError(undefined, { cause: err });
    }
    if (!requireSearchFirst || !/\b400\b/.test(String(err))) throw err;
    console.warn(`[staged-interview] ${courseCode}: forced search rejected (${String(err).slice(0, 200)}); retrying without it`);
    live.events = [...startEvents];
    result = await call(false);
  }
  if (result.controlEvents.length) console.warn(`[staged-interview] ${courseCode}: pi controls: ${result.controlEvents.join(' | ')}`);

  // Citations (decision 10): retrieved this turn, cited earlier, or in the evidence map.
  const history = citableFromHistory(msgsForRepair);
  for (const id of mapChunkIds(map)) history.chunkIds.add(id);
  const allowed = { retrievedThisTurn: capture.retrieved, history };
  const submitted = result.value;
  const value = keepValidCitations(submitted, allowed);
  const dropped = submitted.citations.length - value.citations.length;
  if (dropped > 0) console.warn(`[staged-interview] ${courseCode}: dropped ${dropped} citation(s) the interviewer never saw`);

  // Re-check before storing (decision 7): a turn accepted after its send-backs ran out that still breaks the
  // rules is stored as answer_only, so it is not counted.
  const { ledger: atSubmit, state: stateAtSubmit, turn } = current(value);
  const check = checkTurn(stateAtSubmit, atSubmit, turn);
  const asked: AskedTurn = check.ok ? turn : { ...turn, kind: 'answer_only' };
  if (!check.ok) console.warn(`[staged-interview] ${courseCode}: turn broke the stage rules after send-backs (${check.sendBack}); stored as answer_only`);
  // An uncounted turn never shows a question, whoever chose answer_only (fix round 1).
  const shown: StagedSubmit = asked.kind === 'answer_only' ? { ...value, kind: 'answer_only', question: '' } : { ...value, kind: asked.kind };

  // Stored tool calls: every call except rejected record_answer calls (the ledger is rebuilt from them).
  // A record's citations pass the same check as the turn's; bad ones are dropped, the record is kept (fix round 1).
  let droppedFromRecords = 0;
  const toolCallsUsed: ToolCall[] = result.toolCallsUsed
    .filter(tc => tc.toolName !== 'record_answer' || live.accepted.has(tc.args))
    .map(tc => {
      if (tc.toolName !== 'record_answer') return tc;
      const raw = (tc.args.citations ?? []) as StagedSubmit['citations'];
      const kept = keepValidCitations(repairCitations({ citations: raw }, msgsForRepair), allowed).citations;
      droppedFromRecords += raw.length - kept.length;
      return { ...tc, args: { ...tc.args, citations: kept } };
    });
  if (droppedFromRecords > 0) console.warn(`[staged-interview] ${courseCode}: dropped ${droppedFromRecords} record_answer citation(s) the interviewer never saw`);
  // This turn's records, rebuilt from the stored (filtered) calls so the live ledger equals a rebuild.
  live.events = [
    ...startEvents,
    ...toolCallsUsed.flatMap((tc): LedgerEvent[] => {
      if (tc.toolName !== 'record_answer') return [];
      const parsed = RecordAnswerArgs.safeParse(tc.args);
      return parsed.success ? [{ type: 'record', record: toSlotRecord(parsed.data) }] : [];
    }),
  ];

  // The recap answer is recorded by the app when the model did not (decision 8).
  const prevStaged = lastAssistant ? stagedOf(lastAssistant as CaptureMessageRow) : null;
  const modelRecordedRecap = toolCallsUsed.some(tc => tc.toolName === 'record_answer' && tc.args.slot === 'recap');
  if (prevStaged?.kind === 'recap' && userMessage && !isSkipMessage(userMessage) && !modelRecordedRecap) {
    const args = { slot: 'recap', status: 'filled_by_instructor' as const, summary: userMessage.slice(0, RECAP_SUMMARY_MAX), citations: [] };
    toolCallsUsed.push({ id: 'app-recap', toolName: 'record_answer', args });
    live.events.push({ type: 'record', record: toSlotRecord(args) });
  }

  // 6. Adapt, attach the staged block and store.
  const ledger = buildLedger(map, [...live.events, { type: 'asked', turn: asked }]);
  const state = engineState(map, ledger);
  const response: AuditResponse = {
    ...toAuditResponse(shown, state, ledger),
    staged: {
      stage: asked.stage,
      stageTitle: STAGES[asked.stage - 1]!.title,
      stageProgress: state.stageProgress,
      questionsAsked: state.questionsAsked,
      cap: HARD_CAP,
      slotAsked: asked.slot,
      kind: asked.kind,
      ...(finishRequested ? { finishRequested: true } : {}),
    },
  };
  await persistAssistantTurn({
    sessionId,
    courseCode,
    isOpeningTurn: assistantTurnIndex === 0,
    userTurnIndex: assistantTurnIndex - 1,
    response,
    toolCallsUsed,
    instructorName: instructorName ?? null,
  });
  // Pi prices every turn (campus at $0); a failed write is logged, never shown.
  await recordSpend(result.telemetry?.costUsdCents ?? 0).catch(err => console.error(`[staged-interview] ${courseCode}: recordSpend failed`, err));
  return { response, toolCallsUsed, ledger, state, result };
}

async function sessionOrLookup(input: StagedAgentInput, session?: InterviewSessionRow | null): Promise<InterviewSessionRow> {
  const row = session ?? await getInterviewSession(input.sessionId);
  if (!row) throw new Error(`not a staged interview session: ${input.sessionId}`);
  if (row.courseCode !== input.courseCode) throw new Error(WRONG_COURSE);
  return row;
}

/** Non-streaming entry (runAuditAgent). */
export async function runStagedInterview(input: StagedAgentInput, session?: InterviewSessionRow | null): Promise<AuditAgentResult> {
  const { response, toolCallsUsed } = await runStagedTurn(input, await sessionOrLookup(input, session));
  return { response, toolCallsUsed: toolCallsUsed.length };
}

/** The chat screen's event stream: the same events as streamPiInterview (session is emitted by the caller). */
export async function* streamStagedInterview(
  input: StagedAgentInput,
  session?: InterviewSessionRow | null,
): AsyncGenerator<AuditStreamEvent, void, unknown> {
  const queue: AuditStreamEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  let outcome: StagedTurnOutcome | null = null;
  let failure: unknown = null;

  void (async () => runStagedTurn(input, await sessionOrLookup(input, session), e => {
    if (e.kind === 'tool-start') queue.push({ kind: 'tool-start', toolName: e.toolName, args: e.args });
    else if (e.kind === 'text-delta') queue.push({ kind: 'text-delta', delta: e.delta });
    wake?.();
  }))().then(o => { outcome = o; }, err => { failure = err; }).finally(() => { done = true; wake?.(); });

  for (;;) {
    while (queue.length) yield queue.shift()!;
    if (done) break;
    await new Promise<void>(r => { wake = r; });
    wake = null;
  }
  while (queue.length) yield queue.shift()!;

  if (failure || !outcome) {
    const err = failure ?? new Error('staged turn ended without a reply');
    const credits = err instanceof AiCreditsExhaustedError;
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err), ...(credits ? { code: 'ai_credits_exhausted' as const } : {}) };
    return;
  }
  const { response, toolCallsUsed } = outcome as StagedTurnOutcome;
  yield { kind: 'final', response, toolCallsUsed: toolCallsUsed.length };
}

function isPiCreditsError(err: unknown): boolean {
  return err instanceof AiCreditsExhaustedError || isCreditsExhaustedError(err) || /quota_denied|credits are exhausted/i.test(String(err));
}
