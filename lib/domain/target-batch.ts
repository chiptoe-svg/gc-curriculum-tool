/**
 * Pure planning + application logic for scripts/targets/apply-target-batch.ts:
 * bring the live career_targets / sub_competencies rows to the definitions in
 * lib/domain/seed-targets.ts.
 *
 * Rules (2026-10-06 target batch):
 *  - career_targets: update changed content fields only. Targets are never
 *    created here, and id / display_order are never touched.
 *  - sub_competencies listed under a target: update changed fields (incl.
 *    display_order = list position, retired = false); insert when missing.
 *  - sub_competencies on the retired list: set retired = true. Never deleted.
 *  - anything else in the DB is left alone and reported as "unmanaged".
 *  - snapshot_target_coverage and every other table are out of scope: the
 *    writer interface has no operation that could reach them.
 */
import type { CareerTarget, SubCompetency } from './types';
import type { RetiredSubCompetency } from './seed-targets';

export interface DbTargetRow {
  id: string;
  name: string;
  shortDefinition: string;
  industryContexts: string[];
  knowDescriptors: string[];
  understandDescriptors: string[];
  doDescriptors: string[];
  defensibilityNote: string;
  socCode: string | null;
}

export interface DbSubRow {
  id: string;
  careerTargetId: string;
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
  displayOrder: number;
  retired: boolean;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface TargetPlan {
  targetId: string;
  targetName: string;
  targetChanges: FieldChange[];
  subUpdates: Array<{ id: string; changes: FieldChange[] }>;
  subInserts: DbSubRow[];
  subRetires: Array<{ id: string; name: string }>;
  subUnchanged: string[];
  /** Listed as retired but absent from the DB — nothing to do. */
  retireMissing: string[];
  /** In the DB, current, but neither listed nor retired — left untouched. */
  unmanaged: string[];
}

export interface BatchPlan {
  targets: TargetPlan[];
  errors: string[];
  counts: {
    targetsUpdated: number;
    targetsUnchanged: number;
    subsUpdated: number;
    subsInserted: number;
    subsRetired: number;
    subsUnchanged: number;
  };
}

export interface BatchWriter {
  updateTarget(id: string, fields: Partial<DbTargetRow>): Promise<void>;
  updateSub(id: string, fields: Partial<DbSubRow>): Promise<void>;
  insertSub(row: DbSubRow): Promise<void>;
  retireSub(id: string): Promise<void>;
}

const TARGET_FIELDS = [
  'name',
  'shortDefinition',
  'industryContexts',
  'knowDescriptors',
  'understandDescriptors',
  'doDescriptors',
  'defensibilityNote',
  'socCode',
] as const;

const SUB_FIELDS = ['name', 'knowDescriptor', 'understandDescriptor', 'doDescriptor'] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diffFields<T extends object>(before: T, after: T, fields: readonly (keyof T & string)[]): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of fields) {
    if (!same(before[f], after[f])) out.push({ field: f, before: before[f], after: after[f] });
  }
  return out;
}

export function planTargetBatch(
  desired: CareerTarget[],
  retired: RetiredSubCompetency[],
  dbTargets: DbTargetRow[],
  dbSubs: DbSubRow[],
): BatchPlan {
  const errors: string[] = [];
  const targetById = new Map(dbTargets.map(t => [t.id, t]));
  const subById = new Map(dbSubs.map(s => [s.id, s]));
  const desiredIds = new Set(desired.flatMap(t => t.subCompetencies.map(s => s.id)));
  const retiredIds = new Set(retired.map(r => r.id));

  for (const id of retiredIds) {
    if (desiredIds.has(id)) errors.push(`sub-competency ${id} is both current and retired in the definitions`);
  }

  const targets: TargetPlan[] = [];
  for (const t of desired) {
    const current = targetById.get(t.id);
    if (!current) {
      errors.push(`career target ${t.id} not found in the DB (this batch never creates targets)`);
      continue;
    }
    const wanted: DbTargetRow = {
      id: t.id,
      name: t.name,
      shortDefinition: t.shortDefinition,
      industryContexts: t.industryContexts,
      knowDescriptors: t.knowDescriptors,
      understandDescriptors: t.understandDescriptors,
      doDescriptors: t.doDescriptors,
      defensibilityNote: t.defensibilityNote,
      socCode: t.socCode,
    };
    const plan: TargetPlan = {
      targetId: t.id,
      targetName: t.name,
      targetChanges: diffFields(current, wanted, TARGET_FIELDS),
      subUpdates: [],
      subInserts: [],
      subRetires: [],
      subUnchanged: [],
      retireMissing: [],
      unmanaged: [],
    };

    t.subCompetencies.forEach((s: SubCompetency, i: number) => {
      const row: DbSubRow = { ...s, careerTargetId: t.id, displayOrder: i, retired: false };
      const existing = subById.get(s.id);
      if (!existing) {
        plan.subInserts.push(row);
        return;
      }
      if (existing.careerTargetId !== t.id) {
        errors.push(`sub-competency ${s.id} is listed under ${t.id} but belongs to ${existing.careerTargetId} in the DB`);
        return;
      }
      const changes = diffFields(existing, row, [...SUB_FIELDS, 'displayOrder', 'retired']);
      if (changes.length) plan.subUpdates.push({ id: s.id, changes });
      else plan.subUnchanged.push(s.id);
    });

    for (const r of retired.filter(r => r.careerTargetId === t.id)) {
      const existing = subById.get(r.id);
      if (!existing) { plan.retireMissing.push(r.id); continue; }
      if (existing.careerTargetId !== t.id) {
        errors.push(`retired sub-competency ${r.id} is listed under ${t.id} but belongs to ${existing.careerTargetId} in the DB`);
        continue;
      }
      if (!existing.retired) plan.subRetires.push({ id: r.id, name: existing.name });
    }

    plan.unmanaged = dbSubs
      .filter(s => s.careerTargetId === t.id && !s.retired && !desiredIds.has(s.id) && !retiredIds.has(s.id))
      .map(s => s.id);

    targets.push(plan);
  }

  const sum = (f: (p: TargetPlan) => number) => targets.reduce((n, p) => n + f(p), 0);
  return {
    targets,
    errors,
    counts: {
      targetsUpdated: targets.filter(p => p.targetChanges.length > 0).length,
      targetsUnchanged: targets.filter(p => p.targetChanges.length === 0).length,
      subsUpdated: sum(p => p.subUpdates.length),
      subsInserted: sum(p => p.subInserts.length),
      subsRetired: sum(p => p.subRetires.length),
      subsUnchanged: sum(p => p.subUnchanged.length),
    },
  };
}

export async function applyPlan(plan: BatchPlan, writer: BatchWriter): Promise<void> {
  if (plan.errors.length) throw new Error(`refusing to apply a plan with errors:\n${plan.errors.join('\n')}`);
  for (const t of plan.targets) {
    if (t.targetChanges.length) {
      await writer.updateTarget(t.targetId, Object.fromEntries(t.targetChanges.map(c => [c.field, c.after])));
    }
    for (const u of t.subUpdates) {
      await writer.updateSub(u.id, Object.fromEntries(u.changes.map(c => [c.field, c.after])));
    }
    for (const row of t.subInserts) await writer.insertSub(row);
    for (const r of t.subRetires) await writer.retireSub(r.id);
  }
}

function formatChange(c: FieldChange, indent: string): string[] {
  const { field, before, after } = c;
  if (Array.isArray(before) || Array.isArray(after)) {
    const b = (before ?? []) as string[];
    const a = (after ?? []) as string[];
    const lines = [`${indent}${field}:`];
    for (const x of b) if (!a.includes(x)) lines.push(`${indent}  - ${x}`);
    for (const x of a) if (!b.includes(x)) lines.push(`${indent}  + ${x}`);
    if (lines.length === 1) lines.push(`${indent}  (same items, reordered)`);
    return lines;
  }
  if (typeof before === 'string' || typeof after === 'string') {
    return [`${indent}${field}:`, `${indent}  - ${String(before)}`, `${indent}  + ${String(after)}`];
  }
  return [`${indent}${field}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`];
}

export function formatPlan(plan: BatchPlan): string {
  const out: string[] = [];
  for (const t of plan.targets) {
    out.push('', `== ${t.targetId} (${t.targetName})`);
    if (t.targetChanges.length) {
      out.push(`  career_targets: UPDATE ${t.targetChanges.map(c => c.field).join(', ')}`);
      for (const c of t.targetChanges) out.push(...formatChange(c, '    '));
    } else {
      out.push('  career_targets: unchanged');
    }
    for (const u of t.subUpdates) {
      out.push(`  sub_competencies: UPDATE ${u.id} (${u.changes.map(c => c.field).join(', ')})`);
      for (const c of u.changes) out.push(...formatChange(c, '    '));
    }
    for (const r of t.subInserts) {
      out.push(`  sub_competencies: INSERT ${r.id} (display_order ${r.displayOrder}) "${r.name}"`);
      out.push(`    K: ${r.knowDescriptor}`, `    U: ${r.understandDescriptor}`, `    D: ${r.doDescriptor}`);
    }
    for (const r of t.subRetires) out.push(`  sub_competencies: RETIRE ${r.id} "${r.name}" (retired = true; row and its coverage kept)`);
    if (t.subUnchanged.length) out.push(`  sub_competencies unchanged: ${t.subUnchanged.join(', ')}`);
    if (t.retireMissing.length) out.push(`  listed as retired but not in DB (no-op): ${t.retireMissing.join(', ')}`);
    if (t.unmanaged.length) out.push(`  WARNING unmanaged current rows left as-is: ${t.unmanaged.join(', ')}`);
  }
  const c = plan.counts;
  out.push(
    '',
    '== counts',
    `  targets updated: ${c.targetsUpdated}, targets unchanged: ${c.targetsUnchanged}`,
    `  subs updated: ${c.subsUpdated}, subs inserted: ${c.subsInserted}, subs retired: ${c.subsRetired}, subs unchanged: ${c.subsUnchanged}`,
  );
  if (plan.errors.length) out.push('', '== ERRORS (apply refused)', ...plan.errors.map(e => `  ${e}`));
  return out.join('\n');
}
