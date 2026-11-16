import { describe, it, expect } from 'vitest';
import { checkpoint, computePlan, defaultAct, defaultLevels, durable, hoursOf, parseCredits, placeCourses, readCourse } from '../compute';
import { EMPTY_PLAN, PLAN_SCOPE, type ActLevels, type Library, type LibraryCourse, type PlanState } from '../types';

const course = (code: string, over: Partial<LibraryCourse> = {}): LibraryCourse => ({
  code, title: code, level: 1, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives: [], sheetProjects: [], stated: [], versions: [], whatIfs: [], ...over,
});
const version = (id: string, depths: Array<[string, number | null, number | null, number]>) => ({
  snapshotId: id, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', outcomes: [], disagreements: [], projects: [], conditions: null, skills: [], required: [], unmapped: [], suggestions: [], linked: false,
  depths: depths.map(([competencyId, k, u, d]) => ({ competencyId, k, u, d })),
});
const captured = (code: string, depths: Array<[string, number | null, number | null, number]>) =>
  course(code, { versions: [version(code.toLowerCase(), depths)] });
const lib = (courses: LibraryCourse[], prereqs: Library['prereqs'] = []): Library => ({
  courses,
  competencies: [
    { id: 'color', name: 'Color', foundational: false, stratum: 'technical', neighbors: ['press'], know: 'k', understand: 'u', do: 'd' },
    { id: 'press', name: 'Press', foundational: false, stratum: 'technical', neighbors: ['color'], know: 'k', understand: 'u', do: 'd' },
    { id: 'agency', name: 'Agency', foundational: true, stratum: 'foundational', neighbors: [], know: null, understand: null, do: 'd' },
  ],
  targets: [
    { id: 't', name: 'Production', shortDefinition: '', members: [
      { competencyId: 'color', weight: 1 }, { competencyId: 'press', weight: 0.5 }, { competencyId: 'agency', weight: null },
    ] },
    { id: 'b', name: 'Brand', shortDefinition: '', members: [{ competencyId: 'color', weight: 0.5 }] },
  ],
  prereqs, candidates: {}, decisions: {},
});
const all = (n: number) => ({ k: n, u: n, d: n });
/** Require `n` on every dimension at the end of Act 3 only. */
const final = (n: number): ActLevels => [null, null, all(n)];
type P = Array<[string, 1 | 2 | 3] | [string, 1 | 2 | 3, string]>;
/** Every course in the last term of its act, so fade starts at the act's end (as when fade was counted per act). */
const lastTerm = (p: PlanState): PlanState => ({ ...p, placements: p.placements.map(x => ({ ...x, slot: 2 as const, x: 0 })) });
const plan = (placements: P, over: Partial<PlanState> = {}, goal: Partial<PlanState['goal']> = {}): PlanState => ({
  ...EMPTY_PLAN,
  fade: 0,
  placements: placements.map(([ref, act, branch]) => ({ ref, act, branch: branch ?? null })),
  ...over,
  // Career paths only, unless a test switches program targets on (EMPTY_PLAN, for new plans, has them on).
  goal: { ...EMPTY_PLAN.goal, program: undefined, targetIds: ['t'], levels: { t: { color: final(3), press: final(3), agency: final(3) } }, ...goal },
});
const obj = (r: ReturnType<typeof computePlan>, id: string) => r.objectives.find(o => o.competency.id === id)!;

describe('readCourse', () => {
  const c = course('GC 1', { stated: [{ competencyId: 'color', k: 4, u: 4, d: 4 }], versions: [version('s1', [['color', 2, 1, 1]])] });
  it('reads discovered outcomes or stated objectives by lens', () => {
    expect(readCourse(c, { lens: 'discovered', fill: false, versions: {} }).basis).toBe('discovered');
    expect(readCourse(c, { lens: 'stated', fill: false, versions: {} }).depths[0]!.d).toBe(4);
  });
  it('falls back to the other reading only when fill is on', () => {
    const statedOnly = course('GC 2', { stated: [{ competencyId: 'color', k: 1, u: 1, d: 1 }] });
    expect(readCourse(statedOnly, { lens: 'discovered', fill: false, versions: {} }).basis).toBeNull();
    expect(readCourse(statedOnly, { lens: 'discovered', fill: true, versions: {} })).toMatchObject({ basis: 'stated', filled: true });
  });
  it('reads a chosen what-if as proposed under either lens', () => {
    const w = course('GC 4', {
      versions: [version('s', [['color', 2, 2, 2]])],
      whatIfs: [{ id: 'w1', title: 'Add a press run', author: 'A', depths: [{ competencyId: 'color', k: 4, u: 4, d: 4 }], notComputed: [] }],
    });
    for (const lens of ['discovered', 'stated'] as const) {
      expect(readCourse(w, { lens, fill: false, versions: { 'GC 4': 'whatif:w1' } })).toMatchObject({ basis: 'proposed', depths: [{ d: 4 }] });
    }
    expect(readCourse(w, { lens: 'discovered', fill: false, versions: { 'GC 4': 'whatif:gone' } }).basis).toBe('discovered');
  });
  it('does not stack a capture that has not been scored against the catalog', () => {
    const unscored = course('GC 5', { versions: [version('s', [])], stated: [{ competencyId: 'color', k: 2, u: 2, d: 2 }] });
    expect(readCourse(unscored, { lens: 'discovered', fill: false, versions: {} }).basis).toBeNull();
    expect(readCourse(unscored, { lens: 'discovered', fill: true, versions: {} })).toMatchObject({ basis: 'stated', filled: true });
  });
  it('uses the chosen captured version', () => {
    const two = course('GC 3', { versions: [version('new', [['color', 1, 1, 1]]), version('old', [['color', 5, 5, 5]])] });
    expect(readCourse(two, { lens: 'discovered', fill: false, versions: { 'GC 3': 'old' } }).depths[0]!.d).toBe(5);
  });
});

describe('checkpoint', () => {
  it('has no status when nothing is required', () => {
    expect(checkpoint(all(5), null).status).toBe('none');
    expect(checkpoint(all(5), { k: null, u: null, d: 0 }).status).toBe('none');
  });
  it('judges each required dimension separately', () => {
    expect(checkpoint({ k: 4, u: 2, d: 4 }, { k: 3, u: 3, d: 3 })).toEqual({ status: 'short', completion: (1 + 2 / 3 + 1) / 3 });
    expect(checkpoint({ k: 4, u: 2, d: 4 }, { k: 3, u: null, d: 3 }).status).toBe('met');
  });
  it('counts a dimension no course reads as not reached', () => {
    expect(checkpoint({ k: null, u: null, d: 3 }, all(3)).status).toBe('short');
    expect(checkpoint({ k: null, u: null, d: null }, all(3))).toEqual({ status: 'untouched', completion: 0 });
  });
  it('takes no held level: a requirement reached stays met', () => {
    expect(checkpoint({ k: null, u: null, d: 3 }, { k: null, u: null, d: 3 }).status).toBe('met');
  });
});

describe('durable (reinforcement and fade)', () => {
  const none: [boolean, boolean, boolean] = [false, false, false];
  const d = (act: 1 | 2 | 3, n: number) => ({ act, k: null, u: null, d: n });
  const held = (c: Array<ReturnType<typeof d>>, support = none, fade = 1) => durable(c, support, fade).map(a => a.d);
  it('a lone peak loses a level for each act nobody revisits it', () => {
    expect(held([d(1, 4)])).toEqual([4, 3, 2]);
  });
  it('each further course near the peak halves the loss', () => {
    expect(held([d(1, 4), d(1, 4)])).toEqual([4, 3.5, 3]);
    expect(held([d(1, 4), d(1, 3), d(1, 4)])).toEqual([4, 3.75, 3.5]);
  });
  it('a course that works it again near the peak stops the loss for that act', () => {
    expect(held([d(1, 4), d(2, 3)])).toEqual([4, 4, 3.5]);
  });
  it('a light touch halves the loss for its own term; a supporting neighbor for its whole act; neither raises the level', () => {
    // Fade runs a third of a level per term. The touch sits in Act 2's last term: two full losses, then a half.
    expect(held([d(1, 4), d(2, 1)])).toEqual([4, 3.166667, 2.166667]);
    expect(held([d(1, 4)], [false, true, true])).toEqual([4, 3.5, 3]);
  });
  it('counts terms within an act: a course in an earlier term has slipped by the act\'s end', () => {
    expect(durable([{ act: 1, term: 1, k: null, u: null, d: 3 }], none, 1).map(a => a.d)).toEqual([2.333333, 1.333333, 0.333333]);
  });
  it('leaves an unread dimension unread, and does nothing when fade is off', () => {
    expect(durable([d(1, 4)], none, 1)[2].k).toBeNull();
    expect(held([d(1, 4)], none, 0)).toEqual([4, 4, 4]);
  });
});

describe('credit hours', () => {
  it('reads catalog credit text, taking the low end of a range', () => {
    expect(parseCredits('3')).toBe(3);
    expect(parseCredits('1-3')).toBe(1);
    expect(parseCredits(null)).toBeNull();
    expect(parseCredits('varies')).toBeNull();
  });
  it('adds the shared trunk by term and act, leaving branch courses out and listing courses with no credits', () => {
    const l = lib([course('A', { credits: '3' }), course('B', { credits: '4' }), course('C', { credits: '2' }), course('D')]);
    const p = { ...EMPTY_PLAN, branches: [{ id: 'x', name: 'X', targetIds: [] }], placements: [
      { ref: 'A', act: 1 as const, branch: null, slot: 0 as const, x: 0 },
      { ref: 'B', act: 1 as const, branch: null, slot: 2 as const, x: 0 },
      { ref: 'C', act: 3 as const, branch: 'x', slot: 0 as const, x: 0 },
      { ref: 'D', act: 2 as const, branch: null, slot: 1 as const, x: 0 },
    ] };
    const h = hoursOf(placeCourses(l, p));
    expect(h.total).toBe(7);
    expect(h.byAct).toEqual([7, 0, 0]);
    expect(h.byTerm.slice(0, 3)).toEqual([3, 0, 4]);
    expect(h.unknown).toEqual(['D']);
  });
});

describe('defaultLevels', () => {
  it('ramps across the acts, the same for every competency whatever its importance', () => {
    expect(defaultLevels(false).map(l => l!.d)).toEqual([1, 3, 3]);
    expect(defaultLevels(false)[0]).toEqual({ k: 2, u: 1, d: 1 });
    expect(defaultLevels(true)[2]).toEqual({ k: null, u: null, d: 3 });
  });
});

describe('computePlan', () => {
  it('stacks by per-dimension maximum, never a sum', () => {
    const l = lib([captured('A', [['color', 2, 1, 3]]), captured('B', [['color', 1, 3, 2]])]);
    const o = obj(computePlan(l, plan([['A', 1], ['B', 2]])), 'color');
    expect(o.byAct[2]).toEqual({ k: 2, u: 3, d: 3 });
    expect(o.contributions[1]!.raised).toEqual(['u']);
    expect(o.status).toBe('short'); // Know 2 against a required 3
  });

  it('judges every act checkpoint against its own K/U/D levels', () => {
    const l = lib([captured('A', [['color', 1, 1, 1]]), captured('B', [['color', 3, 3, 3]])]);
    const levels = { t: { color: [all(2), all(3), all(3)] as ActLevels, press: final(0), agency: final(0) } };
    const late = obj(computePlan(l, plan([['A', 1], ['B', 3]], {}, { levels })), 'color');
    expect(late.byAct.map(a => a.d)).toEqual([1, 1, 3]);
    expect(late.checkpoints.map(c => c.status)).toEqual(['short', 'short', 'met']);
    expect(late.checkpoints[1]!.completion).toBeCloseTo(1 / 3);
    expect(late.status).toBe('late');
    const onTime = obj(computePlan(l, plan([['B', 1]], {}, { levels })), 'color');
    expect(onTime.status).toBe('met');
  });

  it('reports an objective no course touches as untouched, with no depth', () => {
    const o = obj(computePlan(lib([captured('A', [['color', 3, 3, 3]])]), plan([['A', 1]])), 'press');
    expect(o.status).toBe('untouched');
    expect(o.byAct[2]).toEqual({ k: null, u: null, d: null });
    expect(o.basis).toBe('none');
  });

  it('judges a foundational competency on Do only, whatever levels were stored', () => {
    const l = lib([captured('A', [['agency', null, null, 3]])]);
    const o = obj(computePlan(l, plan([['A', 1]])), 'agency');
    expect(o.required[2]).toEqual({ k: null, u: null, d: 3 });
    expect(o.status).toBe('met');
  });

  it('ignores Know and Understand readings on a foundational competency', () => {
    const l = lib([course('A', { stated: [{ competencyId: 'agency', k: 4, u: 4, d: null }] }), captured('B', [['agency', 5, 5, 2]])]);
    const onlyKU = obj(computePlan(l, plan([['A', 1]])), 'agency');
    expect(onlyKU.status).toBe('untouched');
    expect(onlyKU.contributions).toEqual([]);
    const withDo = obj(computePlan(l, plan([['B', 1]])), 'agency');
    expect(withDo.byAct[2]).toEqual({ k: null, u: null, d: 2 });
    expect(withDo.status).toBe('short');
  });

  it('takes the strictest requirement across the selected career paths, and judges each path on its own', () => {
    const l = lib([captured('A', [['color', 3, 3, 3]])]);
    const p = plan([['A', 1]], {}, { targetIds: ['t', 'b'], levels: {
      t: { color: final(4), press: final(0), agency: final(0) }, b: { color: final(2) },
    } });
    const r = computePlan(l, p);
    expect(obj(r, 'color').required[2]).toEqual(all(4));
    expect(obj(r, 'color').status).toBe('short');
    expect(r.targets.find(t => t.id === 'b')!.acts[2]).toEqual({ required: 1, met: 1, fading: 0 });
    expect(r.targets.find(t => t.id === 't')!.acts[2]).toEqual({ required: 1, met: 0, fading: 0 });
  });

  it('marks a target reached only through a stated objective as mixed and soft', () => {
    const l = lib([captured('A', [['color', 2, 2, 2]]), course('B', { stated: [{ competencyId: 'color', k: 3, u: 3, d: 3 }] })]);
    const o = obj(computePlan(l, plan([['A', 1], ['B', 2]])), 'color');
    expect(o.status).toBe('met');
    expect(o.basis).toBe('mixed');
    expect(o.flags).toContain('soft_evidence');
    const strict = obj(computePlan(l, plan([['A', 1], ['B', 2]], { fill: false })), 'color');
    expect(strict.status).toBe('short');
    expect(strict.basis).toBe('discovered');
  });

  it('counts a proposed course and labels it proposed', () => {
    const p = plan([['new:1', 2]], { proposed: [{
      id: 'new:1', source: 'new', code: 'GC 3xxx', credits: null, title: 'New', description: '', objectives: [],
      depths: [{ competencyId: 'press', k: 3, u: 3, d: 3 }],
    }] });
    const o = obj(computePlan(lib([]), p), 'press');
    expect(o.status).toBe('met');
    expect(o.contributions[0]!.basis).toBe('proposed');
    expect(o.basis).toBe('soft');
  });

  it('flags integration with no earlier setup as brittle, and a single carrier', () => {
    const o = obj(computePlan(lib([captured('A', [['color', 0, 0, 5]])]), plan([['A', 3]])), 'color');
    expect(o.flags).toEqual(expect.arrayContaining(['brittle', 'lone_peak']));
  });

  it('weights career-path fit by importance at the final checkpoint', () => {
    const t = computePlan(lib([captured('A', [['color', 3, 3, 3]])]), plan([['A', 1]])).targets[0]!;
    expect(t.acts[2]).toEqual({ required: 3, met: 1, fading: 0 });
    expect(t.acts[0]).toEqual({ required: 0, met: 0, fading: 0 });
    expect(t.fit).toBeCloseTo(1 / (1 + 0.5 + 0.5)); // an unweighted member counts at the membership cutoff
  });

  it('honors added and removed objectives', () => {
    const l = lib([captured('A', [['color', 3, 3, 3], ['press', 3, 3, 3]])]);
    const r = computePlan(l, plan([['A', 1]], {}, {
      targetIds: ['b'], added: ['press'], removed: ['color'], levels: { [PLAN_SCOPE]: { press: final(4) } },
    }));
    expect(r.objectives.map(o => o.competency.id)).toEqual(['press']);
    expect(obj(r, 'press').status).toBe('short');
  });

  it('judges every competency against program targets with no career path chosen, except those switched off', () => {
    const l = lib([captured('A', [['color', 3, 3, 3], ['press', 1, 1, 1]])]);
    const ids = (r: ReturnType<typeof computePlan>) => r.objectives.map(o => o.competency.id).sort();
    const on = computePlan(l, plan([['A', 1]], {}, { targetIds: [], program: { off: [] }, levels: {} }));
    expect(ids(on)).toEqual(['agency', 'color', 'press']);
    expect(on.milestones[0]!.required).toBeGreaterThan(0); // starting values ask for something at Act 1
    const off = computePlan(l, plan([['A', 1]], {}, { targetIds: [], program: { off: ['agency'] }, levels: {} }));
    expect(ids(off)).toEqual(['color', 'press']);
    expect(computePlan(l, plan([['A', 1]], {}, { targetIds: [], levels: {} })).objectives).toEqual([]); // program off: career paths only
  });

  it('uses the stricter of the program target and a chosen career path\'s', () => {
    const l = lib([captured('A', [['color', 3, 3, 3]])]);
    const strict = (program: number, path: number) => obj(computePlan(l, plan([['A', 3]], {}, {
      program: { off: [] }, levels: { [PLAN_SCOPE]: { color: final(program) }, t: { color: final(path), press: final(0), agency: final(0) } },
    })), 'color').required[2]!.d;
    expect(strict(4, 2)).toBe(4);
    expect(strict(2, 4)).toBe(4);
  });

  it('keeps branches apart: a branch course counts only where that branch is in view', () => {
    const l = lib([captured('A', [['color', 1, 1, 1]]), captured('B', [['color', 4, 4, 4]])]);
    const p = plan([['A', 1], ['B', 3, 'brand']], { branches: [{ id: 'brand', name: 'Brand', targetIds: ['b'] }] }, {
      targetIds: ['t', 'b'], levels: { t: { color: final(3), press: final(0), agency: final(0) }, b: { color: final(3) } },
    });
    expect(obj(computePlan(l, p, 'all'), 'color').byAct[2].d).toBe(4);
    expect(obj(computePlan(l, p, []), 'color').byAct[2].d).toBe(1);
    const r = computePlan(l, p, []);
    expect(r.courses.map(c => c.code)).toEqual(['A']);
    // Whatever is in view, each career path is judged on the trunk plus its own branches.
    expect(r.targets.find(t => t.id === 'b')!.acts[2].met).toBe(1);
    expect(r.targets.find(t => t.id === 't')!.acts[2]).toEqual({ required: 1, met: 0, fading: 0 }); // color is short without the branch
  });

  it('a competency reached early stays met at later checkpoints whatever the fade', () => {
    const l = lib([captured('A', [['color', 3, 3, 3]])]);
    const levels = { t: { color: [all(3), all(3), all(3)] as ActLevels, press: final(0), agency: final(0) } };
    for (const fade of [0, 1, 2]) {
      const o = obj(computePlan(l, lastTerm(plan([['A', 1]], { fade }, { levels }))), 'color');
      expect(o.checkpoints.map(c => c.status)).toEqual(['met', 'met', 'met']);
      expect(o.status).toBe('met');
    }
  });

  it('wants a prerequisite in an earlier term, not just earlier on the page', () => {
    const l = lib([captured('A', [['color', 1, 1, 1]]), captured('B', [['color', 2, 2, 2]])],
      [{ courseCode: 'B', prereqCode: 'A', kind: 'prereq', anyOfGroup: null }]);
    const same = computePlan(l, { ...plan([['A', 1], ['B', 1]]), placements: [
      { ref: 'A', act: 1, branch: null, slot: 1, x: 0 }, { ref: 'B', act: 1, branch: null, slot: 1, x: 300 }] });
    expect(same.checks.some(c => c.ref === 'B' && c.kind === 'prereq_order')).toBe(true);
    const earlier = computePlan(l, { ...plan([['A', 1], ['B', 1]]), placements: [
      { ref: 'A', act: 1, branch: null, slot: 0, x: 300 }, { ref: 'B', act: 1, branch: null, slot: 1, x: 0 }] });
    expect(earlier.checks.some(c => c.kind === 'prereq_order')).toBe(false);
  });

  it('checks written objectives through their linked competencies', () => {
    const l = lib([captured('A', [['color', 3, 3, 3]])]);
    const r = computePlan(l, plan([['A', 1]], {}, { written: [
      { id: 'w1', act: 3, targetId: null, text: 'Color', competencyIds: ['color'] },
      { id: 'w2', act: 3, targetId: 't', text: 'Both', competencyIds: ['color', 'press'] },
      { id: 'w3', act: 3, targetId: null, text: 'Loose', competencyIds: [] },
    ] }));
    expect(r.written).toEqual([
      { id: 'w1', status: 'met', met: 1, of: 1 },
      { id: 'w2', status: 'short', met: 1, of: 2 },
      { id: 'w3', status: 'unlinked', met: 0, of: 0 },
    ]);
  });

  describe('order and dependencies', () => {
    const prereqs: Library['prereqs'] = [
      { courseCode: 'B', prereqCode: 'A', kind: 'prereq', anyOfGroup: null },
      { courseCode: 'C', prereqCode: 'A', kind: 'prereq', anyOfGroup: 1 },
      { courseCode: 'C', prereqCode: 'X', kind: 'prereq', anyOfGroup: 1 },
    ];
    const l = lib(['A', 'B', 'C'].map(c => captured(c, [['color', 1, 1, 1]])), prereqs);
    const kinds = (p: PlanState) => computePlan(l, p).checks.map(c => `${c.code}:${c.kind}`);

    it('flags a course placed before a catalog prerequisite, honoring any-of groups', () => {
      expect(kinds(plan([['B', 1], ['A', 2], ['C', 3]]))).toEqual(['B:prereq_order']);
      expect(kinds(plan([['A', 1], ['B', 1]]))).toEqual([]); // earlier position within the same act is enough
    });
    it('flags a prerequisite that is not in the plan', () => {
      expect(kinds(plan([['B', 1]]))).toEqual(['B:prereq_missing']);
    });
    it('lets the plan set a catalog prerequisite aside and add its own dependency', () => {
      expect(kinds(plan([['B', 1]], { unlinked: [{ from: 'A', to: 'B' }] }))).toEqual([]);
      expect(kinds(plan([['A', 2], ['C', 1]], { unlinked: [{ from: 'A', to: 'C' }, { from: 'X', to: 'C' }], links: [{ from: 'A', to: 'C' }] })))
        .toEqual(['C:prereq_order']);
    });
    it('flags a dependency that sits on a different branch', () => {
      const p = plan([['A', 1, 'x'], ['B', 2, 'y']], { branches: [{ id: 'x', name: 'X', targetIds: [] }, { id: 'y', name: 'Y', targetIds: [] }] });
      expect(kinds(p)).toEqual(['B:prereq_branch']);
    });
  });

  it('reports act milestones cumulatively', () => {
    const l = lib([captured('A', [['color', 1, 1, 1]]), captured('B', [['color', 4, 4, 4]])]);
    const levels = { t: { color: [all(1), all(4), all(4)] as ActLevels, press: final(0), agency: final(0) } };
    const m = computePlan(l, plan([['A', 1], ['B', 2]], {}, { levels })).milestones;
    expect(m.map(x => [x.courses, x.introduced, x.integrated, x.required, x.met])).toEqual([[1, 1, 0, 1, 1], [1, 1, 1, 1, 1], [0, 1, 1, 1, 1]]);
  });
});

describe('defaultAct', () => {
  it('places by level, with the two named integration courses in Act 2', () => {
    expect(defaultAct({ code: 'GC 1040', level: 1 })).toBe(1);
    expect(defaultAct({ code: 'GC 3400', level: 3 })).toBe(2);
    expect(defaultAct({ code: 'GC 4400', level: 4 })).toBe(2);
    expect(defaultAct({ code: 'GC 4800', level: 4 })).toBe(3);
  });
});
