/**
 * Pure planning + application logic for scripts/targets/apply-target-batch.ts:
 * bring the live career_targets / sub_competencies / career_target_requirements
 * rows to the definitions in lib/domain/seed-targets.ts.
 *
 * P0b (competency catalog, migration 0057): a competency's catalog row
 * (sub_competencies) and its membership in a target (career_target_requirements)
 * are separate concerns, because one competency can now be required by
 * several targets (a merge survivor like domain-knowledge). The catalog is
 * diffed once per id, from whichever target carries its full definition;
 * membership is diffed per target, from every entry (definition or `{ ref }`)
 * in that target's list.
 *
 * Rules (2026-10-12 P0b target batch):
 *  - career_targets: update changed content fields only. Targets are never
 *    created here, and id / display_order are never touched.
 *  - One definition per id: a competency id has exactly one full definition
 *    across all targets; every other target lists `{ ref: id }`. Two
 *    definitions, or a ref with no definition, is an error.
 *  - Catalog fields (name, descriptors, retired, mergedInto) are diffed once
 *    per definition, not once per target that references it.
 *  - Membership: for each target, the desired members (definitions and refs
 *    resolved to ids), in list order 0..n-1, are compared against
 *    career_target_requirements. The result is membership inserts, order
 *    updates, and membershipRemovals. Order comparison is by RELATIVE order
 *    only — two lists in the same relative sequence are unchanged even if
 *    the underlying display_order values have gaps (e.g. a prior removal).
 *  - A membership removal (a current member no longer desired for this
 *    target and not on the retired list) is reported only, never applied
 *    automatically — same as the old `unmanaged`. A moved definition (one
 *    target's ref becomes another's, or vice versa) therefore shows up as
 *    an insert in the new target plus a removal in the old one, never a
 *    silent second membership.
 *  - Retired entries: set sub_competencies.retired = true and merged_into,
 *    and remove every career_target_requirements row for that id (across
 *    every target) — this is the only automatic membership removal. An
 *    entry listed as retired that is still desired anywhere is an error.
 *  - snapshot_target_coverage and every other table are out of scope: the
 *    writer interface has no operation that could reach them.
 */
import type { CareerTarget, SubCompetency } from './types';
import { competencyEntryId, isSubCompetencyDefinition } from './types';
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

/** A catalog competency row (sub_competencies). Membership lives separately in DbMembershipRow. */
export interface DbSubRow {
  id: string;
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
  retired: boolean;
  mergedInto: string | null;
}

/** One (target, competency) membership, with its position within that target. */
export interface DbMembershipRow {
  careerTargetId: string;
  competencyId: string;
  displayOrder: number;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface CatalogUpdate {
  id: string;
  changes: FieldChange[];
}

export interface CatalogRetire {
  id: string;
  name: string;
  mergedInto: string | null;
}

export interface TargetPlan {
  targetId: string;
  targetName: string;
  targetChanges: FieldChange[];
  membershipInserts: Array<{ competencyId: string; displayOrder: number }>;
  orderUpdates: Array<{ competencyId: string; from: number; to: number }>;
  /** Current member, not desired for this target, not on the retired list. Reported only, never applied. */
  membershipRemovals: string[];
  membershipUnchanged: string[];
}

export interface BatchPlan {
  targets: TargetPlan[];
  competencyInserts: DbSubRow[];
  competencyUpdates: CatalogUpdate[];
  competencyRetires: CatalogRetire[];
  competencyUnchanged: string[];
  errors: string[];
  counts: {
    targetsUpdated: number;
    targetsUnchanged: number;
    competenciesInserted: number;
    competenciesUpdated: number;
    competenciesRetired: number;
    membershipsInserted: number;
    membershipsReordered: number;
    membershipsRemoved: number;
  };
}

export interface BatchWriter {
  updateTarget(id: string, fields: Partial<DbTargetRow>): Promise<void>;
  insertCompetency(row: DbSubRow): Promise<void>;
  updateCompetency(id: string, fields: Partial<Omit<DbSubRow, 'id'>>): Promise<void>;
  /** Removes every membership for this id (across all targets) and retires the catalog row. */
  retireCompetency(id: string, mergedInto: string | null): Promise<void>;
  insertMembership(careerTargetId: string, competencyId: string, displayOrder: number): Promise<void>;
  updateMembershipOrder(careerTargetId: string, competencyId: string, displayOrder: number): Promise<void>;
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

const CATALOG_FIELDS = ['name', 'knowDescriptor', 'understandDescriptor', 'doDescriptor', 'retired', 'mergedInto'] as const;

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
  dbMemberships: DbMembershipRow[],
): BatchPlan {
  const errors: string[] = [];
  const targetById = new Map(dbTargets.map(t => [t.id, t]));
  const subById = new Map(dbSubs.map(s => [s.id, s]));
  const retiredIds = new Set(retired.map(r => r.id));
  const retiredById = new Map(retired.map(r => [r.id, r]));

  // ---- Rule 1: one definition per id; every ref must resolve. ------------
  const definitionOwner = new Map<string, { targetId: string; sub: SubCompetency }>();
  const refIds = new Set<string>();
  const desiredIdsByTarget = new Map<string, string[]>();
  const desiredIdSet = new Set<string>();

  for (const t of desired) {
    const ids: string[] = [];
    for (const entry of t.subCompetencies) {
      const id = competencyEntryId(entry);
      ids.push(id);
      desiredIdSet.add(id);
      if (isSubCompetencyDefinition(entry)) {
        if (definitionOwner.has(id)) {
          errors.push(`competency ${id} is defined more than once`);
        } else {
          definitionOwner.set(id, { targetId: t.id, sub: entry });
        }
      } else {
        refIds.add(id);
      }
    }
    desiredIdsByTarget.set(t.id, ids);
  }
  for (const id of refIds) {
    if (!definitionOwner.has(id)) errors.push(`ref ${id} has no definition`);
  }

  // ---- Rule 4 (part 1): a retired id must not be desired anywhere. -------
  for (const id of retiredIds) {
    if (desiredIdSet.has(id)) errors.push(`sub-competency ${id} is both current and retired in the definitions`);
  }

  // ---- Rule 2: catalog diff, once per definition. -------------------------
  const competencyInserts: DbSubRow[] = [];
  const competencyUpdates: CatalogUpdate[] = [];
  const competencyUnchanged: string[] = [];
  for (const [id, { sub }] of definitionOwner) {
    const wanted: DbSubRow = {
      id,
      name: sub.name,
      knowDescriptor: sub.knowDescriptor,
      understandDescriptor: sub.understandDescriptor,
      doDescriptor: sub.doDescriptor,
      retired: false,
      mergedInto: null,
    };
    const existing = subById.get(id);
    if (!existing) {
      competencyInserts.push(wanted);
      continue;
    }
    const changes = diffFields(existing, wanted, CATALOG_FIELDS);
    if (changes.length) competencyUpdates.push({ id, changes });
    else competencyUnchanged.push(id);
  }

  // ---- Rule 4 (part 2): retires. -------------------------------------------
  const competencyRetires: CatalogRetire[] = [];
  for (const r of retired) {
    const existing = subById.get(r.id);
    if (!existing) continue; // listed as retired but not in the DB: no-op.
    if (existing.retired) continue; // already retired: unchanged.
    competencyRetires.push({ id: r.id, name: existing.name, mergedInto: r.mergedInto ?? null });
  }

  // ---- Rule 3 + 5: per-target membership. ---------------------------------
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
    const targetChanges = diffFields(current, wanted, TARGET_FIELDS);

    const desiredIds = desiredIdsByTarget.get(t.id)!;
    const currentMembers = dbMemberships.filter(m => m.careerTargetId === t.id);
    const currentOrderById = new Map(currentMembers.map(m => [m.competencyId, m.displayOrder]));

    const membershipInserts: Array<{ competencyId: string; displayOrder: number }> = [];
    const membershipUnchanged: string[] = [];
    desiredIds.forEach((id, i) => {
      if (!currentOrderById.has(id)) membershipInserts.push({ competencyId: id, displayOrder: i });
    });

    // Relative-order check, over members that are both desired and already
    // present (new inserts don't yet have a DB order to compare). Two
    // sequences in the same relative order are unchanged even if the
    // underlying display_order values have gaps (Resolution 2).
    const existingDesiredIds = desiredIds.filter(id => currentOrderById.has(id));
    const dbOrderOfExisting = [...existingDesiredIds].sort((a, b) => currentOrderById.get(a)! - currentOrderById.get(b)!);
    const relativeOrderMatches = existingDesiredIds.every((id, i) => id === dbOrderOfExisting[i]);

    const orderUpdates: Array<{ competencyId: string; from: number; to: number }> = [];
    if (relativeOrderMatches) {
      membershipUnchanged.push(...existingDesiredIds);
    } else {
      // A real reorder: renumber the whole desired list to a clean 0..n-1
      // sequence (new inserts already use this numbering above).
      desiredIds.forEach((id, i) => {
        const from = currentOrderById.get(id);
        if (from !== undefined) {
          if (from !== i) orderUpdates.push({ competencyId: id, from, to: i });
          else membershipUnchanged.push(id);
        }
      });
    }

    const desiredIdSetForTarget = new Set(desiredIds);
    const membershipRemovals = currentMembers
      .map(m => m.competencyId)
      .filter(id => !desiredIdSetForTarget.has(id) && !retiredIds.has(id));

    targets.push({
      targetId: t.id,
      targetName: t.name,
      targetChanges,
      membershipInserts,
      orderUpdates,
      membershipRemovals,
      membershipUnchanged,
    });
  }

  const sum = (f: (p: TargetPlan) => number) => targets.reduce((n, p) => n + f(p), 0);
  return {
    targets,
    competencyInserts,
    competencyUpdates,
    competencyRetires,
    competencyUnchanged,
    errors,
    counts: {
      targetsUpdated: targets.filter(p => p.targetChanges.length > 0).length,
      targetsUnchanged: targets.filter(p => p.targetChanges.length === 0).length,
      competenciesInserted: competencyInserts.length,
      competenciesUpdated: competencyUpdates.length,
      competenciesRetired: competencyRetires.length,
      membershipsInserted: sum(p => p.membershipInserts.length),
      membershipsReordered: sum(p => p.orderUpdates.length),
      membershipsRemoved: sum(p => p.membershipRemovals.length),
    },
  };
}

export async function applyPlan(plan: BatchPlan, writer: BatchWriter): Promise<void> {
  if (plan.errors.length) throw new Error(`refusing to apply a plan with errors:\n${plan.errors.join('\n')}`);

  for (const row of plan.competencyInserts) await writer.insertCompetency(row);
  for (const u of plan.competencyUpdates) {
    await writer.updateCompetency(u.id, Object.fromEntries(u.changes.map(c => [c.field, c.after])));
  }

  for (const t of plan.targets) {
    if (t.targetChanges.length) {
      await writer.updateTarget(t.targetId, Object.fromEntries(t.targetChanges.map(c => [c.field, c.after])));
    }
    for (const m of t.membershipInserts) await writer.insertMembership(t.targetId, m.competencyId, m.displayOrder);
    for (const o of t.orderUpdates) await writer.updateMembershipOrder(t.targetId, o.competencyId, o.to);
    // t.membershipRemovals is reported only — never applied automatically.
  }

  for (const r of plan.competencyRetires) await writer.retireCompetency(r.id, r.mergedInto);
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

  out.push('== catalog (sub_competencies; one entry per definition, not per target)');
  if (!plan.competencyInserts.length && !plan.competencyUpdates.length && !plan.competencyRetires.length) {
    out.push('  unchanged');
  }
  for (const r of plan.competencyInserts) {
    out.push(`  INSERT ${r.id} "${r.name}"`);
    out.push(`    K: ${r.knowDescriptor}`, `    U: ${r.understandDescriptor}`, `    D: ${r.doDescriptor}`);
  }
  for (const u of plan.competencyUpdates) {
    out.push(`  UPDATE ${u.id} (${u.changes.map(c => c.field).join(', ')})`);
    for (const c of u.changes) out.push(...formatChange(c, '    '));
  }
  for (const r of plan.competencyRetires) {
    out.push(`  RETIRE ${r.id} "${r.name}"${r.mergedInto ? ` -> merged into ${r.mergedInto}` : ''} (retired = true; row and its coverage kept)`);
  }

  for (const t of plan.targets) {
    out.push('', `== ${t.targetId} (${t.targetName})`);
    if (t.targetChanges.length) {
      out.push(`  career_targets: UPDATE ${t.targetChanges.map(c => c.field).join(', ')}`);
      for (const c of t.targetChanges) out.push(...formatChange(c, '    '));
    } else {
      out.push('  career_targets: unchanged');
    }
    for (const m of t.membershipInserts) out.push(`  career_target_requirements: INSERT ${m.competencyId} (display_order ${m.displayOrder})`);
    for (const o of t.orderUpdates) out.push(`  career_target_requirements: REORDER ${o.competencyId} (${o.from} -> ${o.to})`);
    if (t.membershipUnchanged.length) out.push(`  career_target_requirements unchanged: ${t.membershipUnchanged.join(', ')}`);
    if (t.membershipRemovals.length) out.push(`  WARNING membership not desired and not retired, left as-is: ${t.membershipRemovals.join(', ')}`);
  }

  const c = plan.counts;
  out.push(
    '',
    '== counts',
    `  targets updated: ${c.targetsUpdated}, targets unchanged: ${c.targetsUnchanged}`,
    `  competencies inserted: ${c.competenciesInserted}, updated: ${c.competenciesUpdated}, retired: ${c.competenciesRetired}`,
    `  memberships inserted: ${c.membershipsInserted}, reordered: ${c.membershipsReordered}, removals reported (not applied): ${c.membershipsRemoved}`,
  );
  if (plan.errors.length) out.push('', '== ERRORS (apply refused)', ...plan.errors.map(e => `  ${e}`));
  return out.join('\n');
}
