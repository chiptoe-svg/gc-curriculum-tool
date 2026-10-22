/**
 * P3 career weights (spec 2026-10-21-p3-career-weights-design.md; membership
 * addendum 2026-10-21-p3-membership-from-weights-design.md). Writes `onet` and
 * `employer` rows of career_target_requirements beside the faculty rows for
 * EVERY pair of an active competency and a target with occupations. Those rows
 * are data, not membership: membership is career_target_membership, rebuilt
 * here from pins, hides and entry effective weights (rebuildMembership).
 * Never writes faculty rows.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, careerTargetMembership } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/bundle-queries';
import {
  onetWeight, employerWeight, captureInputFromRow, effectiveWeight, PROVISIONAL_NOTE,
  type WeightItem, type Occupation, type CaptureInput, type Position, type WeightBasis,
} from '@/lib/catalog/career-weights';
import { bandOf, decideMembership } from '@/lib/catalog/membership';
import {
  lockMembership, readEntryRows, pairStatesFromRows, rebuildMembership, sortChanges,
  type MembershipChange, type ReqRow,
} from '@/lib/db/membership-queries';

export type { Executor };
const DEFAULT_RELEASE = '31.0';
const HORIZONS = ['entry', 'growth'] as const;
type Horizon = typeof HORIZONS[number];

export interface RecomputeReport {
  onetUpserted: number; onetDeleted: number; employerUpserted: number; employerDeleted: number; pairs: number;
  byTarget: Array<{ targetId: string; horizon: Horizon; members: number; withOnet: number; onetMin: number | null; onetMedian: number | null; onetMax: number | null }>;
  /** Pairs that entered or left a target's membership, or changed importance band (the wiki lists down to 0.25). */
  membershipChanges: MembershipChange[];
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

async function loadInputs(ex: Executor, release: string) {
  const occRows = (await ex.execute(sql`
    SELECT career_target_id AS t, horizon AS h, onet_soc_code AS soc, share
    FROM career_target_occupations WHERE onet_soc_code IS NOT NULL`)).rows as Array<{ t: string; h: Horizon; soc: string; share: number }>;
  const occupations = new Map<string, Occupation[]>();
  for (const r of occRows) push(occupations, `${r.t}|${r.h}`, { soc: r.soc, share: Number(r.share) });
  const socs = [...new Set(occRows.map(r => r.soc))];
  // Per bundle: its confirmed members if it has any; otherwise its AI-proposed
  // CORE members, as a provisional weight (spec 2026-10-21-p3-provisional-
  // weights-design.md). A blind-locked bundle (sample not yet submitted) never counts.
  const candidateRows = (await ex.execute(sql`
    SELECT m.bundle_id AS c, m.source, m.external_id AS id, m.onet_soc_code AS soc, m.position, m.status
    FROM bundle_members m
    WHERE m.source IN ('onet_element', 'onet_task')
      AND (m.status = 'confirmed' OR (m.status = 'proposed' AND m.position = 'core'))
      AND NOT EXISTS (SELECT 1 FROM bundle_golden_samples g WHERE g.bundle_id = m.bundle_id AND g.submitted_at IS NULL)`)).rows as Array<{ c: string; source: string; id: string; soc: string | null; position: Position; status: 'confirmed' | 'proposed' }>;
  const confirmedBundles = new Set(candidateRows.filter(m => m.status === 'confirmed').map(m => m.c));
  const memberRows = candidateRows.filter(m => confirmedBundles.has(m.c) ? m.status === 'confirmed' : true);
  const provisionalBundles = new Set(memberRows.filter(m => !confirmedBundles.has(m.c)).map(m => m.c));
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
    JOIN bundle_members m ON m.source = 'onet_task' AND m.status IN ('confirmed', 'proposed') AND m.external_id = r.task_id AND m.onet_soc_code = r.onet_soc_code
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
  return { occupations, items, captures, allCompetencies, provisionalBundles };
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)]! : null; };

type WeightRow = { t: string; c: string; h: Horizon; source: 'onet' | 'employer'; weight: number | null; contributing: string[]; note: string | null };

async function writeWeights(ex: Executor, upserts: WeightRow[]): Promise<{ onetDeleted: number; employerDeleted: number }> {
  for (let i = 0; i < upserts.length; i += 500) {
    await ex.insert(careerTargetRequirements).values(upserts.slice(i, i + 500).map(v => ({
      careerTargetId: v.t, competencyId: v.c, horizon: v.h, weightSource: v.source, weight: v.weight,
      status: 'draft' as const, displayOrder: 0, contributingPositionIds: v.contributing, note: v.note,
    }))).onConflictDoUpdate({
      target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
      set: { weight: sql`excluded.weight`, contributingPositionIds: sql`excluded.contributing_position_ids`, note: sql`excluded.note`, updatedAt: sql`now()` },
    });
  }
  const keep = JSON.stringify(upserts.map(v => `${v.t}|${v.c}|${v.h}|${v.source}`));
  const del = (await ex.execute(sql`
    DELETE FROM career_target_requirements
    WHERE weight_source IN ('onet', 'employer')
      AND (career_target_id || '|' || competency_id || '|' || horizon || '|' || weight_source)
          NOT IN (SELECT jsonb_array_elements_text(${keep}::jsonb))
    RETURNING weight_source`)).rows as Array<{ weight_source: string }>;
  return { onetDeleted: del.filter(r => r.weight_source === 'onet').length, employerDeleted: del.filter(r => r.weight_source === 'employer').length };
}

/** Entry rows as they would be after writing `upserts` (dry run): faculty rows kept, weight rows replaced. */
function simulatedEntryRows(current: ReqRow[], upserts: WeightRow[]): ReqRow[] {
  return [
    ...current.filter(r => r.source === 'faculty'),
    ...upserts.filter(u => u.h === 'entry').map(u => ({ t: u.t, c: u.c, source: u.source, weight: u.weight, status: 'draft' as const, order: 0, n: u.contributing.length })),
  ];
}

export async function recomputeCareerWeights(ex: Executor, opts: { apply: boolean; release?: string }): Promise<RecomputeReport> {
  // Lock first, so inputs are read after any earlier membership writer commits
  // (final review Important #1, Minor #1).
  if (opts.apply) await lockMembership(ex);
  const { occupations, items, captures, allCompetencies, provisionalBundles } = await loadInputs(ex, opts.release ?? DEFAULT_RELEASE);
  const beforeRows = await readEntryRows(ex);
  const report: RecomputeReport = { onetUpserted: 0, onetDeleted: 0, employerUpserted: 0, employerDeleted: 0, pairs: 0, byTarget: [], membershipChanges: [] };
  const targets = [...new Set([...occupations.keys()].map(k => k.split('|')[0]!))].sort();
  const upserts: WeightRow[] = [];
  const stats: Array<{ targetId: string; horizon: Horizon; values: number[] }> = [];
  for (const t of targets) {
    for (const h of HORIZONS) {
      const occ = occupations.get(`${t}|${h}`) ?? [];
      const values: number[] = [];
      for (const c of allCompetencies) {
        const w = onetWeight(items.get(c) ?? [], occ);
        if (w !== null) {
          values.push(w);
          upserts.push({ t, c, h, source: 'onet', weight: w, contributing: [], note: provisionalBundles.has(c) ? PROVISIONAL_NOTE : null });
        }
        if (h === 'entry') {
          const e = employerWeight(captures.get(t) ?? [], c);
          if (e.ratedBy.length > 0 || e.namedOnlyBy.length > 0) {
            const note = e.namedOnlyBy.length > 0 ? `named without a rating by ${e.namedOnlyBy.length} position(s)` : null;
            upserts.push({ t, c, h, source: 'employer', weight: e.weight, contributing: e.ratedBy, note });
          }
        }
      }
      stats.push({ targetId: t, horizon: h, values });
    }
  }
  report.pairs = targets.length * allCompetencies.length;
  report.onetUpserted = upserts.filter(u => u.source === 'onet').length;
  report.employerUpserted = upserts.filter(u => u.source === 'employer').length;

  const before = pairStatesFromRows(beforeRows);
  let after;
  if (opts.apply) {
    Object.assign(report, await writeWeights(ex, upserts));
    after = pairStatesFromRows(await readEntryRows(ex));
    report.membershipChanges = await rebuildMembership(ex, { apply: true, states: after });
  } else {
    after = pairStatesFromRows(simulatedEntryRows(beforeRows, upserts));
    report.membershipChanges = await rebuildMembership(ex, { apply: false, states: after });
  }
  const reported = new Set(report.membershipChanges.map(c => `${c.careerTargetId}|${c.competencyId}`));
  const beforeBy = new Map(before.map(s => [`${s.careerTargetId}|${s.competencyId}`, s]));
  const afterBy = new Map(after.map(s => [`${s.careerTargetId}|${s.competencyId}`, s]));
  const extra: MembershipChange[] = [];
  for (const k of new Set([...beforeBy.keys(), ...afterBy.keys()])) {
    if (reported.has(k)) continue;
    const from = bandOf(beforeBy.get(k)?.weight ?? null);
    const to = bandOf(afterBy.get(k)?.weight ?? null);
    if (from === to || afterBy.get(k)?.hidden) continue;
    const [t, c] = k.split('|') as [string, string];
    extra.push({ careerTargetId: t, competencyId: c, change: 'band', from, to });
  }
  report.membershipChanges = sortChanges([...report.membershipChanges, ...extra]);

  const membersBy = new Map<string, number>();
  for (const m of decideMembership(after)) membersBy.set(m.careerTargetId, (membersBy.get(m.careerTargetId) ?? 0) + 1);
  for (const st of stats) {
    report.byTarget.push({
      targetId: st.targetId, horizon: st.horizon, members: membersBy.get(st.targetId) ?? 0, withOnet: st.values.length,
      onetMin: st.values.length ? Math.min(...st.values) : null, onetMedian: median(st.values), onetMax: st.values.length ? Math.max(...st.values) : null,
    });
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
  const memberOrder = new Map((await ex.select({ c: careerTargetMembership.competencyId, o: careerTargetMembership.displayOrder })
    .from(careerTargetMembership).where(eq(careerTargetMembership.careerTargetId, targetId))).map(r => [r.c, r.o]));
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
    out.push({ competencyId: c, displayOrder: fac?.displayOrder ?? memberOrder.get(c) ?? Number.MAX_SAFE_INTEGER, ...e, onet: onet?.weight ?? null, employer: emp?.weight ?? null, n, namedOnly: emp?.note ?? null });
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder || a.competencyId.localeCompare(b.competencyId));
}
