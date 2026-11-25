import type { EvidenceMap } from './evidence-map';
import { isFilled, type AskedTurn, type Ledger, type SlotStatus } from './ledger';
import { HARD_CAP, MAX_FOLLOW_UPS, STAGES, type StageId } from './stages';

export { isFilled } from './ledger';

export type EngineState = {
  stage: StageId;
  /** Unfilled slots of the current stage, in order. */
  openSlots: string[];
  /** Counted questions: kinds question, follow_up, recap. */
  questionsAsked: number;
  followUpsUsed: number;
  mustRecap: boolean;
  done: boolean;
  stageProgress: Array<{ id: StageId; title: string; status: 'done' | 'active' | 'upcoming' }>;
  /** Effective status of every slot: stored, or computed `not_reached` for closed stages. Unsettled slots are absent. */
  slotStatus: Record<string, SlotStatus | undefined>;
  /** Every slot of every stage, given the current anchors and map. */
  allSlots: string[];
};

/** The global cap wins: after this many counted questions the next turn is the recap. */
const RECAP_AT = HARD_CAP - 1;

const isCounted = (t: AskedTurn) => t.kind !== 'answer_only';

export function engineState(map: EvidenceMap | null, ledger: Ledger): EngineState {
  const counted = ledger.asked.filter(isCounted);
  const questionsAsked = counted.length;
  const followUpsUsed = ledger.asked.filter((t) => t.kind === 'follow_up').length;
  const stage6Spent = counted.filter((t) => t.stage === 6).length >= STAGES[5]!.cap;
  const mustRecap = ledger.finished || questionsAsked >= RECAP_AT || stage6Spent;
  // The active stage never moves backwards: a stage at or before the latest one asked in stays closed.
  const floor = counted.reduce((m, t) => Math.max(m, t.stage), 1);

  const slotStatus: EngineState['slotStatus'] = {};
  let current: StageId | null = null;
  let openSlots: string[] = [];
  const closed = new Map<StageId, boolean>();
  const allSlots: string[] = [];

  for (const stage of STAGES) {
    const slots = stage.slots(map, ledger.anchors);
    const stageCounted = counted.filter((t) => t.stage === stage.id).length;
    const allFilled = slots.every((s) => isFilled(ledger.slots[s]));
    let isClosed: boolean;
    if (stage.id === 6) {
      // The close needs the recap answered; a spent stage cap alone does not skip it.
      isClosed = isFilled(ledger.slots['recap']);
    } else {
      isClosed = allFilled || stageCounted >= stage.cap || mustRecap || stage.id < floor;
    }
    closed.set(stage.id, isClosed);
    allSlots.push(...slots);
    const forceClose = isClosed || (mustRecap && stage.id === 6);
    for (const s of slots) {
      const rec = ledger.slots[s];
      if (rec) slotStatus[s] = rec.status;
      else if (forceClose && !(stage.id === 6 && s === 'recap')) slotStatus[s] = 'not_reached';
    }
    if (current === null && !isClosed) {
      current = stage.id;
      openSlots = mustRecap && stage.id === 6 ? ['recap'] : slots.filter((s) => !isFilled(ledger.slots[s]));
    }
  }

  const done = current === null;
  const stage: StageId = current ?? 6;
  return {
    stage,
    openSlots,
    questionsAsked,
    followUpsUsed,
    mustRecap,
    done,
    stageProgress: STAGES.map((s) => ({
      id: s.id,
      title: s.title,
      status: closed.get(s.id) ? 'done' : s.id === stage ? 'active' : 'upcoming',
    })),
    slotStatus,
    allSlots,
  };
}

export function checkTurn(
  state: EngineState,
  ledger: Ledger,
  turn: AskedTurn,
): { ok: true } | { ok: false; sendBack: string } {
  if (turn.kind === 'answer_only') return { ok: true };

  if (state.questionsAsked >= HARD_CAP) {
    return { ok: false, sendBack: 'The question limit is reached. Do not ask anything more.' };
  }
  if (state.done) {
    return { ok: false, sendBack: 'The interview is finished. Do not ask anything more.' };
  }
  const recapFollowUp = turn.kind === 'follow_up' && turn.slot === 'recap';
  if (state.mustRecap && turn.kind !== 'recap' && !recapFollowUp) {
    return { ok: false, sendBack: 'The interview is at its recap. Your next turn must be the recap, not another question.' };
  }

  const existing = ledger.slots[turn.slot];
  if (turn.kind === 'follow_up') {
    if (ledger.asked.some((t) => t.kind === 'follow_up' && t.slot === turn.slot)) {
      return { ok: false, sendBack: `You already used the one follow-up allowed on "${turn.slot}". Move on to the next open slot.` };
    }
    if (state.followUpsUsed >= MAX_FOLLOW_UPS) {
      return { ok: false, sendBack: `All ${MAX_FOLLOW_UPS} follow-ups are used. Ask the next open slot instead.` };
    }
    return { ok: true };
  }

  if (turn.kind === 'question' && existing) {
    const said = existing.summary ? ` Earlier you recorded: "${existing.summary}".` : '';
    return { ok: false, sendBack: `"${turn.slot}" is already settled (${existing.status}).${said} Do not ask it again; ask an open slot.` };
  }
  return { ok: true };
}

/**
 * Settled = any stored record or computed `not_reached`. Total counts every slot of every stage;
 * before anchors are recorded the missing `graded_on:` slots are counted as placeholders (settled
 * once stage 2 closes) so the total never grows and the percent never drops.
 */
export function settledCount(state: EngineState, ledger: Ledger): { settled: number; total: number } {
  let settled = state.allSlots.filter((id) => state.slotStatus[id] !== undefined).length;
  let total = state.allSlots.length;
  const phantoms = 2 - Math.min(2, ledger.anchors.length);
  total += phantoms;
  if (state.stageProgress.find((p) => p.id === 2)?.status === 'done') settled += phantoms;
  return { settled, total };
}
