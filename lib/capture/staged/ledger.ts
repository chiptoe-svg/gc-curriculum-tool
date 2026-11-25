import type { EvidenceMap } from './evidence-map';
import { STAGES, type StageId } from './stages';

export type SlotStatus = 'filled_from_materials' | 'filled_by_instructor' | 'unknown' | 'not_reached';

export type SlotRecord = {
  slot: string;
  status: SlotStatus;
  summary: string;
  citations: Array<{ type: 'chunk' | 'instructor'; chunkId: string | null; messageId: string | null; excerpt: string }>;
};

export type AskedTurn = {
  stage: StageId;
  slot: string;
  kind: 'question' | 'follow_up' | 'recap' | 'answer_only';
};

export type Ledger = {
  anchors: string[];
  slots: Record<string, SlotRecord | undefined>;
  asked: AskedTurn[];
  /** True once a `finish` event was seen (the instructor chose Finish). */
  finished: boolean;
};

export type LedgerEvent =
  | { type: 'record'; record: SlotRecord }
  | { type: 'asked'; turn: AskedTurn }
  | { type: 'skip'; slot: string }
  | { type: 'finish' };

/** Any stored record counts as filled, whatever its status. */
export function isFilled(s: SlotRecord | undefined): boolean {
  return s !== undefined;
}

function parseAnchors(rec: SlotRecord | undefined): string[] {
  if (!rec || (rec.status !== 'filled_by_instructor' && rec.status !== 'filled_from_materials')) return [];
  return rec.summary.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 2);
}

/** Fold stored events into a ledger. Pure; the same events always give the same ledger. */
export function buildLedger(map: EvidenceMap | null, events: LedgerEvent[]): Ledger {
  const ledger: Ledger = { anchors: [], slots: {}, asked: [], finished: false };
  for (const ev of events) {
    if (ev.type === 'record') {
      ledger.slots[ev.record.slot] = ev.record;
      if (ev.record.slot === 'anchors') ledger.anchors = parseAnchors(ev.record);
    } else if (ev.type === 'asked') {
      ledger.asked.push(ev.turn);
    } else if (ev.type === 'skip') {
      const last = [...ledger.asked].reverse().find((t) => t.kind !== 'answer_only');
      if (!last) continue;
      ledger.slots[last.slot] = { slot: last.slot, status: 'unknown', summary: 'instructor skipped', citations: [] };
      if (last.slot === 'anchors') ledger.anchors = [];
    } else if (ev.type === 'finish') {
      ledger.finished = true;
      for (const stage of STAGES) {
        if (stage.id === 6) continue;
        for (const slot of stage.slots(map, ledger.anchors)) {
          if (!isFilled(ledger.slots[slot])) {
            ledger.slots[slot] = { slot, status: 'not_reached', summary: '', citations: [] };
          }
        }
      }
    }
  }
  return ledger;
}
