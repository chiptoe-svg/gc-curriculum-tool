/**
 * Curriculum builder analysis (spec docs/superpowers/specs/2026-11-14-curriculum-builder-design.md).
 * Pure: no DB, no AI. Runs in the browser on every edit.
 *
 * Rules carried over from the rest of the tool:
 *  - Depth across courses is the ordinal MAXIMUM per dimension, never a sum
 *    or an average (lib/program/prereq-gaps.ts, lib/program/sufficiency.ts).
 *  - null is "no reading", never zero.
 *  - Foundational competencies are judged on Do only.
 *  - A figure that rests on a stated objective or a proposed course is marked,
 *    never shown as discovered (the measured / mixed / intended basis rule).
 *  - Scaffolding statuses come from lib/program/scaffolding.ts unchanged.
 */
import { depthScaffoldingStatus, type ScaffoldingStatus } from '@/lib/program/scaffolding';
import { isMentionOnly } from '@/lib/program/depth-band';
import { MEMBERSHIP_CUTOFF } from '@/lib/catalog/membership';
import { PLAN_SCOPE } from './types';
import type {
  Act, ActLevels, Basis, CompetencyDepth, Depth, Library, LibraryCompetency, LibraryCourse, PlanState, ProposedCourse,
} from './types';

const maxN = (a: number | null, b: number | null): number | null =>
  a == null ? b : b == null ? a : Math.max(a, b);
const DIMS = ['k', 'u', 'd'] as const;
const NONE: Depth = { k: null, u: null, d: null };
const maxDepth = (a: Depth, b: Depth): Depth => ({ k: maxN(a.k, b.k), u: maxN(a.u, b.u), d: maxN(a.d, b.d) });

// ---------------------------------------------------------------------------
// One course's reading under the plan's lens
// ---------------------------------------------------------------------------

export interface CourseReading {
  depths: CompetencyDepth[];
  /** null = the course has nothing to stack under this lens. */
  basis: Basis | null;
  /** true when the reading is the course's OTHER source, used because `fill` is on. */
  filled: boolean;
}

export function versionOf(course: LibraryCourse, plan: Pick<PlanState, 'versions'>) {
  if (course.versions.length === 0) return null;
  return course.versions.find(v => v.snapshotId === plan.versions[course.code]) ?? course.versions[0]!;
}

export const WHAT_IF_PREFIX = 'whatif:';

/** The what-if chosen for a course in this plan, if any. */
export function whatIfOf(course: LibraryCourse, plan: Pick<PlanState, 'versions'>) {
  const chosen = plan.versions[course.code];
  if (!chosen?.startsWith(WHAT_IF_PREFIX)) return null;
  return course.whatIfs.find(w => w.id === chosen.slice(WHAT_IF_PREFIX.length)) ?? null;
}

export function readCourse(course: LibraryCourse, plan: Pick<PlanState, 'lens' | 'fill' | 'versions'>): CourseReading {
  // A what-if is a prediction of a changed course: it stands in for both readings and counts as proposed.
  const whatIf = whatIfOf(course, plan);
  if (whatIf) return { depths: whatIf.depths, basis: whatIf.depths.length ? 'proposed' : null, filled: false };
  const version = versionOf(course, plan);
  // A capture not yet scored against the competency catalog has outcomes to read but no depths to stack.
  const discovered: CourseReading | null = version && version.depths.length > 0 ? { depths: version.depths, basis: 'discovered', filled: false } : null;
  const stated: CourseReading | null = course.stated.length > 0 ? { depths: course.stated, basis: 'stated', filled: false } : null;
  const [first, second] = plan.lens === 'discovered' ? [discovered, stated] : [stated, discovered];
  if (first) return first;
  if (plan.fill && second) return { ...second, filled: true };
  return { depths: [], basis: null, filled: false };
}

/** Default act for a course that has not been placed: by catalog level, with
 * the two integration courses the 3-Act proposal names put in Act 2. */
export function defaultAct(course: Pick<LibraryCourse, 'code' | 'level'>): Act {
  if (course.code === 'GC 4400' || course.code === 'GC 4060') return 2;
  if (course.level >= 4) return 3;
  if (course.level === 3) return 2;
  if (course.level >= 1) return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/**
 * Starting levels for a competency nobody has set yet. A proposal for faculty
 * to edit, not data: no employer-required depths exist yet. Act 1 introduces;
 * Acts 2 and 3 ask for independent work (3) and leave it to faculty to say
 * where more is needed. The same for every competency on purpose: how
 * IMPORTANT a competency is to a career (the weights, Bridges 2020) says
 * nothing about how DEEP it must go, so importance does not set depth.
 */
export function defaultLevels(foundational: boolean): ActLevels {
  const ku = (n: number) => (foundational ? null : n);
  return [
    { k: ku(2), u: ku(1), d: 1 },
    { k: ku(3), u: ku(3), d: 3 },
    { k: ku(3), u: ku(3), d: 3 },
  ];
}

/** What one scope (a career path, or PLAN_SCOPE) requires of a competency. */
export function requiredLevels(plan: Pick<PlanState, 'goal'>, scope: string, competency: LibraryCompetency): ActLevels {
  const set = plan.goal.levels[scope]?.[competency.id];
  if (!set) return defaultLevels(competency.foundational);
  // Foundational competencies carry no Know / Understand requirement, whatever was stored.
  return competency.foundational
    ? (set.map(l => (l ? { k: null, u: null, d: l.d } : null)) as ActLevels)
    : set;
}

export type CheckpointStatus = 'met' | 'fading' | 'short' | 'untouched' | 'none';
export interface Checkpoint {
  /** 'none' = nothing is required here. 'fading' = reached earlier, but estimated to have slipped below the requirement by now. */
  status: CheckpointStatus;
  /** 0–1: share of the required depth reached. */
  completion: number;
}

/**
 * One checkpoint: what is reached against what is required. A dimension no
 * course reads counts as not reached. `held` is the estimated depth still
 * held at this point (see durable()); when given, a requirement reached
 * earlier but no longer held to within half a level reads 'fading'.
 */
export function checkpoint(at: Depth, req: Depth | null, held?: Depth): Checkpoint {
  const dims = req ? DIMS.filter(dim => (req[dim] ?? 0) > 0) : []; // a level of 0 asks for nothing
  if (dims.length === 0) return { status: 'none', completion: 1 };
  const share = (src: Depth) => dims.reduce((s, dim) => s + Math.min(src[dim] ?? 0, req![dim]!) / req![dim]!, 0) / dims.length;
  if (dims.every(dim => (at[dim] ?? -1) >= req![dim]!)) {
    if (held && dims.some(dim => (held[dim] ?? 0) < req![dim]! - 0.5)) return { status: 'fading', completion: share(held) };
    return { status: 'met', completion: 1 };
  }
  return { status: DIMS.every(dim => at[dim] == null) ? 'untouched' : 'short', completion: share(held ?? at) };
}

/**
 * Estimated depth still held at the end of each act (measurement-hypotheses
 * spec 2026-06-19 §2, "durability"). The FORM is the spaced-repetition one
 * the spec borrows (half-life grows with each spaced success); the NUMBERS
 * are the owner's working assumptions, not fitted values: a depth nobody
 * revisits loses `fade` levels per act; each further course that works the
 * competency within a level of its peak halves that loss ("two or three
 * D4s ... resolve to a D4 that sticks"); a lighter touch, or (only when the
 * plan switches it on) a closely related competency worked at integration
 * depth in the same act, halves the loss for that act and never raises the
 * level. One rate serves K, U and D, which is a simplification: Arthur et
 * al. (1998) found decay differs by kind of task. Floats stay inside the
 * model: callers show a band or an arrow, never the number.
 */
export function durable(
  contributions: Array<Depth & { act: Act }>, support: [boolean, boolean, boolean], fade: number,
): [Depth, Depth, Depth] {
  const out: [Depth, Depth, Depth] = [{ ...NONE }, { ...NONE }, { ...NONE }];
  for (const dim of DIMS) {
    let held: number | null = null;
    let peak = 0;
    let reinforcers = 0;
    for (const act of [1, 2, 3] as const) {
      const here = contributions.filter(c => c.act === act && c[dim] != null).map(c => c[dim]!);
      const top = here.length ? Math.max(...here) : null;
      if (held != null && fade > 0 && !(top != null && top >= peak - 1 && top >= 1)) {
        const touched = here.some(v => v >= 1) || support[act - 1];
        held = Math.max(0, held - fade * 0.5 ** Math.max(0, reinforcers - 1) * (touched ? 0.5 : 1));
      }
      if (top != null) {
        held = Math.max(held ?? 0, top);
        peak = Math.max(peak, top);
        reinforcers += here.filter(v => v >= 1 && v >= peak - 1).length;
      }
      out[act - 1]![dim] = held;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The whole plan
// ---------------------------------------------------------------------------

export interface PlacedCourse {
  ref: string;
  code: string;
  title: string;
  act: Act;
  branch: string | null;
  /** Teaching order across the whole plan (act first, then position). */
  seq: number;
  proposed: boolean;
  reading: CourseReading;
}

export interface Contribution extends Depth {
  ref: string;
  code: string;
  act: Act;
  seq: number;
  basis: Basis;
  /** Dimensions this course raised above everything taught before it. */
  raised: Array<'k' | 'u' | 'd'>;
}

export type ObjectiveStatus = 'met' | 'fading' | 'short' | 'late' | 'untouched' | 'none';
/** Durability by structure (spec §2.5, B1): several courses near the peak, one course alone, or nothing above introduction. */
export type Thread = 'reinforced' | 'lone_peak' | 'light' | 'none';
export type EvidenceBasis = 'discovered' | 'mixed' | 'soft' | 'none';
export type ObjectiveFlag =
  | 'brittle' | 'no_introduction' | 'top_heavy' | 'lone_peak' | 'mention_only'
  | 'jargon' | 'theory_without_craft' | 'craft_without_articulation' | 'soft_evidence';

export interface ObjectiveResult {
  competency: LibraryCompetency;
  /** Highest weight among the selected career paths that list it; null = added by hand or pinned. */
  weight: number | null;
  targetIds: string[];
  /** The strictest requirement across the selected career paths, per checkpoint. */
  required: ActLevels;
  /** Cumulative depth at the end of each act (index 0 = Act 1). */
  byAct: [Depth, Depth, Depth];
  /** Estimated depth still held at the end of each act. Internal: show bands or arrows, never these numbers. */
  heldByAct: [Depth, Depth, Depth];
  checkpoints: [Checkpoint, Checkpoint, Checkpoint];
  status: ObjectiveStatus;
  thread: Thread;
  basis: EvidenceBasis;
  scaffolding: ScaffoldingStatus;
  flags: ObjectiveFlag[];
  contributions: Contribution[];
}

export interface ActCount { required: number; met: number; fading: number }

export interface TargetResult {
  id: string;
  name: string;
  /** Branches that build toward this career path (their courses count for it, with the trunk). */
  branchIds: string[];
  /** Per checkpoint, against this career path's own levels and its own courses. */
  acts: [ActCount, ActCount, ActCount];
  /** Importance-weighted share of the final requirement reached, 0–1; null when nothing is required. */
  fit: number | null;
  /** This path's own reading of each of its objectives at its final checkpoint. */
  final: Record<string, CheckpointStatus>;
}

export interface WrittenResult {
  id: string;
  /** 'unlinked' = no competency attached, so it cannot be checked. */
  status: 'met' | 'short' | 'unlinked';
  met: number;
  of: number;
}

export interface PlanEdge { from: string; to: string; kind: 'prereq' | 'concurrent_ok'; source: 'catalog' | 'plan'; anyOfGroup: number | null }

export interface CourseCheck {
  ref: string;
  code: string;
  kind: 'prereq_missing' | 'prereq_order' | 'prereq_branch' | 'no_reading';
  detail: string;
  /** For an order or branch problem: the placed courses it depends on that are in the wrong place. */
  from?: string[];
}

export interface ActMilestone { act: Act; courses: number; introduced: number; integrated: number; required: number; met: number; fading: number }

export interface PlanResult {
  /** The courses in view (trunk plus the viewed branches), in teaching order. */
  courses: PlacedCourse[];
  objectives: ObjectiveResult[];
  targets: TargetResult[];
  written: WrittenResult[];
  /** Dependencies between placed courses, for drawing and for the checks. */
  edges: PlanEdge[];
  checks: CourseCheck[];
  milestones: ActMilestone[];
}

/** Every placed course, in teaching order, whatever its branch. */
export function placeCourses(lib: Library, plan: PlanState): PlacedCourse[] {
  const byCode = new Map(lib.courses.map(c => [c.code, c]));
  const proposed = new Map(plan.proposed.map(p => [p.id, p]));
  const branchIds = new Set(plan.branches.map(b => b.id));
  const out: PlacedCourse[] = [];
  const seen = new Set<string>();
  for (const act of [1, 2, 3] as const) {
    for (const p of plan.placements) {
      if (p.act !== act || seen.has(p.ref)) continue;
      const lc = byCode.get(p.ref);
      const pc: ProposedCourse | undefined = proposed.get(p.ref);
      if (!lc && !pc) continue; // a course that left the library, or a deleted proposal
      seen.add(p.ref);
      const branch = p.branch && branchIds.has(p.branch) ? p.branch : null; // a deleted branch's courses fall back to the trunk
      out.push(lc
        ? { ref: p.ref, code: lc.code, title: lc.title, act, branch, seq: out.length, proposed: false, reading: readCourse(lc, plan) }
        : { ref: p.ref, code: pc!.code, title: pc!.title, act, branch, seq: out.length, proposed: true,
            reading: { depths: pc!.depths, basis: pc!.depths.length ? 'proposed' : null, filled: false } });
    }
  }
  return out;
}

/** The plan's objectives: the selected career paths' competencies, plus added, minus removed. */
export function planObjectives(lib: Library, plan: PlanState): Array<{ competency: LibraryCompetency; weight: number | null; targetIds: string[] }> {
  const comp = new Map(lib.competencies.map(c => [c.id, c]));
  const removed = new Set(plan.goal.removed);
  const acc = new Map<string, { weight: number | null; targetIds: string[] }>();
  for (const t of lib.targets) {
    if (!plan.goal.targetIds.includes(t.id)) continue;
    for (const m of t.members) {
      const prev = acc.get(m.competencyId) ?? { weight: null, targetIds: [] };
      acc.set(m.competencyId, { weight: maxN(prev.weight, m.weight), targetIds: [...prev.targetIds, t.id] });
    }
  }
  for (const id of plan.goal.added) if (!acc.has(id)) acc.set(id, { weight: null, targetIds: [] });
  return [...acc.entries()]
    .filter(([id]) => comp.has(id) && !removed.has(id))
    .map(([id, v]) => ({ competency: comp.get(id)!, ...v }));
}

/** Catalog prerequisites (less the ones this plan sets aside) plus the plan's own links, between placed courses or naming an absent one. */
export function planEdges(lib: Library, plan: PlanState): PlanEdge[] {
  const off = new Set(plan.unlinked.map(l => `${l.from}>${l.to}`));
  const out: PlanEdge[] = lib.prereqs
    .filter(e => !off.has(`${e.prereqCode}>${e.courseCode}`))
    .map(e => ({ from: e.prereqCode, to: e.courseCode, kind: e.kind, source: 'catalog' as const, anyOfGroup: e.anyOfGroup }));
  const have = new Set(out.map(e => `${e.from}>${e.to}`));
  for (const l of plan.links) {
    if (l.from === l.to || have.has(`${l.from}>${l.to}`)) continue;
    have.add(`${l.from}>${l.to}`);
    out.push({ from: l.from, to: l.to, kind: 'prereq', source: 'plan', anyOfGroup: null });
  }
  return out;
}

type Stack = { byAct: [Depth, Depth, Depth]; heldByAct: [Depth, Depth, Depth]; contributions: Contribution[] };

/** Per act, the competencies some course works at integration depth (U or D of 4+): the only depth at which a neighbor lends support. */
function integrationByAct(courses: PlacedCourse[]): [Set<string>, Set<string>, Set<string>] {
  const out: [Set<string>, Set<string>, Set<string>] = [new Set(), new Set(), new Set()];
  for (const c of courses) {
    if (!c.reading.basis) continue;
    for (const d of c.reading.depths) if ((d.u ?? 0) >= 4 || (d.d ?? 0) >= 4) out[c.act - 1]!.add(d.competencyId);
  }
  return out;
}

function stack(courses: PlacedCourse[], competency: LibraryCompetency, plan: Pick<PlanState, 'fade' | 'support'>, high = integrationByAct(courses)): Stack {
  const fade = plan.fade;
  const competencyId = competency.id;
  let running: Depth = NONE;
  const byAct: [Depth, Depth, Depth] = [NONE, NONE, NONE];
  const contributions: Contribution[] = [];
  for (const c of courses) {
    const read = c.reading.depths.find(d => d.competencyId === competencyId);
    if (!read || !c.reading.basis) continue;
    // Foundational competencies are read on Do only, whatever a reading happens to carry.
    const row = competency.foundational ? { ...read, k: null, u: null } : read;
    if (competency.foundational && row.d == null) continue;
    const raised = DIMS.filter(dim => row[dim] != null && (running[dim] == null || row[dim]! > running[dim]!));
    contributions.push({ ref: c.ref, code: c.code, act: c.act, seq: c.seq, basis: c.reading.basis, k: row.k, u: row.u, d: row.d, raised });
    running = maxDepth(running, row);
    for (let a = c.act; a <= 3; a++) byAct[a - 1] = running;
  }
  const support = high.map(set => plan.support && competency.neighbors.some(n => set.has(n))) as [boolean, boolean, boolean];
  return { byAct, heldByAct: fade > 0 ? durable(contributions, support, fade) : byAct, contributions };
}

function evidenceBasis(contribs: Contribution[], at: Depth): EvidenceBasis {
  if (contribs.length === 0) return 'none';
  const discovered = contribs.filter(c => c.basis === 'discovered');
  if (discovered.length === 0) return 'soft';
  // Mixed: a stated or proposed reading raised some dimension above what the discovered readings give.
  const raisedBySoft = DIMS.some(dim => {
    const top = discovered.reduce<number | null>((m, c) => maxN(m, c[dim]), null);
    return at[dim] != null && (top == null || at[dim]! > top);
  });
  return raisedBySoft ? 'mixed' : 'discovered';
}

const strictest = (levels: ActLevels[]): ActLevels => [0, 1, 2].map(i => {
  const set = levels.map(l => l[i]).filter((l): l is Depth => l != null);
  return set.length ? set.reduce(maxDepth, NONE) : null;
}) as ActLevels;

const lastRequired = (cps: Checkpoint[]): number => {
  for (let i = cps.length - 1; i >= 0; i--) if (cps[i]!.status !== 'none') return i;
  return -1;
};

/**
 * `view` picks which branches are stacked with the trunk for the objectives
 * ('all' = every branch at once). Career-path results ignore `view`: each
 * path is always judged on the trunk plus the branches that build toward it.
 */
export function computePlan(lib: Library, plan: PlanState, view: string[] | 'all' = 'all'): PlanResult {
  const all = placeCourses(lib, plan);
  const inView = (c: PlacedCourse, branches: string[] | 'all') => c.branch === null || branches === 'all' || branches.includes(c.branch);
  const courses = all.filter(c => inView(c, view));
  const selected = lib.targets.filter(t => plan.goal.targetIds.includes(t.id));
  const weightIn = (targetId: string, competencyId: string) =>
    selected.find(t => t.id === targetId)?.members.find(m => m.competencyId === competencyId)?.weight ?? null;
  const scopeLevels = (scope: string, competency: LibraryCompetency) => requiredLevels(plan, scope, competency);

  const high = integrationByAct(courses);
  const objectives: ObjectiveResult[] = planObjectives(lib, plan).map(({ competency, weight, targetIds }) => {
    const { byAct, heldByAct, contributions } = stack(courses, competency, plan, high);
    const scopes = [...targetIds, ...(plan.goal.added.includes(competency.id) ? [PLAN_SCOPE] : [])];
    const required = strictest(scopes.map(s => scopeLevels(s, competency)));
    const checkpoints = byAct.map((at, i) => checkpoint(at, required[i]!, heldByAct[i]!)) as [Checkpoint, Checkpoint, Checkpoint];
    const last = lastRequired(checkpoints);
    const status: ObjectiveStatus = last < 0 ? 'none'
      : contributions.length === 0 ? 'untouched'
      : checkpoints.every(c => c.status === 'met' || c.status === 'none') ? 'met'
      : checkpoints[last]!.status === 'met' ? 'late'
      : checkpoints[last]!.status === 'fading' ? 'fading'
      : 'short';

    const scaffolding = depthScaffoldingStatus(contributions.map(c => ({
      snapshotId: c.ref, courseCode: c.code, sequenceIndex: c.seq,
      kDepth: c.k, uDepth: c.u, dDepth: c.d ?? 0, productiveFailureConditions: null,
    }))).status;

    const end = byAct[2];
    const basis = evidenceBasis(contributions, end);
    const flags: ObjectiveFlag[] = [];
    if (scaffolding === 'brittle_scaffold') flags.push('brittle');
    if (scaffolding === 'no_introduction') flags.push('no_introduction');
    if (scaffolding === 'top_heavy') flags.push('top_heavy');
    const top = (c: Depth) => Math.max(c.k ?? 0, c.u ?? 0, c.d ?? 0);
    const peak = contributions.reduce((m, c) => Math.max(m, top(c)), 0);
    const nearPeak = contributions.filter(c => top(c) >= 1 && top(c) >= peak - 1).length;
    const thread: Thread = contributions.length === 0 ? 'none' : peak < 3 ? 'light' : nearPeak >= 2 ? 'reinforced' : 'lone_peak';
    if (thread === 'lone_peak') flags.push('lone_peak');
    if (!competency.foundational) {
      const { k, u, d } = end;
      if (d != null && isMentionOnly(k, u, d)) flags.push('mention_only');
      if (k != null && u != null && k >= 3 && u <= 1) flags.push('jargon');
      if (u != null && d != null && u >= 3 && d <= 1) flags.push('theory_without_craft');
      if (d != null && u != null && d >= 3 && u <= 1) flags.push('craft_without_articulation');
    }
    if (last >= 0 && checkpoints[last]!.status === 'met' && basis !== 'discovered') flags.push('soft_evidence');

    return { competency, weight, targetIds, required, byAct, heldByAct, checkpoints, status, thread, basis, scaffolding, flags, contributions };
  });

  // Each career path on its own courses (trunk + its branches) and its own levels.
  const pathCheckpoints = (targetId: string, competency: LibraryCompetency): Checkpoint[] => {
    const branches = plan.branches.filter(b => b.targetIds.includes(targetId)).map(b => b.id);
    const { byAct, heldByAct } = stack(all.filter(c => inView(c, branches)), competency, plan);
    const req = scopeLevels(targetId, competency);
    return byAct.map((at, i) => checkpoint(at, req[i]!, heldByAct[i]!));
  };
  const targets: TargetResult[] = selected.map(t => {
    const mine = objectives.filter(o => o.targetIds.includes(t.id)).map(o => ({ o, cps: pathCheckpoints(t.id, o.competency) }));
    const acts = [0, 1, 2].map(i => ({
      required: mine.filter(m => m.cps[i]!.status !== 'none').length,
      met: mine.filter(m => m.cps[i]!.status === 'met').length,
      fading: mine.filter(m => m.cps[i]!.status === 'fading').length,
    })) as TargetResult['acts'];
    let sumW = 0;
    let sum = 0;
    for (const { o, cps } of mine) {
      const last = lastRequired(cps);
      if (last < 0) continue;
      const w = weightIn(t.id, o.competency.id) ?? MEMBERSHIP_CUTOFF;
      sumW += w;
      sum += w * cps[last]!.completion;
    }
    const final: Record<string, CheckpointStatus> = {};
    for (const { o, cps } of mine) { const last = lastRequired(cps); final[o.competency.id] = last < 0 ? 'none' : cps[last]!.status; }
    return {
      id: t.id, name: t.name, acts, final, fit: sumW > 0 ? sum / sumW : null,
      branchIds: plan.branches.filter(b => b.targetIds.includes(t.id)).map(b => b.id),
    };
  });

  const byCompetency = new Map(objectives.map(o => [o.competency.id, o]));
  const written: WrittenResult[] = plan.goal.written.map(w => {
    const linked = w.competencyIds.map(id => byCompetency.get(id)).filter((o): o is ObjectiveResult => !!o);
    if (linked.length === 0) return { id: w.id, status: 'unlinked', met: 0, of: 0 };
    const met = linked.filter(o => {
      const cp = w.targetId && o.targetIds.includes(w.targetId)
        ? pathCheckpoints(w.targetId, o.competency)[w.act - 1]!
        : o.checkpoints[w.act - 1]!;
      return cp.status === 'met';
    }).length;
    return { id: w.id, status: met === linked.length ? 'met' : 'short', met, of: linked.length };
  });

  // Order and dependency checks run over every placed course, whatever is in view.
  const edges = planEdges(lib, plan);
  const placed = new Map(all.map(c => [c.ref, c]));
  const label = (ref: string) => placed.get(ref)?.code ?? plan.proposed.find(p => p.id === ref)?.code ?? ref;
  const checks: CourseCheck[] = [];
  const unscored = new Set(lib.courses.filter(c => c.versions.length > 0 && c.versions.every(v => v.depths.length === 0)).map(c => c.code));
  for (const c of all) {
    if (!c.reading.basis) {
      checks.push({ ref: c.ref, code: c.code, kind: 'no_reading', detail: c.proposed
        ? 'No competency levels entered yet, so it adds nothing to the plan.'
        : unscored.has(c.ref)
          ? 'Captured, but the capture has not been scored against the competency catalog yet (the Program page does that), and there is no other reading to use.'
          : plan.lens === 'discovered'
            ? 'Not captured, and no stated-objective reading to fall back on.'
            : 'No stated-objective reading, and not captured.' });
    }
    const groups = new Map<string, PlanEdge[]>();
    edges.filter(e => e.to === c.ref).forEach((e, i) => {
      const key = e.anyOfGroup == null ? `solo-${i}` : `any-${e.anyOfGroup}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    });
    for (const group of groups.values()) {
      const names = group.map(e => label(e.from)).join(' or ');
      const inPlan = group.filter(e => placed.has(e.from));
      if (inPlan.length === 0) {
        checks.push({ ref: c.ref, code: c.code, kind: 'prereq_missing', detail: `Depends on ${names}, which is not in this plan.` });
        continue;
      }
      const reachable = inPlan.filter(e => { const p = placed.get(e.from)!; return p.branch === null || p.branch === c.branch; });
      if (reachable.length === 0) {
        checks.push({ ref: c.ref, code: c.code, kind: 'prereq_branch', detail: `Depends on ${names}, which sits on a different branch.`, from: inPlan.map(e => e.from) });
        continue;
      }
      const ok = reachable.some(e => {
        const p = placed.get(e.from)!;
        return p.act < c.act || (p.act === c.act && (p.seq < c.seq || e.kind === 'concurrent_ok'));
      });
      if (!ok) checks.push({ ref: c.ref, code: c.code, kind: 'prereq_order', detail: `Sits before ${names}, which it depends on.`, from: reachable.map(e => e.from) });
    }
  }

  const milestones: ActMilestone[] = ([1, 2, 3] as const).map(act => ({
    act,
    courses: courses.filter(c => c.act === act).length,
    introduced: objectives.filter(o => { const a = o.byAct[act - 1]!; return (a.k ?? 0) >= 1 || (a.u ?? 0) >= 1 || (a.d ?? 0) >= 1; }).length,
    integrated: objectives.filter(o => { const a = o.byAct[act - 1]!; return (a.u ?? 0) >= 4 || (a.d ?? 0) >= 4; }).length,
    required: objectives.filter(o => o.checkpoints[act - 1]!.status !== 'none').length,
    met: objectives.filter(o => o.checkpoints[act - 1]!.status === 'met').length,
    fading: objectives.filter(o => o.checkpoints[act - 1]!.status === 'fading').length,
  }));

  return { courses, objectives, targets, written, edges: edges.filter(e => placed.has(e.to)), checks, milestones };
}

export const FLAG_TEXT: Record<ObjectiveFlag, { label: string; detail: string }> = {
  brittle: { label: 'Brittle scaffold', detail: 'A course works this at integration depth before any course has introduced or practiced it.' },
  no_introduction: { label: 'Never introduced', detail: 'Courses practice or integrate this, but none introduces it.' },
  top_heavy: { label: 'No practice step', detail: 'Introduced and then integrated, with no course practicing it in between.' },
  lone_peak: { label: 'Lone peak', detail: 'One course takes this to depth and nothing else works it near that level, so it is likely to fade.' },
  mention_only: { label: 'Mentioned only', detail: 'Know 1 with no Understand or Do: the topic is named but students never engage with it.' },
  jargon: { label: 'Terms without reasons', detail: 'Know is well ahead of Understand.' },
  theory_without_craft: { label: 'Theory without craft', detail: 'Understand is well ahead of Do.' },
  craft_without_articulation: { label: 'Craft without articulation', detail: 'Do is well ahead of Understand.' },
  soft_evidence: { label: 'Rests on a stated objective', detail: 'The final target is reached only by counting a stated objective or a proposed course, not a discovered outcome.' },
};
