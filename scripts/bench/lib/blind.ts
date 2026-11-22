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
/** What the judge sees. Ids are opaque and the list is shuffled; nothing here names a label. */
export interface BlindPair { id: string; course: string; competency: string; A: Cell; B: Cell }
export type Winner = 'A' | 'B' | 'tie';
export interface Verdict { id: string; winner: Winner; reason?: string }
/** Sealed key entry (blind-key.json, outside the judge folder). A and B are the labels shown on each side. */
export interface KeyEntry { A: string; B: string; course: string; sub: string; label: string }
export type BlindKey = Record<string, KeyEntry>;

/** The second-judge sample uses the run seed plus this offset (documented in the judge doc). */
export const SECOND_SEED_OFFSET = 1;

/**
 * One pair per (competency, candidate). A/B is flipped by the seeded RNG, then the whole list is
 * shuffled by the same RNG so pair order does not group by competency or candidate.
 */
export function makePairs(inputs: PairInput[], seed: number): { pairs: BlindPair[]; key: BlindKey; seed: number } {
  const rnd = mulberry32(seed);
  const built: Array<{ course: string; competency: string; sub: string; label: string; A: Cell; B: Cell; sideA: string; sideB: string }> = [];
  for (const p of inputs) for (const c of p.candidates) {
    const flip = rnd() < 0.5;
    built.push({
      course: p.course, competency: p.name ?? p.sub, sub: p.sub, label: c.label,
      A: flip ? c.cell : p.baseline, B: flip ? p.baseline : c.cell,
      sideA: flip ? c.label : 'baseline', sideB: flip ? 'baseline' : c.label,
    });
  }
  for (let i = built.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [built[i], built[j]] = [built[j]!, built[i]!];
  }
  const pairs: BlindPair[] = [];
  const key: BlindKey = {};
  built.forEach((b, i) => {
    const id = `p${String(i + 1).padStart(3, '0')}`;
    pairs.push({ id, course: b.course, competency: b.competency, A: b.A, B: b.B });
    key[id] = { A: b.sideA, B: b.sideB, course: b.course, sub: b.sub, label: b.label };
  });
  return { pairs, key, seed };
}

/** Files for the sealed judge folder: the full pair set and the 20% second-judge sample. Nothing else. */
export function judgeFolderFiles(pairs: BlindPair[], seed: number): Record<string, { pairs: BlindPair[] }> {
  const second = new Set(secondJudgeIds(pairs, seed + SECOND_SEED_OFFSET));
  return { 'pairs.json': { pairs }, 'pairs-second.json': { pairs: pairs.filter(p => second.has(p.id)) } };
}

/** Map a verdict's A/B winner back to its label ('baseline', an arm label, or 'tie'). */
export function unblind(key: BlindKey, id: string, winner: Winner): string {
  if (winner === 'tie') return 'tie';
  const k = key[id];
  if (!k) throw new Error(`no key entry for ${id}`);
  return k[winner];
}

/** Second-judge sample: 20% of pair ids, drawn with its own seed (reproducible, without replacement). */
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

export const PROVISIONAL_NOTE = '(provisional vs live: Terra single not yet run)';

export interface ArmTally {
  label: string;
  wins: number; losses: number; ties: number;
  /** wins / (wins + losses); null when there are no non-tie verdicts. */
  prefExTies: number | null;
  /** Share of all verdicts won by the A position among non-ties (bias check: should sit near 50%). */
  aPositionRate: number | null;
  /** Agreement with the second judge on overlapping pairs for this label; null if no overlap. */
  agreement: number | null;
  breaks: number | null; baselineBreaks: number | null;
  /** breaks / cells: the rule compares rates, so unequal cell counts are fair. */
  breakRate: number | null; baselineBreakRate: number | null;
  stability: number | null;
  /** Stability of the same model's single arm (null for the single arm itself, which is not stability-judged). */
  baselineStability: number | null;
  /** Summary label the stability comparison used, e.g. 'single / qwen3.8-27b-fp8:off'. */
  stabilityRef: string | null;
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
/** '<arm> / <model>' → arm and model parts. */
const armOf = (label: string) => label.slice(0, Math.max(0, label.indexOf(' / ')));
const modelOf = (label: string) => (label.includes(' / ') ? label.slice(label.indexOf(' / ') + 3) : label);
const rateOf = (r?: SummaryRow) => (r && r.breaks !== null && r.cells > 0 ? r.breaks / r.cells : null);

/**
 * Apply the pre-committed rule (rulings R8, R10). Agent arms: adopt only if the break rate is below the
 * stored Sol baseline's, blind preference >= 50% ex-ties vs the stored Sol cells, AND stability >= the same
 * model's single arm. The single arm is the stability reference, so it is judged on breaks and preference only.
 */
export function tallyBlind({ key, verdicts, summary, second }: TallyInput): ArmTally[] {
  const base = summary.find(r => r.label === 'baseline');
  if (!base) throw new Error('summary has no baseline row');
  const labels = [...new Set(Object.values(key).map(k => (k.A === 'baseline' ? k.B : k.A)))];
  const winnerOf = (vs: Verdict[]) => new Map(vs.map(v => [v.id, unblind(key, v.id, v.winner)]));
  const primary = winnerOf(verdicts);
  const secondary = second ? winnerOf(second) : null;

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

    const isSingle = armOf(label) === 'single';
    const row = summary.find(r => r.label === label);
    const breaks = row?.breaks ?? null, baselineBreaks = base.breaks;
    const breakRate = rateOf(row), baselineBreakRate = rateOf(base);
    const stability = row?.stability ?? null;
    const stabilityRef = isSingle ? null : `single / ${modelOf(label)}`;
    const refRow = stabilityRef ? summary.find(r => r.label === stabilityRef) : undefined;
    const baselineStability = stabilityRef ? (refRow?.stability ?? null) : null;

    const reasons: string[] = [];
    if (breakRate === null || baselineBreakRate === null) reasons.push('break rate not measurable');
    else if (!(breakRate < baselineBreakRate)) reasons.push(`break rate ${pct(breakRate)} not below baseline ${pct(baselineBreakRate)}`);
    if (prefExTies === null) reasons.push('no non-tie verdicts');
    else if (!(prefExTies >= 0.5)) reasons.push(`preference ${pct(prefExTies)} below 50% ex-ties`);
    if (!isSingle) {
      if (!refRow) reasons.push(`no ${stabilityRef} row to compare stability with`);
      else if (baselineStability === null) reasons.push(`${stabilityRef} stability undefined`);
      else if (stability === null) reasons.push('stability not measurable (needs 2+ runs)');
      else if (!(stability >= baselineStability)) reasons.push(`stability ${stability.toFixed(2)} below ${stabilityRef} ${baselineStability.toFixed(2)}`);
    }
    const adopt = reasons.length === 0;
    const okText = isSingle ? 'adopt: breaks and preference met (single arm is the stability reference, not judged on stability)' : 'adopt: all three conditions met';

    return {
      label, wins, losses, ties, prefExTies, aPositionRate: aPos, agreement,
      breaks, baselineBreaks, breakRate, baselineBreakRate,
      stability, baselineStability, stabilityRef, adopt, reasons: adopt ? [okText] : reasons,
    };
  });
}

/** Markdown tally. Every verdict line carries PROVISIONAL_NOTE until the Terra single arm has run. */
export function renderTally(tallies: ArmTally[], meta: { verdictCount: number; aPositionRate: number | null; secondCount?: number }): string {
  const num = (x: number | null, d = 2) => (x === null ? 'n/a' : x.toFixed(d));
  return [
    '# Blind tally', '',
    `Verdicts: ${meta.verdictCount}${meta.secondCount !== undefined ? `; second judge: ${meta.secondCount}` : ''}.`,
    `A-position win rate (non-tie): ${pct(meta.aPositionRate)} (bias check: near 50% is expected).`, '',
    '| arm / model | wins | losses | ties | pref ex-ties | agreement w/ 2nd judge | break rate (baseline) | stability (reference) | decision |',
    '|---|---|---|---|---|---|---|---|---|',
    ...tallies.map(t => {
      const stab = t.stabilityRef ? `${num(t.stability)} (${t.stabilityRef}: ${num(t.baselineStability)})` : 'not judged';
      return `| ${t.label} | ${t.wins} | ${t.losses} | ${t.ties} | ${pct(t.prefExTies)} | ${pct(t.agreement)} | ${pct(t.breakRate)} (${pct(t.baselineBreakRate)}) | ${stab} | ${t.adopt ? 'ADOPT' : 'NOT ADOPTED'}: ${t.reasons.join('; ')} ${PROVISIONAL_NOTE} |`;
    }),
    '',
  ].join('\n');
}
