/**
 * P3 career weights (spec 2026-10-21-p3-career-weights-design.md; plan Rulings 1–5).
 * Writes `onet` and `employer` rows of career_target_requirements beside the
 * faculty rows, ONLY for (target, competency) pairs that are already members
 * (Ruling 1 — membership is any requirements row). Never writes faculty rows.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/bundle-queries';
import {
  onetWeight, employerWeight, captureInputFromRow, effectiveWeight,
  type WeightItem, type Occupation, type CaptureInput, type Position, type WeightBasis,
} from '@/lib/catalog/career-weights';

export type { Executor };
const DEFAULT_RELEASE = '31.0';
const HORIZONS = ['entry', 'growth'] as const;
type Horizon = typeof HORIZONS[number];

export interface RecomputeReport {
  onetUpserted: number; onetDeleted: number; employerUpserted: number; employerDeleted: number; pairs: number;
  byTarget: Array<{ targetId: string; horizon: Horizon; members: number; withOnet: number; onetMin: number | null; onetMedian: number | null; onetMax: number | null }>;
  nonMemberCandidates: Array<{ targetId: string; horizon: Horizon; competencyId: string; onet: number }>;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

async function loadInputs(ex: Executor, release: string) {
  const pairs = (await ex.execute(sql`
    SELECT career_target_id AS t, competency_id AS c, MIN(display_order) AS o
    FROM career_target_requirements GROUP BY 1, 2 ORDER BY 1, 3, 2`)).rows as Array<{ t: string; c: string; o: number }>;
  const occRows = (await ex.execute(sql`
    SELECT career_target_id AS t, horizon AS h, onet_soc_code AS soc, share
    FROM career_target_occupations WHERE onet_soc_code IS NOT NULL`)).rows as Array<{ t: string; h: Horizon; soc: string; share: number }>;
  const occupations = new Map<string, Occupation[]>();
  for (const r of occRows) push(occupations, `${r.t}|${r.h}`, { soc: r.soc, share: Number(r.share) });
  const socs = [...new Set(occRows.map(r => r.soc))];
  // Confirmed members only (proposed ones — incl. blind-locked bundles — never count).
  const memberRows = (await ex.execute(sql`
    SELECT bundle_id AS c, source, external_id AS id, onet_soc_code AS soc, position
    FROM bundle_members WHERE status = 'confirmed' AND source IN ('onet_element', 'onet_task')`)).rows as Array<{ c: string; source: string; id: string; soc: string | null; position: Position }>;
  const elementIds = [...new Set(memberRows.filter(m => m.source === 'onet_element').map(m => m.id))];
  const el = new Map<string, Record<string, number>>();
  if (elementIds.length > 0 && socs.length > 0) {
    const rows = (await ex.execute(sql`
      SELECT element_id AS id, onet_soc_code AS soc, data_value AS v FROM onet_element_ratings
      WHERE release = ${release} AND scale_id = 'IM' AND NOT not_relevant
        AND element_id IN (${sql.join(elementIds.map(x => sql`${x}`), sql`, `)})
        AND onet_soc_code IN (${sql.join(socs.map(x => sql`${x}`), sql`, `)})`)).rows as Array<{ id: string; soc: string; v: number }>;
    for (const r of rows) {
      const rec = el.get(r.id) ?? {};
      rec[r.soc] = Number(r.v);
      el.set(r.id, rec);
    }
  }
  const taskRows = (await ex.execute(sql`
    SELECT r.task_id AS id, r.onet_soc_code AS soc, r.data_value AS v FROM onet_task_ratings r
    JOIN bundle_members m ON m.source = 'onet_task' AND m.status = 'confirmed' AND m.external_id = r.task_id AND m.onet_soc_code = r.onet_soc_code
    WHERE r.release = ${release} AND r.scale_id = 'IM'`)).rows as Array<{ id: string; soc: string; v: number }>;
  const task = new Map(taskRows.map(r => [`${r.id}|${r.soc}`, Number(r.v)]));
  const items = new Map<string, WeightItem[]>();
  for (const m of memberRows) {
    const tv = m.soc ? task.get(`${m.id}|${m.soc}`) : undefined;
    const importanceBySoc = m.source === 'onet_element' ? (el.get(m.id) ?? {}) : (m.soc && tv !== undefined ? { [m.soc]: tv } : {});
    push(items, m.c, { position: m.position, importanceBySoc });
  }
  const capRows = (await ex.execute(sql`
    SELECT pc.id, pc.career_target_id AS t, pc.rated_skills AS "ratedSkills", pc.profile FROM position_captures pc
    WHERE pc.status = 'submitted' AND pc.retired_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM position_captures sup WHERE sup.supersedes = pc.id AND sup.status = 'submitted' AND sup.retired_at IS NULL)`)).rows as Array<{ id: string; t: string; ratedSkills: unknown; profile: unknown }>;
  const captures = new Map<string, CaptureInput[]>();
  for (const r of capRows) push(captures, r.t, captureInputFromRow(r));
  const allCompetencies = ((await ex.execute(sql`SELECT id FROM sub_competencies WHERE NOT retired ORDER BY id`)).rows as Array<{ id: string }>).map(r => r.id);
  return { pairs, occupations, items, captures, allCompetencies };
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)]! : null; };

async function upsert(ex: Executor, v: { t: string; c: string; h: Horizon; source: 'onet' | 'employer'; weight: number | null; order: number; contributing: string[]; note: string | null }): Promise<void> {
  await ex.insert(careerTargetRequirements).values({
    careerTargetId: v.t, competencyId: v.c, horizon: v.h, weightSource: v.source, weight: v.weight,
    status: 'draft', displayOrder: v.order, contributingPositionIds: v.contributing, note: v.note,
  }).onConflictDoUpdate({
    target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
    set: { weight: v.weight, contributingPositionIds: v.contributing, note: v.note, updatedAt: new Date() },
  });
}

async function remove(ex: Executor, t: string, c: string, h: Horizon, source: 'onet' | 'employer'): Promise<number> {
  const r = await ex.delete(careerTargetRequirements).where(and(
    eq(careerTargetRequirements.careerTargetId, t), eq(careerTargetRequirements.competencyId, c),
    eq(careerTargetRequirements.horizon, h), eq(careerTargetRequirements.weightSource, source),
  )).returning({ id: careerTargetRequirements.id });
  return r.length;
}

export async function recomputeCareerWeights(ex: Executor, opts: { apply: boolean; release?: string }): Promise<RecomputeReport> {
  const { pairs, occupations, items, captures, allCompetencies } = await loadInputs(ex, opts.release ?? DEFAULT_RELEASE);
  const report: RecomputeReport = { onetUpserted: 0, onetDeleted: 0, employerUpserted: 0, employerDeleted: 0, pairs: pairs.length, byTarget: [], nonMemberCandidates: [] };
  const targets = [...new Set([...pairs.map(p => p.t), ...[...occupations.keys()].map(k => k.split('|')[0]!)])].sort();
  for (const t of targets) {
    const members = pairs.filter(p => p.t === t);
    const memberSet = new Set(members.map(p => p.c));
    for (const h of HORIZONS) {
      const occ = occupations.get(`${t}|${h}`) ?? [];
      const values: number[] = [];
      for (const p of members) {
        const w = onetWeight(items.get(p.c) ?? [], occ);
        if (w !== null) {
          values.push(w);
          report.onetUpserted++;
          if (opts.apply) await upsert(ex, { t, c: p.c, h, source: 'onet', weight: w, order: p.o, contributing: [], note: null });
        } else if (opts.apply) {
          report.onetDeleted += await remove(ex, t, p.c, h, 'onet');
        }
        if (h === 'entry') {
          const e = employerWeight(captures.get(t) ?? [], p.c);
          if (e.ratedBy.length > 0 || e.namedOnlyBy.length > 0) {
            report.employerUpserted++;
            const note = e.namedOnlyBy.length > 0 ? `named without a rating by ${e.namedOnlyBy.length} position(s)` : null;
            if (opts.apply) await upsert(ex, { t, c: p.c, h, source: 'employer', weight: e.weight, order: p.o, contributing: e.ratedBy, note });
          } else if (opts.apply) {
            report.employerDeleted += await remove(ex, t, p.c, h, 'employer');
          }
        }
      }
      report.byTarget.push({
        targetId: t, horizon: h, members: members.length, withOnet: values.length,
        onetMin: values.length ? Math.min(...values) : null, onetMedian: median(values), onetMax: values.length ? Math.max(...values) : null,
      });
      for (const c of allCompetencies) {
        if (memberSet.has(c)) continue;
        const w = onetWeight(items.get(c) ?? [], occ);
        if (w !== null && w > 0.5) report.nonMemberCandidates.push({ targetId: t, horizon: h, competencyId: c, onet: w });
      }
    }
  }
  return report;
}

/** Ruling 5: after a review action or capture submission; never throws. */
export async function recomputeCareerWeightsSafely(reason: string): Promise<void> {
  try {
    await db.transaction(async (tx) => { await recomputeCareerWeights(tx, { apply: true }); });
  } catch (err) {
    console.warn(`[career-weights] recompute after ${reason} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface CareerWeightRow { competencyId: string; displayOrder: number; weight: number | null; basis: WeightBasis; disagreement: boolean; onet: number | null; employer: number | null; n: number; namedOnly: string | null }

export async function readCareerWeights(ex: Executor, targetId: string, horizon: Horizon): Promise<CareerWeightRow[]> {
  const rows = await ex.select().from(careerTargetRequirements)
    .where(and(eq(careerTargetRequirements.careerTargetId, targetId), eq(careerTargetRequirements.horizon, horizon)));
  const by = new Map<string, typeof rows>();
  for (const r of rows) push(by, r.competencyId, r);
  const out: CareerWeightRow[] = [];
  for (const [c, rs] of by) {
    const onet = rs.find(r => r.weightSource === 'onet') ?? null;
    const emp = rs.find(r => r.weightSource === 'employer') ?? null;
    const fac = rs.find(r => r.weightSource === 'faculty') ?? null;
    const n = emp?.contributingPositionIds.length ?? 0;
    const e = effectiveWeight({
      onet: onet?.weight ?? null,
      employer: emp?.weight ?? null,
      n,
      facultyOverride: fac && fac.status === 'confirmed' && fac.weight !== null ? fac.weight : null,
      facultyDraft: fac && fac.status === 'draft' ? fac.weight : null,
    });
    out.push({ competencyId: c, displayOrder: Math.min(...rs.map(r => r.displayOrder)), ...e, onet: onet?.weight ?? null, employer: emp?.weight ?? null, n, namedOnly: emp?.note ?? null });
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder || a.competencyId.localeCompare(b.competencyId));
}
