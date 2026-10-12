import { describe, it, expect } from 'vitest';
import {
  planTargetBatch,
  applyPlan,
  formatPlan,
  type DbTargetRow,
  type DbSubRow,
  type DbMembershipRow,
  type BatchWriter,
} from '@/lib/domain/target-batch';
import type { CareerTarget, TargetCompetencyEntry } from '@/lib/domain/types';
import type { RetiredSubCompetency } from '@/lib/domain/seed-targets';

// ---- fixtures -------------------------------------------------------------

const def = (id: string, name = id): TargetCompetencyEntry => ({
  id,
  name,
  knowDescriptor: `K ${id}`,
  understandDescriptor: `U ${id}`,
  doDescriptor: `D ${id}`,
});
const ref = (id: string): TargetCompetencyEntry => ({ ref: id });

const desiredTarget = (over: Partial<CareerTarget> = {}): CareerTarget => ({
  id: 't1',
  name: 'Target One',
  shortDefinition: 'new definition',
  industryContexts: ['ctx a', 'ctx b'],
  knowDescriptors: ['k1'],
  understandDescriptors: ['u1'],
  doDescriptors: ['d1'],
  defensibilityNote: 'note',
  socCode: null,
  subCompetencies: [def('kept'), def('added')],
  ...over,
});

const dbTarget = (over: Partial<DbTargetRow> = {}): DbTargetRow => ({
  id: 't1',
  name: 'Target One',
  shortDefinition: 'old definition',
  industryContexts: ['ctx a'],
  knowDescriptors: ['k1'],
  understandDescriptors: ['u1'],
  doDescriptors: ['d1'],
  defensibilityNote: 'note',
  socCode: null,
  ...over,
});

const dbSub = (id: string, over: Partial<DbSubRow> = {}): DbSubRow => ({
  id,
  name: id,
  knowDescriptor: `K ${id}`,
  understandDescriptor: `U ${id}`,
  doDescriptor: `D ${id}`,
  retired: false,
  mergedInto: null,
  ...over,
});

const member = (careerTargetId: string, competencyId: string, displayOrder: number): DbMembershipRow => ({
  careerTargetId,
  competencyId,
  displayOrder,
});

/** In-memory "DB" implementing the same writer contract the script uses. */
function memoryDb(targets: DbTargetRow[], subs: DbSubRow[], memberships: DbMembershipRow[]) {
  const t = new Map(targets.map(r => [r.id, { ...r }]));
  const s = new Map(subs.map(r => [r.id, { ...r }]));
  let m = memberships.map(r => ({ ...r }));
  const calls: string[] = [];
  const writer: BatchWriter = {
    async updateTarget(id, fields) { calls.push(`updateTarget ${id}`); Object.assign(t.get(id)!, fields); },
    async insertCompetency(row) {
      calls.push(`insertCompetency ${row.id}`);
      if (s.has(row.id)) throw new Error('duplicate');
      s.set(row.id, { ...row });
    },
    async updateCompetency(id, fields) { calls.push(`updateCompetency ${id}`); Object.assign(s.get(id)!, fields); },
    async retireCompetency(id, mergedInto) {
      calls.push(`retireCompetency ${id}`);
      m = m.filter(row => row.competencyId !== id);
      Object.assign(s.get(id)!, { retired: true, mergedInto });
    },
    async insertMembership(careerTargetId, competencyId, displayOrder) {
      calls.push(`insertMembership ${careerTargetId}/${competencyId}`);
      m.push({ careerTargetId, competencyId, displayOrder });
    },
    async updateMembershipOrder(careerTargetId, competencyId, displayOrder) {
      calls.push(`updateMembershipOrder ${careerTargetId}/${competencyId}`);
      const row = m.find(r => r.careerTargetId === careerTargetId && r.competencyId === competencyId);
      row!.displayOrder = displayOrder;
    },
  };
  return { writer, calls, targets: () => [...t.values()], subs: () => [...s.values()], memberships: () => [...m] };
}

// ---- career-target field diff (unrelated to the catalog) ------------------

describe('planTargetBatch — career target fields', () => {
  it('reports field-level changes on the career target, and only the changed fields', () => {
    const plan = planTargetBatch([desiredTarget()], [], [dbTarget()], [dbSub('kept'), dbSub('added')], [member('t1', 'kept', 0)]);
    const t = plan.targets[0]!;
    expect(t.targetChanges.map(c => c.field)).toEqual(['shortDefinition', 'industryContexts']);
    expect(t.targetChanges[0]).toEqual({ field: 'shortDefinition', before: 'old definition', after: 'new definition' });
  });

  it('errors when a target is missing (this batch never creates targets)', () => {
    const plan = planTargetBatch([desiredTarget()], [], [], [], []);
    expect(plan.errors[0]).toMatch(/career target t1 not found/);
  });
});

// ---- Rule 1: one definition per id ------------------------------------------

describe('planTargetBatch — Rule 1: one definition per id', () => {
  it('errors "competency <id> is defined more than once" when two targets both carry a full definition', () => {
    const t1 = desiredTarget({ id: 't1', subCompetencies: [def('dup')] });
    const t2 = desiredTarget({ id: 't2', name: 'Target Two', subCompetencies: [def('dup')] });
    const plan = planTargetBatch(
      [t1, t2], [],
      [dbTarget(), dbTarget({ id: 't2', name: 'Target Two' })],
      [dbSub('dup')],
      [member('t1', 'dup', 0)],
    );
    expect(plan.errors).toContain('competency dup is defined more than once');
  });

  it('errors "ref <id> has no definition" when no target carries the full definition', () => {
    const plan = planTargetBatch([desiredTarget({ subCompetencies: [ref('missing')] })], [], [dbTarget()], [], []);
    expect(plan.errors).toContain('ref missing has no definition');
  });

  it('a ref resolving to a real definition elsewhere is not an error', () => {
    const t1 = desiredTarget({ id: 't1', subCompetencies: [def('shared')] });
    const t2 = desiredTarget({ id: 't2', name: 'Target Two', subCompetencies: [ref('shared')] });
    const plan = planTargetBatch(
      [t1, t2], [],
      [dbTarget(), dbTarget({ id: 't2', name: 'Target Two' })],
      [dbSub('shared')],
      [member('t1', 'shared', 0), member('t2', 'shared', 0)],
    );
    expect(plan.errors).toEqual([]);
  });
});

// ---- Rule 2: catalog fields diffed once per definition, not per target ----

describe('planTargetBatch — Rule 2: catalog diffed once per definition', () => {
  it('a changed descriptor shows up as exactly one competencyUpdate, even with two other targets ref-ing the same id', () => {
    const shared = def('shared', 'Shared Name');
    const t1 = desiredTarget({ id: 't1', subCompetencies: [shared] });
    const t2 = desiredTarget({ id: 't2', name: 'Target Two', subCompetencies: [ref('shared')] });
    const t3 = desiredTarget({ id: 't3', name: 'Target Three', subCompetencies: [ref('shared')] });
    const plan = planTargetBatch(
      [t1, t2, t3], [],
      [dbTarget(), dbTarget({ id: 't2', name: 'Target Two' }), dbTarget({ id: 't3', name: 'Target Three' })],
      [dbSub('shared', { name: 'Old Name' })],
      [member('t1', 'shared', 0), member('t2', 'shared', 0), member('t3', 'shared', 0)],
    );
    expect(plan.competencyUpdates).toEqual([{ id: 'shared', changes: [{ field: 'name', before: 'Old Name', after: 'Shared Name' }] }]);
    expect(plan.counts.competenciesUpdated).toBe(1);
    // and no per-target duplication of the update anywhere in the target plans
    for (const t of plan.targets) {
      expect(t).not.toHaveProperty('subUpdates');
    }
  });

  it('inserts a brand-new definition exactly once into the catalog', () => {
    const plan = planTargetBatch([desiredTarget({ subCompetencies: [def('kept'), def('added')] })], [], [dbTarget()], [dbSub('kept')], [member('t1', 'kept', 0)]);
    expect(plan.competencyInserts).toEqual([{ id: 'added', name: 'added', knowDescriptor: 'K added', understandDescriptor: 'U added', doDescriptor: 'D added', retired: false, mergedInto: null }]);
  });
});

// ---- Rule 3: memberships — inserts, order updates, removals ---------------

describe('planTargetBatch — Rule 3: membership diff per target', () => {
  it('inserts a new membership at its list position', () => {
    const plan = planTargetBatch([desiredTarget()], [], [dbTarget()], [dbSub('kept'), dbSub('added')], [member('t1', 'kept', 0)]);
    expect(plan.targets[0]!.membershipInserts).toEqual([{ competencyId: 'added', displayOrder: 1 }]);
  });

  it('reports (but does not apply) a current member that is no longer desired and is not retired', () => {
    const plan = planTargetBatch(
      [desiredTarget({ subCompetencies: [def('kept')] })], [],
      [dbTarget()], [dbSub('kept'), dbSub('extra')],
      [member('t1', 'kept', 0), member('t1', 'extra', 1)],
    );
    expect(plan.targets[0]!.membershipRemovals).toEqual(['extra']);
  });

  it('does not report a removal for a current member that is on the retired list', () => {
    const retiredList: RetiredSubCompetency[] = [{ id: 'gone', careerTargetId: 't1', retiredOn: '2026-10-12', reason: 'test' }];
    const plan = planTargetBatch(
      [desiredTarget({ subCompetencies: [def('kept')] })], retiredList,
      [dbTarget()], [dbSub('kept'), dbSub('gone')],
      [member('t1', 'kept', 0), member('t1', 'gone', 1)],
    );
    expect(plan.targets[0]!.membershipRemovals).toEqual([]);
  });

  it('compares relative order only — a gap in display_order (e.g. from an earlier removal) is not a change', () => {
    const plan = planTargetBatch(
      [desiredTarget({ subCompetencies: [def('a'), def('b'), def('c')] })], [],
      [dbTarget()], [dbSub('a'), dbSub('b'), dbSub('c')],
      [member('t1', 'a', 0), member('t1', 'b', 3), member('t1', 'c', 6)],
    );
    expect(plan.targets[0]!.orderUpdates).toEqual([]);
    expect(plan.targets[0]!.membershipUnchanged).toEqual(['a', 'b', 'c']);
  });

  it('emits order updates when the relative order actually changed', () => {
    const plan = planTargetBatch(
      [desiredTarget({ subCompetencies: [def('a'), def('b')] })], [],
      [dbTarget()], [dbSub('a'), dbSub('b')],
      [member('t1', 'a', 5), member('t1', 'b', 1)], // b currently sorts before a
    );
    expect(plan.targets[0]!.orderUpdates).toEqual([{ competencyId: 'a', from: 5, to: 0 }]);
  });

  it('un-retires a membership whose catalog row the definitions list as current (via a competencyUpdate, not membership)', () => {
    const plan = planTargetBatch(
      [desiredTarget({ subCompetencies: [def('kept')] })], [],
      [dbTarget()], [dbSub('kept', { retired: true })],
      [member('t1', 'kept', 0)],
    );
    expect(plan.competencyUpdates).toEqual([{ id: 'kept', changes: [{ field: 'retired', before: true, after: false }] }]);
  });
});

// ---- Rule 4: retired entries -------------------------------------------------

describe('planTargetBatch — Rule 4: retired entries', () => {
  it('retires a catalog row (retired=true, mergedInto set) instead of deleting it', () => {
    const retiredList: RetiredSubCompetency[] = [{ id: 'gone', careerTargetId: 't1', retiredOn: '2026-10-12', mergedInto: 'kept', reason: 'test merge' }];
    const plan = planTargetBatch(
      [desiredTarget({ subCompetencies: [def('kept')] })], retiredList,
      [dbTarget()], [dbSub('kept'), dbSub('gone')],
      [member('t1', 'kept', 0), member('t1', 'gone', 1)],
    );
    expect(plan.competencyRetires).toEqual([{ id: 'gone', name: 'gone', mergedInto: 'kept' }]);
  });

  it('is a no-op (not an error) when a retired id is already retired in the DB', () => {
    const retiredList: RetiredSubCompetency[] = [{ id: 'gone', careerTargetId: 't1', retiredOn: '2026-10-12', reason: 'test' }];
    const plan = planTargetBatch([desiredTarget({ subCompetencies: [def('kept')] })], retiredList, [dbTarget()], [dbSub('kept'), dbSub('gone', { retired: true })], [member('t1', 'kept', 0)]);
    expect(plan.competencyRetires).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it('errors when an id is both current (desired somewhere) and on the retired list', () => {
    const retiredList: RetiredSubCompetency[] = [{ id: 'kept', careerTargetId: 't1', retiredOn: '2026-10-12', reason: 'test' }];
    const plan = planTargetBatch([desiredTarget({ subCompetencies: [def('kept')] })], retiredList, [dbTarget()], [dbSub('kept')], [member('t1', 'kept', 0)]);
    expect(plan.errors[0]).toMatch(/kept.*both/);
  });

  it('is a no-op when a retired id is not in the DB at all', () => {
    const retiredList: RetiredSubCompetency[] = [{ id: 'never-existed', careerTargetId: 't1', retiredOn: '2026-10-12', reason: 'test' }];
    const plan = planTargetBatch([desiredTarget({ subCompetencies: [def('kept')] })], retiredList, [dbTarget()], [dbSub('kept')], [member('t1', 'kept', 0)]);
    expect(plan.competencyRetires).toEqual([]);
    expect(plan.errors).toEqual([]);
  });
});

// ---- Rule 5: the P0a M-5 hazard can't recur --------------------------------

describe('planTargetBatch — Rule 5: a moved definition is an insert + a removal, never a silent second membership', () => {
  it('a definition moved to a different target shows as a membership insert in the new target and a reported removal in the old one', () => {
    const oldTarget = desiredTarget({ id: 't1', subCompetencies: [] });
    const newTarget = desiredTarget({ id: 't2', name: 'Target Two', subCompetencies: [def('moved')] });
    const plan = planTargetBatch(
      [oldTarget, newTarget], [],
      [dbTarget(), dbTarget({ id: 't2', name: 'Target Two' })],
      [dbSub('moved')],
      [member('t1', 'moved', 0)],
    );
    const t1Plan = plan.targets.find(t => t.targetId === 't1')!;
    const t2Plan = plan.targets.find(t => t.targetId === 't2')!;
    expect(t1Plan.membershipRemovals).toEqual(['moved']);
    expect(t2Plan.membershipInserts).toEqual([{ competencyId: 'moved', displayOrder: 0 }]);
    expect(plan.errors).toEqual([]);
    // the old target keeps no membership for it in the plan — never a silent second membership
    expect(t1Plan.membershipInserts).toEqual([]);
  });
});

// ---- formatPlan readability (Resolution 3) ---------------------------------

describe('formatPlan', () => {
  it('includes membership inserts, order updates, removals, and counts', () => {
    const plan = planTargetBatch(
      [desiredTarget({ subCompetencies: [def('kept'), def('added')] })], [],
      [dbTarget()], [dbSub('kept', { name: 'old name' }), dbSub('extra')],
      [member('t1', 'kept', 0), member('t1', 'extra', 1)],
    );
    const out = formatPlan(plan);
    expect(out).toContain('t1 (Target One)');
    expect(out).toContain('career_target_requirements: INSERT added (display_order 1)');
    expect(out).toContain('WARNING membership not desired and not retired, left as-is: extra');
    expect(out).toMatch(/memberships inserted: 1/);
  });
});

// ---- apply + idempotence ---------------------------------------------------

describe('applyPlan — idempotence', () => {
  it('a second plan after applying is empty, and a second apply writes nothing', async () => {
    const mem = memoryDb([dbTarget()], [dbSub('kept', { name: 'old name' })], [member('t1', 'kept', 0)]);
    const first = planTargetBatch([desiredTarget()], [], mem.targets(), mem.subs(), mem.memberships());
    await applyPlan(first, mem.writer);
    expect(mem.calls).toEqual(['insertCompetency added', 'updateCompetency kept', 'updateTarget t1', 'insertMembership t1/added']);

    const second = planTargetBatch([desiredTarget()], [], mem.targets(), mem.subs(), mem.memberships());
    expect(second.counts).toMatchObject({ targetsUpdated: 0, competenciesUpdated: 0, competenciesInserted: 0, competenciesRetired: 0, membershipsInserted: 0, membershipsReordered: 0 });
    mem.calls.length = 0;
    await applyPlan(second, mem.writer);
    expect(mem.calls).toEqual([]);
  });

  it('never writes when the plan has errors', async () => {
    const mem = memoryDb([], [], []);
    const plan = planTargetBatch([desiredTarget()], [], mem.targets(), mem.subs(), mem.memberships());
    await expect(applyPlan(plan, mem.writer)).rejects.toThrow(/refusing/);
    expect(mem.calls).toEqual([]);
  });

  it('applying a retire removes every membership for the id and sets retired + mergedInto', async () => {
    const retiredList: RetiredSubCompetency[] = [{ id: 'gone', careerTargetId: 't1', retiredOn: '2026-10-12', mergedInto: 'kept', reason: 'test merge' }];
    const mem = memoryDb(
      [dbTarget(), dbTarget({ id: 't2', name: 'Target Two' })],
      [dbSub('kept'), dbSub('gone')],
      [member('t1', 'kept', 0), member('t1', 'gone', 1), member('t2', 'gone', 0)],
    );
    const plan = planTargetBatch(
      [desiredTarget({ subCompetencies: [def('kept')] }), desiredTarget({ id: 't2', name: 'Target Two', subCompetencies: [] })],
      retiredList, mem.targets(), mem.subs(), mem.memberships(),
    );
    await applyPlan(plan, mem.writer);
    expect(mem.memberships().filter(m => m.competencyId === 'gone')).toEqual([]);
    expect(mem.subs().find(s => s.id === 'gone')).toMatchObject({ retired: true, mergedInto: 'kept' });
  });

  it('brings a P0b-merge-shaped DB (pre-apply, with timeline-management/gc-production-literacy/domain-grounding still active) to zero diff in one pass', async () => {
    const mem = memoryDb(
      [dbTarget({ id: 'a', name: 'A' }), dbTarget({ id: 'b', name: 'B' })],
      [dbSub('shared-survivor', { name: 'old name' }), dbSub('old-a'), dbSub('old-b')],
      [member('a', 'shared-survivor', 0), member('a', 'old-a', 1), member('b', 'old-b', 0)],
    );
    const retiredList: RetiredSubCompetency[] = [
      { id: 'old-a', careerTargetId: 'a', retiredOn: '2026-10-12', mergedInto: 'shared-survivor', reason: 'merge' },
      { id: 'old-b', careerTargetId: 'b', retiredOn: '2026-10-12', mergedInto: 'shared-survivor', reason: 'merge' },
    ];
    const desired: CareerTarget[] = [
      desiredTarget({ id: 'a', name: 'A', shortDefinition: 'old definition', industryContexts: ['ctx a'], subCompetencies: [def('shared-survivor', 'new name')] }),
      desiredTarget({ id: 'b', name: 'B', shortDefinition: 'old definition', industryContexts: ['ctx a'], subCompetencies: [ref('shared-survivor')] }),
    ];
    const plan = planTargetBatch(desired, retiredList, mem.targets(), mem.subs(), mem.memberships());
    expect(plan.errors).toEqual([]);
    await applyPlan(plan, mem.writer);

    const after = planTargetBatch(desired, retiredList, mem.targets(), mem.subs(), mem.memberships());
    expect(after.counts).toMatchObject({
      targetsUpdated: 0, competenciesUpdated: 0, competenciesInserted: 0, competenciesRetired: 0,
      membershipsInserted: 0, membershipsReordered: 0,
    });
    expect(mem.subs().filter(s => s.retired).map(s => s.id).sort()).toEqual(['old-a', 'old-b']);
    expect(mem.memberships().map(m => `${m.careerTargetId}/${m.competencyId}`).sort()).toEqual(['a/shared-survivor', 'b/shared-survivor']);
  });
});
