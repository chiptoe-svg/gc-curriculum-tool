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
  /** Highest stage (1-5) closed so far, 0 if none. Event-ordered and monotonic: a closed stage never reopens. */
  closedThrough: StageId | 0;
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

const ANCHOR_MAX = 80;
/** Containment needs this many characters in the shorter string, so "a" or "Lab" does not match every title. */
const MIN_MATCH = 4;

/** The evidence-map graded-work title a line names (Task 9b fix 3): exact, then line ⊇ title (longest), then title ⊇ line. */
function matchTitle(line: string, map: EvidenceMap | null): string | null {
  const titles = (map?.graded_work ?? []).map((g) => g.title.trim()).filter((t) => t.length > 0);
  const l = line.toLowerCase();
  const exact = titles.find((t) => t.toLowerCase() === l);
  if (exact) return exact;
  const inLine = titles.filter((t) => t.length >= MIN_MATCH && l.includes(t.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  if (inLine) return inLine;
  return l.length >= MIN_MATCH ? titles.find((t) => t.toLowerCase().includes(l)) ?? null : null;
}

function parseAnchors(rec: SlotRecord | undefined, map: EvidenceMap | null): string[] {
  if (!rec || (rec.status !== 'filled_by_instructor' && rec.status !== 'filled_from_materials')) return [];
  const lines = rec.summary
    .split('\n')
    // Models often list the two titles; a bullet or number would leak into the graded_on slot ids.
    .map((l) => l.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s*)/, '').trim())
    .filter((l) => l.length > 0)
    .map((l) => matchTitle(l, map) ?? l.slice(0, ANCHOR_MAX).trim());
  return [...new Set(lines)].slice(0, 2);
}

/** The two graded-work titles with the highest weight (leading number of `weight`); ties and missing weights keep map order. */
export function topGradedWork(map: EvidenceMap | null): string[] {
  const num = (w: string | null) => {
    const m = /^\s*(\d+(?:\.\d+)?)/.exec(w ?? '');
    return m ? Number(m[1]) : -Infinity;
  };
  const ranked = (map?.graded_work ?? [])
    .map((g, i) => ({ title: g.title.trim(), w: num(g.weight), i }))
    .filter((g) => g.title.length > 0)
    .sort((a, b) => (b.w === a.w ? a.i - b.i : b.w - a.w))
    .map((g) => g.title);
  return [...new Set(ranked)].slice(0, 2);
}

/**
 * Task 9b fix 2. When stage 1 has closed (and stage 2 has not) without anchors from the instructor (unknown,
 * skipped, or never recorded) and the map has graded work, the app fills `anchors` from the map: the summary to
 * record as filled_from_materials, or null when the fallback does not apply.
 */
export function anchorFallback(map: EvidenceMap | null, ledger: Ledger): string | null {
  if (ledger.finished || ledger.closedThrough !== 1 || ledger.anchors.length > 0) return null;
  const rec = ledger.slots['anchors'];
  if (rec && rec.status !== 'unknown' && rec.status !== 'not_reached') return null;
  const top = topGradedWork(map);
  return top.length > 0 ? top.join('\n') : null;
}

/** Fold stored events into a ledger. Pure; the same events always give the same ledger. */
const RECAP_AT = 19;

/** Close the lowest open stage while it is complete (all slots filled, or counted at cap). Monotonic. */
function advance(map: EvidenceMap | null, ledger: Ledger): void {
  const counted = ledger.asked.filter((t) => t.kind !== 'answer_only');
  if (ledger.finished || counted.length >= RECAP_AT) {
    ledger.closedThrough = 5;
    return;
  }
  while (ledger.closedThrough < 5) {
    const stage = STAGES[ledger.closedThrough]!;
    const slots = stage.slots(map, ledger.anchors);
    const full = slots.every((s) => isFilled(ledger.slots[s]));
    const atCap = counted.filter((t) => t.stage === stage.id).length >= stage.cap;
    if (!full && !atCap) return;
    ledger.closedThrough = stage.id as StageId;
  }
}

/** Anchors freeze once a graded_on slot has been asked (counted) or recorded, or stage 2 has closed. */
function anchorsFrozen(ledger: Ledger): boolean {
  return (
    ledger.closedThrough >= 2 ||
    ledger.asked.some((t) => t.kind !== 'answer_only' && t.slot.startsWith('graded_on:')) ||
    Object.keys(ledger.slots).some((k) => k.startsWith('graded_on:'))
  );
}

export function buildLedger(map: EvidenceMap | null, events: LedgerEvent[]): Ledger {
  const ledger: Ledger = { anchors: [], slots: {}, asked: [], finished: false, closedThrough: 0 };
  for (const ev of events) {
    if (ev.type === 'record') {
      ledger.slots[ev.record.slot] = ev.record;
      // Anchors follow the latest record until a graded_on slot is asked or recorded (or stage 2 closes);
      // then they freeze so graded_on slot ids never change. Other stage-2 questions do not freeze them.
      if (ev.record.slot === 'anchors' && (ledger.anchors.length === 0 || !anchorsFrozen(ledger))) {
        const next = parseAnchors(ev.record, map);
        if (next.length > 0) ledger.anchors = next;
      }
    } else if (ev.type === 'asked') {
      ledger.asked.push(ev.turn);
    } else if (ev.type === 'skip') {
      const last = [...ledger.asked].reverse().find((t) => t.kind !== 'answer_only');
      if (!last) continue;
      // Skipping never erases an answer already recorded.
      if (isFilled(ledger.slots[last.slot])) continue;
      ledger.slots[last.slot] = { slot: last.slot, status: 'unknown', summary: 'instructor skipped', citations: [] };
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
    advance(map, ledger);
  }
  return ledger;
}
