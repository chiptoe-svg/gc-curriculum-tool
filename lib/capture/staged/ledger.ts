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
const INDEX_PREFIX = /^\[[A-Z]?\d+\]\s*/;

/** Strip a pre-read material-index prefix ("[B6] "), trim. Uncapped: for matching. */
const stripTitle = (t: string) => t.trim().replace(INDEX_PREFIX, '').trim();

/**
 * The one title shape for anchors (Task 9b fix round 1): no "[A6]"-style prefix, trimmed, at most 80 characters.
 * Used for matched, unmatched and fallback anchors, so graded_on slot ids stay short and the interviewer never
 * says the prefixes.
 */
export function anchorTitle(t: string): string {
  return stripTitle(t).slice(0, ANCHOR_MAX).trim();
}

/** The evidence-map graded-work title a line names (Task 9b fix 3): exact, then line ⊇ title (longest), then title ⊇ line. */
function matchTitle(line: string, map: EvidenceMap | null): string | null {
  const titles = (map?.graded_work ?? []).map((g) => stripTitle(g.title)).filter((t) => t.length > 0);
  const l = stripTitle(line).toLowerCase();
  const exact = titles.find((t) => t.toLowerCase() === l);
  const inLine = titles.filter((t) => t.length >= MIN_MATCH && l.includes(t.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  const hit = exact ?? inLine ?? (l.length >= MIN_MATCH ? titles.find((t) => t.toLowerCase().includes(l)) : undefined);
  return hit ? anchorTitle(hit) : null;
}

function parseAnchors(rec: SlotRecord | undefined, map: EvidenceMap | null): string[] {
  if (!rec || (rec.status !== 'filled_by_instructor' && rec.status !== 'filled_from_materials')) return [];
  const lines = rec.summary
    .split('\n')
    // Models often list the two titles; a bullet or number would leak into the graded_on slot ids.
    .map((l) => l.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s*)/, '').trim())
    .filter((l) => l.length > 0)
    .map((l) => matchTitle(l, map) ?? anchorTitle(l))
    .filter((l) => l.length > 0);
  return [...new Set(lines)].slice(0, 2);
}

/** Within this much share (0.05 = 5 points), work with a rubric or deliverables wins: stage 2 asks what strong work looks like. */
const NEAR_TIE = 0.05;

/**
 * The two graded works that carry the most of the grade (Task 9b fix round 1), ranked by SHARE:
 * - a "%" weight is its own share;
 * - a points weight (any other leading number) is its points ÷ the sum of all point weights in the map;
 * - no weight ranks last, in map order.
 * Each pick takes, among items within NEAR_TIE of the highest remaining share, one with rubric criteria or
 * deliverables first, then the higher share, then map order. Exams are never dropped, only outranked.
 */
export function topGradedWork(map: EvidenceMap | null): string[] {
  const lead = (w: string | null) => {
    const m = /^\s*(\d+(?:\.\d+)?)/.exec(w ?? '');
    return m ? Number(m[1]) : null;
  };
  const items = (map?.graded_work ?? []).map((g, i) => {
    const n = lead(g.weight);
    const pct = n !== null && /%/.test(g.weight ?? '');
    return { title: anchorTitle(g.title), n, pct, i, described: g.rubric_criteria.length > 0 || Boolean(g.deliverables?.trim()) };
  }).filter((g) => g.title.length > 0);
  const pointsTotal = items.filter((g) => g.n !== null && !g.pct).reduce((s, g) => s + g.n!, 0);
  const ranked = items.map((g) => ({
    ...g,
    share: g.n === null ? null : g.pct ? g.n / 100 : pointsTotal > 0 ? g.n / pointsTotal : 0,
  }));
  const weighted = ranked.filter((g) => g.share !== null);
  const out: string[] = [];
  while (weighted.length > 0 && out.length < 2) {
    const top = Math.max(...weighted.map((g) => g.share!));
    const pick = weighted
      .filter((g) => g.share! >= top - NEAR_TIE - 1e-9)
      .sort((a, b) => Number(b.described) - Number(a.described) || b.share! - a.share! || a.i - b.i)[0]!;
    weighted.splice(weighted.indexOf(pick), 1);
    if (!out.includes(pick.title)) out.push(pick.title);
  }
  for (const g of ranked) if (g.share === null && out.length < 2 && !out.includes(g.title)) out.push(g.title);
  return out;
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
