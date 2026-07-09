import type { CaptureProfile, CaptureCompetency } from '@/lib/ai/capture/schema';
import type { Scenario } from './scenario';
import { normalizeCompetencyKey } from './run-impact';
import { getScenario } from '@/lib/db/explore-scenario-queries';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { upsertCaptureProfile } from '@/lib/db/course-capture-profiles-queries';

/**
 * Pure: baseline evidenced profile + a scenario → the "planned" profile.
 * Overlays intended_target (from predicted deltas, statement-matched) + provenance
 * + revised objectives + new incoming-expectations. Measured depths untouched —
 * a target is a separate field and never a measured score.
 */
export function buildAdoptedProfile(baseline: CaptureProfile, scenario: Scenario): CaptureProfile {
  const targetByStmt = new Map<string, { k: number | null; u: number | null; d: number | null }>();
  for (const d of scenario.predictedDeltas) {
    targetByStmt.set(normalizeCompetencyKey(d.competency), { k: d.to.k, u: d.to.u, d: d.to.d });
  }
  // A predicted delta whose competency doesn't match any baseline competency statement
  // is intentionally dropped — v1 overlays targets onto existing competencies only;
  // a genuinely-new competency is not added here (documented deferral).
  const competencies: CaptureCompetency[] = baseline.competencies.map((c) => {
    const t = targetByStmt.get(normalizeCompetencyKey(c.statement));
    return t ? { ...c, intended_target: t } : c;
  });
  const revised_objectives_draft = [
    ...(baseline.revised_objectives_draft ?? []),
    `Adopted change: ${scenario.change.activity}`,
  ];
  const existingIncoming = new Set(
    baseline.incoming_expectations.map((e) => normalizeCompetencyKey(e.statement)),
  );
  const newIncoming = scenario.change.assumesIncoming
    .filter((a) => !existingIncoming.has(normalizeCompetencyKey(a.label)))
    .map((a) => ({
      statement: a.label,
      expected_depth: { k: a.k, u: a.u, d: a.d ?? 0 },
      evidenced_by: [`adopted from scenario ${scenario.id}`],
      confidence: 'low' as const,
    }));
  const incoming_expectations = [...baseline.incoming_expectations, ...newIncoming];
  return {
    ...baseline,
    competencies,
    incoming_expectations,
    revised_objectives_draft,
    adopted_from_scenario_id: scenario.id,
  };
}

/**
 * Adopt a scenario as the course's next PLANNED draft. Loads the scenario + its
 * baseline snapshot, seeds the working draft (course_capture_profiles) with the
 * planned profile (intended targets + revised objectives + new incoming skills +
 * provenance), leaving measured depths for the next Capture to re-score from
 * evidence. Mirrors loadSnapshotAsDraft, sourced from a Scenario.
 */
export async function adoptScenario(
  scenarioId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const scenario = await getScenario(scenarioId);
  if (!scenario) return { ok: false, error: 'scenario not found' };
  const snap = await getSnapshotById(scenario.baselineSnapshotId);
  if (!snap) return { ok: false, error: 'baseline snapshot not found' };
  const profile = buildAdoptedProfile(snap.profile, scenario);
  await upsertCaptureProfile({ courseCode: scenario.courseCode, profile, reviewerStatus: 'edited' });
  return { ok: true };
}
