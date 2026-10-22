/**
 * Membership from weights (spec 2026-10-21-p3-membership-from-weights-design.md).
 * rebuildMembership rewrites career_target_membership from faculty pins/hides
 * and entry effective weights. Every caller holds lockMembership(tx) first and
 * runs in the same transaction as its own write.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { careerTargetMembership, careerTargetRequirements } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/bundle-queries';
import { effectiveWeight } from '@/lib/catalog/career-weights';
import { decideMembership, bandOf, MEMBERSHIP_LOCK_KEY, type PairState } from '@/lib/catalog/membership';

export type MembershipChange = { careerTargetId: string; competencyId: string; change: 'entered' | 'left' | 'band'; from: string | null; to: string | null };

export async function lockMembership(ex: Executor): Promise<void> {
  await ex.execute(sql`SELECT pg_advisory_xact_lock(${MEMBERSHIP_LOCK_KEY})`);
}

/** One entry-horizon career_target_requirements row of an active competency. */
export type ReqRow = { t: string; c: string; source: 'onet' | 'employer' | 'faculty'; weight: number | null; status: 'draft' | 'confirmed' | 'hidden'; order: number; n: number };

export async function readEntryRows(ex: Executor): Promise<ReqRow[]> {
  const rows = (await ex.execute(sql`
    SELECT r.career_target_id AS t, r.competency_id AS c, r.weight_source AS source, r.weight, r.status,
           r.display_order AS "order", jsonb_array_length(r.contributing_position_ids) AS n
    FROM career_target_requirements r JOIN sub_competencies s ON s.id = r.competency_id
    WHERE r.horizon = 'entry' AND NOT s.retired
    ORDER BY 1, 2`)).rows as ReqRow[];
  return rows.map(r => ({ ...r, weight: r.weight === null ? null : Number(r.weight), order: Number(r.order), n: Number(r.n) }));
}

/** Every (target, competency) pair among the rows, with its entry effective weight, pin and hide. */
export function pairStatesFromRows(rows: ReqRow[]): PairState[] {
  const by = new Map<string, ReqRow[]>();
  for (const r of rows) {
    const k = `${r.t}|${r.c}`;
    const a = by.get(k);
    if (a) a.push(r); else by.set(k, [r]);
  }
  const out: PairState[] = [];
  for (const rs of by.values()) {
    const onet = rs.find(r => r.source === 'onet');
    const emp = rs.find(r => r.source === 'employer');
    const fac = rs.find(r => r.source === 'faculty');
    const e = effectiveWeight({
      onet: onet?.weight ?? null,
      employer: emp?.weight ?? null,
      n: emp?.n ?? 0,
      facultyOverride: fac && fac.status === 'confirmed' && fac.weight !== null ? fac.weight : null,
      facultyDraft: fac && fac.status === 'draft' ? fac.weight : null,
    });
    out.push({
      careerTargetId: rs[0]!.t,
      competencyId: rs[0]!.c,
      pinned: fac !== undefined && fac.status !== 'hidden',
      hidden: fac?.status === 'hidden',
      pinOrder: fac && fac.status !== 'hidden' ? fac.order : null,
      weight: e.weight,
    });
  }
  return out;
}

export async function readPairStates(ex: Executor): Promise<PairState[]> {
  return pairStatesFromRows(await readEntryRows(ex));
}

/**
 * Caller holds lockMembership. `states` (default: read from the DB) lets a dry
 * run decide from in-memory weights; with apply false nothing is written.
 */
export async function rebuildMembership(ex: Executor, opts: { apply?: boolean; states?: PairState[] } = {}): Promise<MembershipChange[]> {
  const apply = opts.apply ?? true;
  const next = decideMembership(opts.states ?? await readPairStates(ex));
  const prev = (await ex.execute(sql`SELECT career_target_id AS t, competency_id AS c, effective_weight AS w FROM career_target_membership`)).rows as Array<{ t: string; c: string; w: number | null }>;
  const prevBy = new Map(prev.map(r => [`${r.t}|${r.c}`, r.w === null ? null : Number(r.w)]));
  const nextBy = new Map(next.map(r => [`${r.careerTargetId}|${r.competencyId}`, r.effectiveWeight]));
  const changes: MembershipChange[] = [];
  for (const [k, w] of nextBy) {
    const [t, c] = k.split('|') as [string, string];
    if (!prevBy.has(k)) changes.push({ careerTargetId: t, competencyId: c, change: 'entered', from: null, to: bandOf(w) ?? 'pinned' });
    else if (bandOf(prevBy.get(k)!) !== bandOf(w)) changes.push({ careerTargetId: t, competencyId: c, change: 'band', from: bandOf(prevBy.get(k)!), to: bandOf(w) });
  }
  for (const [k, w] of prevBy) {
    if (nextBy.has(k)) continue;
    const [t, c] = k.split('|') as [string, string];
    changes.push({ careerTargetId: t, competencyId: c, change: 'left', from: bandOf(w) ?? 'pinned', to: null });
  }
  // Band changes of pairs that are not members before or after are reported by the
  // recompute from its own before/after weights (career-weight-queries.ts).
  if (apply) {
    await ex.delete(careerTargetMembership);
    if (next.length) {
      await ex.insert(careerTargetMembership).values(next.map(r => ({
        careerTargetId: r.careerTargetId, competencyId: r.competencyId, basis: r.basis,
        effectiveWeight: r.effectiveWeight, displayOrder: r.displayOrder, updatedAt: new Date(),
      })));
    }
  }
  return sortChanges(changes);
}

export function sortChanges(changes: MembershipChange[]): MembershipChange[] {
  return changes.sort((a, b) => a.careerTargetId.localeCompare(b.careerTargetId) || a.competencyId.localeCompare(b.competencyId));
}

/**
 * Faculty pin: upsert the entry faculty row. A hidden row becomes a pin; an
 * existing pin (draft, or a confirmed override) keeps its status and weight.
 * Does not lock or rebuild; the caller does both.
 */
export async function setPin(tx: Executor, targetId: string, competencyId: string, displayOrder: number): Promise<void> {
  await tx.insert(careerTargetRequirements).values({
    careerTargetId: targetId, competencyId, horizon: 'entry', weight: null, weightSource: 'faculty', status: 'draft', displayOrder,
  }).onConflictDoUpdate({
    target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
    set: { status: sql`CASE WHEN ${careerTargetRequirements.status} = 'hidden' THEN 'draft' ELSE ${careerTargetRequirements.status} END`, displayOrder, updatedAt: new Date() },
  });
}

/** Faculty hide: the entry faculty row becomes hidden (weight cleared); other faculty horizons go. Weight rows stay. */
export async function setHide(tx: Executor, targetId: string, competencyId: string): Promise<void> {
  await tx.delete(careerTargetRequirements).where(and(
    eq(careerTargetRequirements.careerTargetId, targetId), eq(careerTargetRequirements.competencyId, competencyId),
    eq(careerTargetRequirements.weightSource, 'faculty'), ne(careerTargetRequirements.horizon, 'entry'),
  ));
  await tx.insert(careerTargetRequirements).values({
    careerTargetId: targetId, competencyId, horizon: 'entry', weight: null, weightSource: 'faculty', status: 'hidden', displayOrder: 0,
  }).onConflictDoUpdate({
    target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
    set: { status: 'hidden', weight: null, updatedAt: new Date() },
  });
}

/** Back to importance only: delete every faculty row of the pair. */
export async function clearFacultyRow(tx: Executor, targetId: string, competencyId: string): Promise<void> {
  await tx.delete(careerTargetRequirements).where(and(
    eq(careerTargetRequirements.careerTargetId, targetId), eq(careerTargetRequirements.competencyId, competencyId),
    eq(careerTargetRequirements.weightSource, 'faculty'),
  ));
}
