/**
 * Blind A/B pairing, unblinding, and the pre-committed decision rule for the
 * agents-vs-single-calls benchmark. Pure functions: no DB, no network, no model calls.
 */
import type { Cell } from './score-arms';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PairInput { course: string; sub: string; name?: string; baseline: Cell; candidates: Array<{ label: string; cell: Cell }> }
export interface BlindPair { id: string; course: string; competency: string; A: Cell; B: Cell }
export type Winner = 'A' | 'B' | 'tie';
export interface Verdict { id: string; winner: Winner; reason?: string }
export type BlindKey = Record<string, { A: string; B: string }>;

/** One pair per (competency, candidate). A/B is flipped by a seeded RNG; the key maps pair id to labels. */
export function makePairs(inputs: PairInput[], seed: number): { pairs: BlindPair[]; key: BlindKey; seed: number } {
  const rnd = mulberry32(seed);
  const pairs: BlindPair[] = [];
  const key: BlindKey = {};
  let n = 0;
  for (const p of inputs) for (const c of p.candidates) {
    const id = `pair-${String(++n).padStart(4, '0')}`;
    const flip = rnd() < 0.5;
    pairs.push({ id, course: p.course, competency: p.name ?? p.sub, A: flip ? c.cell : p.baseline, B: flip ? p.baseline : c.cell });
    key[id] = flip ? { A: c.label, B: 'baseline' } : { A: 'baseline', B: c.label };
  }
  return { pairs, key, seed };
}

/** Map a verdict's A/B winner back to its label ('baseline', an arm label, or 'tie'). */
export function unblind(key: BlindKey, id: string, winner: Winner): string {
  if (winner === 'tie') return 'tie';
  const k = key[id];
  if (!k) throw new Error(`no key entry for ${id}`);
  return k[winner];
}

/** Second-judge sample: 20% of pair ids, drawn with its own seed (reproducible). */
export function secondJudgeIds(pairs: BlindPair[], seed: number, fraction = 0.2): string[] {
  const rnd = mulberry32(seed);
  const ids = pairs.map(p => p.id);
  const want = Math.round(ids.length * fraction);
  const picked = new Set<string>();
  // Partial Fisher-Yates on a copy so the draw is uniform without replacement.
  const pool = [...ids];
  for (let i = 0; i < want && i < pool.length; i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    picked.add(pool[i]!);
  }
  return ids.filter(id => picked.has(id));
}

/** Per-arm row from summary.json (label 'baseline' or '<arm> / <model>'). null = not measurable. */
export interface SummaryRow { label: string; cells: number; breaks: number | null; stability: number | null }

export interface ArmTally {
  label: string;
  wins: number; losses: number; ties: number;
  /** wins / (wins + losses); null when there are no non-tie verdicts. */
  prefExTies: number | null;
  /** Share of non-tie verdicts won by the A position, over all pairs (bias check). */
  aPositionRate: number | null;
  /** Agreement with the second judge on overlapping pairs for this label; null if no overlap. */
  agreement: number | null;
  breaks: number | null; baselineBreaks: number | null;
  stability: number | null; baselineStability: number | null;
  adopt: boolean;
  reasons: string[];
}

export interface TallyInput {
  key: BlindKey;
  verdicts: Verdict[];
  summary: SummaryRow[];
  second?: Verdict[];
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

/** Apply the pre-committed rule: adopt only if breaks < baseline AND pref >= 50% ex-ties AND stability >= baseline. */
export function tallyBlind({ key, verdicts, summary, second }: TallyInput): ArmTally[] {
  const base = summary.find(r => r.label === 'baseline');
  if (!base) throw new Error('summary has no baseline row');
  const labels = [...new Set(Object.values(key).map(k => (k.A === 'baseline' ? k.B : k.A)))];
  const winnerOf = (vs: Verdict[]) => new Map(vs.map(v => [v.id, unblind(key, v.id, v.winner)]));
  const primary = winnerOf(verdicts);
  const secondary = second ? winnerOf(second) : null;

  // A-position rate over all non-tie verdicts (bias check: should sit near 50%).
  const nonTie = verdicts.filter(v => v.winner !== 'tie');
  const aPos = nonTie.length ? nonTie.filter(v => v.winner === 'A').length / nonTie.length : null;

  return labels.map(label => {
    const ids = Object.keys(key).filter(id => key[id]!.A === label || key[id]!.B === label);
    let wins = 0, losses = 0, ties = 0;
    for (const id of ids) {
      const w = primary.get(id);
      if (w === undefined) continue;
      if (w === 'tie') ties++;
      else if (w === label) wins++;
      else if (w === 'baseline') losses++;
    }
    const prefExTies = wins + losses ? wins / (wins + losses) : null;

    let agreement: number | null = null;
    if (secondary) {
      const overlap = ids.filter(id => primary.has(id) && secondary.has(id));
      if (overlap.length) agreement = overlap.filter(id => primary.get(id) === secondary.get(id)).length / overlap.length;
    }

    const row = summary.find(r => r.label === label);
    const breaks = row?.breaks ?? null, baselineBreaks = base.breaks;
    const stability = row?.stability ?? null, baselineStability = base.stability;

    const reasons: string[] = [];
    if (breaks === null || baselineBreaks === null) reasons.push('breaks not measurable');
    else if (!(breaks < baselineBreaks)) reasons.push(`breaks ${breaks} not fewer than baseline ${baselineBreaks}`);
    if (prefExTies === null) reasons.push('no non-tie verdicts');
    else if (!(prefExTies >= 0.5)) reasons.push(`preference ${pct(prefExTies)} below 50% ex-ties`);
    if (stability === null) reasons.push('stability not measurable (needs 2+ runs)');
    if (baselineStability === null) reasons.push('baseline stability undefined (single stored run)');
    else if (stability !== null && !(stability >= baselineStability)) reasons.push(`stability ${stability.toFixed(2)} below baseline ${baselineStability.toFixed(2)}`);
    const adopt = reasons.length === 0;

    return { label, wins, losses, ties, prefExTies, aPositionRate: aPos, agreement, breaks, baselineBreaks, stability, baselineStability, adopt, reasons: adopt ? ['adopt: all three conditions met'] : reasons };
  });
}
