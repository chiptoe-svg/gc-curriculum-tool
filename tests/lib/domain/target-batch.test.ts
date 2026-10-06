import { describe, it, expect } from 'vitest';
import {
  planTargetBatch,
  applyPlan,
  formatPlan,
  type DbTargetRow,
  type DbSubRow,
  type BatchWriter,
} from '@/lib/domain/target-batch';
import type { CareerTarget } from '@/lib/domain/types';
import type { RetiredSubCompetency } from '@/lib/domain/seed-targets';
import { CAREER_TARGETS, RETIRED_SUB_COMPETENCIES } from '@/lib/domain/seed-targets';

// ---- fixtures -------------------------------------------------------------

const sub = (id: string, name = id) => ({
  id,
  name,
  knowDescriptor: `K ${id}`,
  understandDescriptor: `U ${id}`,
  doDescriptor: `D ${id}`,
});

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
  subCompetencies: [sub('kept'), sub('added')],
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
  ...sub(id),
  careerTargetId: 't1',
  displayOrder: 0,
  retired: false,
  ...over,
});

const retiredList: RetiredSubCompetency[] = [
  { id: 'gone', careerTargetId: 't1', retiredOn: '2026-10-06', reason: 'test' },
];

/** In-memory "DB" implementing the same writer contract the script uses. */
function memoryDb(targets: DbTargetRow[], subs: DbSubRow[]) {
  const t = new Map(targets.map(r => [r.id, { ...r }]));
  const s = new Map(subs.map(r => [r.id, { ...r }]));
  const calls: string[] = [];
  const writer: BatchWriter = {
    async updateTarget(id, fields) { calls.push(`updateTarget ${id}`); Object.assign(t.get(id)!, fields); },
    async updateSub(id, fields) { calls.push(`updateSub ${id}`); Object.assign(s.get(id)!, fields); },
    async insertSub(row) { calls.push(`insertSub ${row.id}`); if (s.has(row.id)) throw new Error('duplicate'); s.set(row.id, { ...row }); },
    async retireSub(id) { calls.push(`retireSub ${id}`); s.get(id)!.retired = true; },
  };
  return { writer, calls, targets: () => [...t.values()], subs: () => [...s.values()] };
}

// ---- diff ------------------------------------------------------------------

describe('planTargetBatch — diff', () => {
  const plan = planTargetBatch(
    [desiredTarget()],
    retiredList,
    [dbTarget()],
    [dbSub('kept', { name: 'old name', displayOrder: 3 }), dbSub('gone', { displayOrder: 1 })],
  );
  const t = plan.targets[0]!;

  it('reports field-level changes on the career target, and only the changed fields', () => {
    expect(t.targetChanges.map(c => c.field)).toEqual(['shortDefinition', 'industryContexts']);
    expect(t.targetChanges[0]).toEqual({ field: 'shortDefinition', before: 'old definition', after: 'new definition' });
  });

  it('updates a kept sub-competency field by field, including display order', () => {
    expect(t.subUpdates).toEqual([
      { id: 'kept', changes: [
        { field: 'name', before: 'old name', after: 'kept' },
        { field: 'displayOrder', before: 3, after: 0 },
      ] },
    ]);
  });

  it('inserts a new sub-competency at its list position', () => {
    expect(t.subInserts).toEqual([{ ...sub('added'), careerTargetId: 't1', displayOrder: 1, retired: false }]);
  });

  it('retires a listed sub-competency instead of deleting it', () => {
    expect(t.subRetires).toEqual([{ id: 'gone', name: 'gone' }]);
  });

  it('counts the work', () => {
    expect(plan.counts).toEqual({
      targetsUpdated: 1, subsUpdated: 1, subsInserted: 1, subsRetired: 1, subsUnchanged: 0, targetsUnchanged: 0,
    });
    expect(plan.errors).toEqual([]);
  });

  it('formats a readable per-target diff with counts', () => {
    const out = formatPlan(plan);
    expect(out).toContain('t1 (Target One)');
    expect(out).toContain('- old definition');
    expect(out).toContain('+ new definition');
    expect(out).toContain('+ ctx b');
    expect(out).toContain('INSERT added');
    expect(out).toContain('RETIRE gone');
    expect(out).toMatch(/subs updated: 1/);
  });

  it('leaves unlisted DB sub-competencies alone and reports them', () => {
    const p = planTargetBatch([desiredTarget({ subCompetencies: [sub('kept')] })], [], [dbTarget()], [dbSub('kept'), dbSub('extra', { displayOrder: 1 })]);
    expect(p.targets[0]!.unmanaged).toEqual(['extra']);
    expect(p.targets[0]!.subRetires).toEqual([]);
  });

  it('un-retires a sub-competency that the definitions list as current', () => {
    const p = planTargetBatch([desiredTarget({ subCompetencies: [sub('kept')] })], [], [dbTarget()], [dbSub('kept', { retired: true })]);
    expect(p.targets[0]!.subUpdates[0]!.changes).toEqual([{ field: 'retired', before: true, after: false }]);
  });

  it('refuses (errors) when a target is missing or an id belongs to another target', () => {
    expect(planTargetBatch([desiredTarget()], [], [], []).errors[0]).toMatch(/career target t1 not found/);
    const p = planTargetBatch([desiredTarget()], [], [dbTarget()], [dbSub('kept', { careerTargetId: 'other' })]);
    expect(p.errors[0]).toMatch(/kept.*belongs to other/);
  });

  it('refuses when an id is both current and on the retired list', () => {
    const p = planTargetBatch([desiredTarget()], [{ ...retiredList[0]!, id: 'kept' }], [dbTarget()], [dbSub('kept')]);
    expect(p.errors[0]).toMatch(/kept.*both/);
  });
});

// ---- apply + idempotence ---------------------------------------------------

describe('applyPlan — idempotence', () => {
  it('a second plan after applying is empty, and a second apply writes nothing', async () => {
    const mem = memoryDb([dbTarget()], [dbSub('kept', { name: 'old name' }), dbSub('gone')]);
    const first = planTargetBatch([desiredTarget()], retiredList, mem.targets(), mem.subs());
    await applyPlan(first, mem.writer);
    expect(mem.calls).toEqual(['updateTarget t1', 'updateSub kept', 'insertSub added', 'retireSub gone']);

    const second = planTargetBatch([desiredTarget()], retiredList, mem.targets(), mem.subs());
    expect(second.counts).toMatchObject({ targetsUpdated: 0, subsUpdated: 0, subsInserted: 0, subsRetired: 0 });
    mem.calls.length = 0;
    await applyPlan(second, mem.writer);
    expect(mem.calls).toEqual([]);
  });

  it('never writes when the plan has errors', async () => {
    const mem = memoryDb([], []);
    const plan = planTargetBatch([desiredTarget()], [], mem.targets(), mem.subs());
    await expect(applyPlan(plan, mem.writer)).rejects.toThrow(/refusing/);
    expect(mem.calls).toEqual([]);
  });

  it('brings a pre-batch production-shaped DB to the seed definitions in one pass', async () => {
    // Pre-batch prod shape (read 2026-10-06): target 5 has its six old ids; nothing retired.
    const oldT5 = ['ai-tool-evaluation', 'workflow-architecture', 'prompt-design', 'quality-frameworks', 'change-management', 'domain-grounding'];
    const targets: DbTargetRow[] = CAREER_TARGETS.map(t => ({ ...t, shortDefinition: 'old', subCompetencies: undefined } as unknown as DbTargetRow));
    const subs: DbSubRow[] = [];
    for (const t of CAREER_TARGETS) {
      if (t.id === 'ai-workflow') { oldT5.forEach((id, i) => subs.push(dbSub(id, { careerTargetId: t.id, displayOrder: i }))); continue; }
      t.subCompetencies.filter(s => s.id !== 'project-management').forEach((s, i) => subs.push({ ...s, careerTargetId: t.id, displayOrder: i, retired: false }));
    }
    const mem = memoryDb(targets, subs);
    const plan = planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, mem.targets(), mem.subs());
    expect(plan.errors).toEqual([]);
    expect(plan.counts.subsInserted).toBe(6); // 5 new in target 5 + project-management
    expect(plan.counts.subsRetired).toBe(2);
    await applyPlan(plan, mem.writer);
    const after = planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, mem.targets(), mem.subs());
    expect(after.counts).toMatchObject({ targetsUpdated: 0, subsUpdated: 0, subsInserted: 0, subsRetired: 0 });
    const retired = mem.subs().filter(s => s.retired).map(s => s.id).sort();
    expect(retired).toEqual(['change-management', 'prompt-design']);
    expect(mem.subs()).toHaveLength(subs.length + 6); // nothing deleted
  });
});
