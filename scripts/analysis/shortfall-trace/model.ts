/**
 * Shortfall-trace model (plan docs/superpowers/plans/2026-11-24-shortfall-trace-test.md, step 4).
 * Pure: no I/O, no AI. Exploratory research script, not a product surface.
 *
 * Rules carried over from lib/builder/compute.ts: depth is ordinal 0-5 per K/U/D; depth along a path combines with
 * MAX, never a sum; null is "no reading"; foundational competencies are judged on D only; competency levels never fade.
 * Each (competency, dimension) is worked on its own, over the path's courses in topological order.
 */

export type Dim = 'k' | 'u' | 'd';
export type Gate = 'a' | 'b' | 'c';
export const GATES: readonly Gate[] = ['a', 'b', 'c'];
export const DIMS: readonly Dim[] = ['k', 'u', 'd'];
export type Depth = Record<Dim, number | null>;

export const MAX_STEPS = 3;
/** Owner-delegated ruling (2026-11-24): a fix "holds" at 80% of one-level perturbations. A judgment call, not derived. */
export const HOLD_FRACTION = 0.8;
export const HOLD_VARIANTS = 2;

export interface Comp { id: string; foundational: boolean; weight: number | null }
export interface Link { later: string; earlier: string; competency: string; expected: Depth }
export interface TraceInput {
  /** Path courses in topological order. */
  courses: string[];
  competencies: Comp[];
  /** Captured depth per course and competency. A missing entry, or a null dimension, is unknown. */
  exits: Record<string, Record<string, Depth>>;
  /** Courses with a confirmed capture. An uncaptured course's exits are unknown whatever `exits` holds. */
  captured: Record<string, boolean>;
  /** Links faculty marked real. Nothing else is a link. */
  links: Link[];
  /** Required depth per competency; null on a dimension means no requirement. */
  required: Record<string, Depth>;
}

const clamp = (n: number) => Math.max(0, Math.min(5, Math.round(n)));
export const dimsOf = (c: Comp): Dim[] => (c.foundational ? ['d'] : [...DIMS]);

export interface ExitCell { value: number; unknown: boolean }

/** The exit depth per course for one competency and dimension. Unknown counts as 0 and is flagged. */
export function exitsFor(input: TraceInput, competency: string, dim: Dim): Record<string, ExitCell> {
  const out: Record<string, ExitCell> = {};
  for (const course of input.courses) {
    const raw = input.captured[course] ? input.exits[course]?.[competency]?.[dim] ?? null : null;
    out[course] = raw == null ? { value: 0, unknown: true } : { value: clamp(raw), unknown: false };
  }
  return out;
}

export interface CellRow {
  course: string; exit: number; unknown: boolean;
  arrival: number; short: number; delivered: number; carried: number;
}
export interface CellRun { rows: CellRow[]; attained: number; peakCourse: string | null }

/**
 * One (competency, dimension) forward pass.
 * arrival = MAX carried over predecessors with a real link; short = MAX over real links of max(0, expected - arrival);
 * delivered by gate (a exit; b max(0, exit - short); c min(exit, arrival) when short); carried = max(arrival, delivered).
 * `removed` makes a course contribute nothing: delivered 0, so carried = arrival (students pass through).
 */
export function runCell(
  courses: readonly string[], links: readonly Link[], exits: Record<string, ExitCell>, dim: Dim, gate: Gate, removed?: string,
): CellRun {
  const carried: Record<string, number> = {};
  const rows: CellRow[] = [];
  for (const course of courses) {
    const incoming = links.filter(l => l.later === course);
    const arrival = incoming.reduce((m, l) => Math.max(m, carried[l.earlier] ?? 0), 0);
    const short = incoming.reduce((m, l) => Math.max(m, Math.max(0, clamp(l.expected[dim] ?? 0) - arrival)), 0);
    const e = exits[course] ?? { value: 0, unknown: true };
    const delivered = course === removed ? 0
      : gate === 'a' ? e.value
      : gate === 'b' ? Math.max(0, e.value - short)
      : short > 0 ? Math.min(e.value, arrival) : e.value;
    carried[course] = Math.max(arrival, delivered);
    rows.push({ course, exit: e.value, unknown: e.unknown, arrival, short, delivered, carried: carried[course]! });
  }
  const attained = rows.reduce((m, r) => Math.max(m, r.carried), 0);
  const peak = attained > 0 ? rows.find(r => r.carried === attained) : undefined;
  return { rows, attained, peakCourse: peak?.course ?? null };
}

// ---------------------------------------------------------------------------

export interface Step { course: string; count: number }
export interface Single { course: string; from: number; to: number; gapAfter: number; closes: boolean }
export interface FixSet {
  steps: Array<Step & { from: number; to: number; unknown: boolean }>;
  size: number;
  unverified: boolean;
  variants: Record<Gate, boolean>;
  variantsClosed: number;
  perturbClosed: number;
  perturbTotal: number;
  perturbFraction: number | null;
  holds: boolean;
}
export interface Shortfall {
  competency: string; dim: Dim; required: number; attained: number; gap: number;
  peakCourse: string | null;
  /** Courses that feed the peak course through real links, then the peak course itself, in path order. */
  chain: string[];
  unknownInChain: string[];
  singles: Single[];
  fixSets: FixSet[];
  noFixWithinThree: boolean;
}
export interface CreditRow {
  course: string;
  drops: Array<{ competency: string; dim: Dim; drop: number }>;
  weightedTotal: number;
}
export interface GateRow {
  competency: string; dim: Dim; required: number | null;
  attained: Record<Gate, number>; gap: Record<Gate, number>; differs: boolean;
}
export interface Analysis { shortfalls: Shortfall[]; credit: CreditRow[]; gates: GateRow[] }

/** Links that count for a competency: none for a foundational one. */
function linksFor(input: TraceInput, comp: Comp): Link[] {
  return comp.foundational ? [] : input.links.filter(l => l.competency === comp.id);
}

function chainOf(courses: readonly string[], links: readonly Link[], peak: string | null): string[] {
  if (!peak) return [];
  const seen = new Set<string>([peak]);
  const queue = [peak];
  while (queue.length) {
    const c = queue.pop()!;
    for (const l of links) if (l.later === c && !seen.has(l.earlier)) { seen.add(l.earlier); queue.push(l.earlier); }
  }
  return courses.filter(c => seen.has(c));
}

type Counts = Record<string, number>;
const withBumps = (base: Record<string, ExitCell>, bumps: Counts): Record<string, ExitCell> => {
  const out: Record<string, ExitCell> = {};
  for (const [c, e] of Object.entries(base)) out[c] = { ...e, value: clamp(e.value + (bumps[c] ?? 0)) };
  return out;
};

/** Every multiset of at most `max` +1 steps over `cells`, smallest first. A cell cannot rise past 5. */
function* multisets(cells: Array<{ course: string; room: number }>, max: number): Generator<Counts> {
  for (let size = 1; size <= max; size++) {
    const out: Counts[] = [];
    const rec = (i: number, left: number, cur: Counts) => {
      if (left === 0) { out.push({ ...cur }); return; }
      if (i >= cells.length) return;
      const cell = cells[i]!;
      for (let n = 0; n <= Math.min(left, cell.room); n++) {
        if (n > 0) cur[cell.course] = n; else delete cur[cell.course];
        rec(i + 1, left - n, cur);
      }
      delete cur[cell.course];
    };
    rec(0, size, {});
    yield* out;
  }
}
const subMultiset = (small: Counts, big: Counts) => Object.entries(small).every(([c, n]) => (big[c] ?? 0) >= n);

function analyzeCell(input: TraceInput, comp: Comp, dim: Dim, required: number): Shortfall | null {
  const links = linksFor(input, comp);
  const base = exitsFor(input, comp.id, dim);
  const baseline = runCell(input.courses, links, base, dim, 'b');
  const gap = required - baseline.attained;
  if (gap <= 0) return null;
  const closesWith = (exits: Record<string, ExitCell>, gate: Gate) => runCell(input.courses, links, exits, dim, gate).attained >= required;

  const singles: Single[] = [];
  for (const course of input.courses) {
    const e = base[course]!;
    if (e.value >= 5) continue;
    const after = runCell(input.courses, links, withBumps(base, { [course]: 1 }), dim, 'b').attained;
    if (after > baseline.attained) singles.push({ course, from: e.value, to: e.value + 1, gapAfter: Math.max(0, required - after), closes: after >= required });
  }

  const cells = input.courses.map(course => ({ course, room: 5 - base[course]!.value })).filter(c => c.room > 0);
  const found: Counts[] = [];
  for (const counts of multisets(cells, MAX_STEPS)) {
    if (found.some(f => subMultiset(f, counts))) continue; // a smaller set already closes it: not minimal
    if (closesWith(withBumps(base, counts), 'b')) found.push(counts);
  }

  // One-level perturbations of the captured inputs under gate b. A cell that cannot move (0 down, 5 up) is skipped.
  const perturbed: Array<Record<string, ExitCell>> = [];
  for (const course of input.courses) {
    const e = base[course]!;
    if (e.unknown) continue;
    for (const delta of [-1, 1]) {
      const v = e.value + delta;
      if (v < 0 || v > 5) continue;
      perturbed.push({ ...base, [course]: { ...e, value: v } });
    }
  }

  const fixSets: FixSet[] = found.map(counts => {
    const steps = input.courses.filter(c => counts[c]).map(course => ({
      course, count: counts[course]!, from: base[course]!.value, to: base[course]!.value + counts[course]!, unknown: base[course]!.unknown,
    }));
    const variants = Object.fromEntries(GATES.map(g => [g, closesWith(withBumps(base, counts), g)])) as Record<Gate, boolean>;
    const variantsClosed = GATES.filter(g => variants[g]).length;
    const perturbClosed = perturbed.filter(p => closesWith(withBumps(p, counts), 'b')).length;
    const perturbFraction = perturbed.length ? perturbClosed / perturbed.length : null;
    return {
      steps, size: steps.reduce((n, s) => n + s.count, 0), unverified: steps.some(s => s.unknown),
      variants, variantsClosed, perturbClosed, perturbTotal: perturbed.length, perturbFraction,
      holds: variantsClosed >= HOLD_VARIANTS && perturbFraction != null && perturbFraction >= HOLD_FRACTION,
    };
  });

  const chain = chainOf(input.courses, links, baseline.peakCourse);
  return {
    competency: comp.id, dim, required, attained: baseline.attained, gap,
    peakCourse: baseline.peakCourse, chain,
    unknownInChain: chain.filter(c => base[c]!.unknown),
    singles, fixSets, noFixWithinThree: fixSets.length === 0,
  };
}

export function creditView(input: TraceInput, gate: Gate = 'b'): CreditRow[] {
  const cells = input.competencies.flatMap(comp => dimsOf(comp).map(dim => {
    const links = linksFor(input, comp);
    const base = exitsFor(input, comp.id, dim);
    return { comp, dim, links, base, full: runCell(input.courses, links, base, dim, gate).attained };
  }));
  return input.courses.map(course => {
    const drops = cells.map(({ comp, dim, links, base, full }) => ({
      competency: comp.id, dim, drop: full - runCell(input.courses, links, base, dim, gate, course).attained,
    }));
    const weight = (id: string) => input.competencies.find(c => c.id === id)?.weight ?? 0;
    return { course, drops, weightedTotal: drops.reduce((s, d) => s + d.drop * weight(d.competency), 0) };
  });
}

export function gateComparison(input: TraceInput): GateRow[] {
  return input.competencies.flatMap(comp => dimsOf(comp).map(dim => {
    const links = linksFor(input, comp);
    const base = exitsFor(input, comp.id, dim);
    const required = input.required[comp.id]?.[dim] ?? null;
    const attained = Object.fromEntries(GATES.map(g => [g, runCell(input.courses, links, base, dim, g).attained])) as Record<Gate, number>;
    const gap = Object.fromEntries(GATES.map(g => [g, required == null ? 0 : Math.max(0, required - attained[g])])) as Record<Gate, number>;
    return { competency: comp.id, dim, required, attained, gap, differs: gap.a !== gap.b || gap.b !== gap.c };
  }));
}

export function analyze(input: TraceInput): Analysis {
  const shortfalls: Shortfall[] = [];
  for (const comp of input.competencies) {
    for (const dim of dimsOf(comp)) {
      const req = input.required[comp.id]?.[dim];
      if (req == null) continue;
      const s = analyzeCell(input, comp, dim, clamp(req));
      if (s) shortfalls.push(s);
    }
  }
  return { shortfalls, credit: creditView(input, 'b'), gates: gateComparison(input) };
}
