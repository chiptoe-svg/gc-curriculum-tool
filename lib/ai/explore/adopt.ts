import type { CaptureProfile, CaptureCompetency } from '@/lib/ai/capture/schema';
import type { Scenario } from './scenario';
import { normalizeCompetencyKey } from './run-impact';

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
  const competencies: CaptureCompetency[] = baseline.competencies.map((c) => {
    const t = targetByStmt.get(normalizeCompetencyKey(c.statement));
    return t ? { ...c, intended_target: t } : c;
  });
  const revised_objectives_draft = [
    ...(baseline.revised_objectives_draft ?? []),
    `Adopted change: ${scenario.change.activity}`,
  ];
  const incoming_expectations = [
    ...baseline.incoming_expectations,
    ...scenario.change.assumesIncoming.map((a) => ({
      statement: a.label,
      expected_depth: { k: a.k, u: a.u, d: a.d ?? 0 },
      evidenced_by: [`adopted from scenario ${scenario.id}`],
      confidence: 'low' as const,
    })),
  ];
  return {
    ...baseline,
    competencies,
    incoming_expectations,
    revised_objectives_draft,
    adopted_from_scenario_id: scenario.id,
  };
}
