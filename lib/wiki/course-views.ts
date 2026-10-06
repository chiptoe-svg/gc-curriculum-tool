/**
 * The three views of a course shown on its wiki page (owner request 2026-10-05):
 *
 *   1. What the syllabus says   — the course's stated learning objectives.
 *   2. What the evidence shows  — the latest capture's competencies with their
 *                                 measured K/U/D depth and where the evidence came
 *                                 from, plus the capture's own findings on where
 *                                 the catalog/objectives and the evidence disagree.
 *   3. What the syllabus predicts — the syllabus-derived ("intended") K/U/D per
 *                                 career target. A prediction, never evidence.
 *
 * Deterministic: everything comes from data already recorded; no AI call here.
 * Pure helpers are exported for tests; `loadCourseViews` does the I/O.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseIntendedCoverage, subCompetencies, careerTargets } from '@/lib/db/schema';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { deriveEvidenceBand } from '@/lib/program/evidence-ladder';

/** Same vocabulary as the wiki's ·claimed / ·materials / ·artifact markers. */
export type EvidenceLabel = 'claimed' | 'materials' | 'artifact';

export interface EvidenceRow {
  statement: string;
  foundational: boolean;
  k: number | null;
  u: number | null;
  d: number;
  /** From deriveEvidenceBand — the same rule the wiki generator uses, so panel and page text agree. */
  evidence: EvidenceLabel;
}

export interface CourseEvidence {
  capturedOn: string; // YYYY-MM-DD
  rows: EvidenceRow[];
  /** The capture's own findings where stated objectives / catalog and evidence part ways. */
  disagreements: string[];
}

export interface PredictedTarget {
  targetId: string;
  name: string;
  k: number | null;
  u: number | null;
  d: number | null;
  /** How many of the target's competencies the syllabus is predicted to touch (any depth ≥ 1). */
  competencies: number;
}

export interface CourseViews {
  objectives: string[];
  evidence: CourseEvidence | null;
  predicted: PredictedTarget[];
}

const LABEL = { claimed: 'claimed', materials_supported: 'materials', artifact_verified: 'artifact' } as const;

const max = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);

/** Measured competencies + disagreement findings from a capture profile. */
export function evidenceFromProfile(profile: CaptureProfile, capturedOn: string): CourseEvidence {
  const rows: EvidenceRow[] = (profile.competencies ?? []).map(c => ({
    statement: c.statement,
    foundational: c.type === 'foundational',
    k: c.k_depth ?? null,
    u: c.u_depth ?? null,
    d: c.d_depth,
    evidence: LABEL[deriveEvidenceBand({ source: c.source ?? null, citations: c.citations ?? null })],
  }));
  const disagreements = [
    ...(profile.verification_summary?.catalog_vs_evidence ?? []),
    ...(profile.audit_notes?.objective_misalignments ?? []),
  ].map(s => s.trim()).filter(Boolean);
  // The two lists sometimes repeat a finding verbatim.
  return { capturedOn, rows, disagreements: [...new Set(disagreements)] };
}

/**
 * Roll per-competency predictions up to one line per career target (max depth).
 * Predictions on retired sub-competencies are history and are skipped.
 */
export function summarizePredicted(
  rows: Array<{ targetId: string; name: string; order: number; k: number | null; u: number | null; d: number | null; retired?: boolean }>,
): PredictedTarget[] {
  const byTarget = new Map<string, PredictedTarget & { order: number }>();
  for (const r of rows) {
    if (r.retired) continue;
    const touches = [r.k, r.u, r.d].some(v => v !== null && v >= 1);
    const cur = byTarget.get(r.targetId) ?? { targetId: r.targetId, name: r.name, order: r.order, k: null, u: null, d: null, competencies: 0 };
    cur.k = max(cur.k, r.k);
    cur.u = max(cur.u, r.u);
    cur.d = max(cur.d, r.d);
    if (touches) cur.competencies += 1;
    byTarget.set(r.targetId, cur);
  }
  return [...byTarget.values()]
    .filter(t => t.competencies > 0)
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...t }) => t);
}

export async function loadCourseViews(codeAnyCase: string): Promise<CourseViews | null> {
  // Wiki slugs upper-case letter suffixes ("GC 4900AP"); the DB stores "GC 4900ap".
  const [course] = await db
    .select({ code: courses.code, objectives: courses.learningObjectives })
    .from(courses)
    .where(sql`lower(${courses.code}) = lower(${codeAnyCase})`)
    .limit(1);
  if (!course) return null;
  const code = course.code;

  const snap = await getLatestSnapshotByCourse(code);
  const evidence = snap ? evidenceFromProfile(snap.profile, snap.createdAt.toISOString().slice(0, 10)) : null;

  const predictedRows = await db
    .select({
      targetId: careerTargets.id,
      name: careerTargets.name,
      order: careerTargets.displayOrder,
      k: courseIntendedCoverage.intendedK,
      u: courseIntendedCoverage.intendedU,
      d: courseIntendedCoverage.intendedD,
      retired: subCompetencies.retired,
    })
    .from(courseIntendedCoverage)
    .innerJoin(subCompetencies, eq(subCompetencies.id, courseIntendedCoverage.subCompetencyId))
    .innerJoin(careerTargets, eq(careerTargets.id, subCompetencies.careerTargetId))
    .where(eq(courseIntendedCoverage.courseCode, code));

  return {
    objectives: (course.objectives ?? []).map(s => s.trim()).filter(Boolean),
    evidence,
    predicted: summarizePredicted(predictedRows),
  };
}

export interface TargetWithCompetencies {
  id: string;
  name: string;
  competencies: Array<{ id: string; name: string }>;
}

/**
 * The five career targets and the competencies each is made of, from the DB
 * (the source of truth — wiki competency pages carry `career_target: null`).
 * Wiki slugs for targets and competencies equal these ids (verified 2026-10-05).
 */
export async function loadTargetMap(): Promise<TargetWithCompetencies[]> {
  const rows = await db
    .select({
      targetId: careerTargets.id,
      targetName: careerTargets.name,
      targetOrder: careerTargets.displayOrder,
      id: subCompetencies.id,
      name: subCompetencies.name,
      order: subCompetencies.displayOrder,
      retired: subCompetencies.retired,
    })
    .from(careerTargets)
    .leftJoin(subCompetencies, eq(subCompetencies.careerTargetId, careerTargets.id));
  return groupTargets(rows);
}

/**
 * Ids of retired sub-competencies. Their wiki competency pages (slug = id) stay
 * in the wiki repo as history, so the wiki must not present them as current.
 */
export async function loadRetiredCompetencyIds(): Promise<Set<string>> {
  const rows = await db
    .select({ id: subCompetencies.id })
    .from(subCompetencies)
    .where(eq(subCompetencies.retired, true));
  return new Set(rows.map(r => r.id));
}

/** Drop wiki competency pages whose sub-competency is retired. */
export function withoutRetired<T extends { slug: string }>(pages: T[], retired: Set<string>): T[] {
  return pages.filter(p => !retired.has(p.slug));
}

/** Pure grouping step of loadTargetMap (exported for tests). */
export function groupTargets(
  rows: Array<{ targetId: string; targetName: string; targetOrder: number; id: string | null; name: string | null; order: number | null; retired: boolean | null }>,
): TargetWithCompetencies[] {
  const map = new Map<string, TargetWithCompetencies & { order: number; subs: Array<{ id: string; name: string; order: number }> }>();
  for (const r of rows) {
    const t = map.get(r.targetId) ?? { id: r.targetId, name: r.targetName, order: r.targetOrder, competencies: [], subs: [] };
    if (r.id && r.name && !r.retired) t.subs.push({ id: r.id, name: r.name, order: r.order ?? 0 });
    map.set(r.targetId, t);
  }
  return [...map.values()]
    .sort((a, b) => a.order - b.order)
    .map(t => ({ id: t.id, name: t.name, competencies: t.subs.sort((a, b) => a.order - b.order).map(({ id, name }) => ({ id, name })) }));
}
