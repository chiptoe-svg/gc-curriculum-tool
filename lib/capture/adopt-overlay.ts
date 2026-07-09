import type { CaptureProfile, CaptureCompetency } from '@/lib/ai/capture/schema';
import { normalizeCompetencyKey } from '@/lib/ai/explore/run-impact';

/**
 * Carry the ADOPT overlay (per-competency `intended_target` + profile-level
 * `adopted_from_scenario_id`) from a previous draft onto a freshly re-scored
 * profile. Measured depths/evidence/says come from `next` (the fresh score);
 * only the aspirational target + provenance are preserved from `prev`, matched
 * by normalized competency statement. Pure; if `prev` was never adopted, no-op.
 * (If two prev competencies normalize to the same statement, the last wins —
 * harmless: the AI does not emit duplicate statements.)
 */
export function preserveAdoptOverlay(prev: CaptureProfile, next: CaptureProfile): CaptureProfile {
  const prevAdopted = prev.adopted_from_scenario_id ?? null;
  const targetByStmt = new Map<string, CaptureCompetency['intended_target']>();
  for (const c of prev.competencies) {
    if (c.intended_target) targetByStmt.set(normalizeCompetencyKey(c.statement), c.intended_target);
  }
  if (!prevAdopted && targetByStmt.size === 0) return next;

  const competencies: CaptureCompetency[] = next.competencies.map((c) => {
    const t = targetByStmt.get(normalizeCompetencyKey(c.statement));
    return t ? { ...c, intended_target: t } : c;
  });
  return { ...next, competencies, adopted_from_scenario_id: prevAdopted };
}
