import { buildLedger, type LedgerEvent } from '../ledger';
import { checkTurn, engineState } from '../engine';
import type { EvidenceMap } from '../evidence-map';

/**
 * Fold events like buildLedger, but apply each `asked` event only if checkTurn accepts it against
 * the state built from the events before it. An illegal turn throws, failing the test.
 */
export function play(map: EvidenceMap | null, events: LedgerEvent[]) {
  const applied: LedgerEvent[] = [];
  events.forEach((ev, i) => {
    if (ev.type === 'asked') {
      const ledger = buildLedger(map, applied);
      const r = checkTurn(engineState(map, ledger), ledger, ev.turn);
      if (!r.ok) throw new Error(`illegal turn #${i} ${JSON.stringify(ev.turn)}: ${r.sendBack}`);
    }
    applied.push(ev);
  });
  const ledger = buildLedger(map, applied);
  return { ledger, state: engineState(map, ledger) };
}

/** n legal counted questions: each re-asks the first open slot of the current stage, never answered. */
export function exhaust(map: EvidenceMap | null, n: number): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (let i = 0; i < n; i++) {
    const state = engineState(map, buildLedger(map, events));
    const slot = state.openSlots[0]!;
    const kind = state.mustRecap ? 'recap' : 'question';
    events.push({ type: 'asked', turn: { stage: state.stage, slot, kind } });
  }
  return events;
}
