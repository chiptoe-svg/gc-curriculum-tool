import type { CaptureProfile, CaptureCompetency } from '@/lib/ai/capture/schema';
import { normalizeCompetencyKey } from '@/lib/ai/explore/run-impact';

/**
 * Carry the ADOPT overlay (per-competency `intended_target` + profile-level
 * `adopted_from_scenario_id`) from a previous draft onto a freshly re-scored
 * profile. Measured depths/evidence/says come from `next` (the fresh score);
 * only the aspirational target + provenance are preserved from `prev`, matched
 * by normalized competency statement. Pure; if `prev` was never adopted, no-op.
 */
export function preserveAdoptOverlay(prev: CaptureProfile, next: CaptureProfile): CaptureProfile {
  const prevAdopted = (prev as { adopted_from_scenario_id?: string | null }).adopted_from_scenario_id ?? null;
  const targetByStmt = new Map<string, unknown>();
  for (const c of prev.competencies) {
    const t = (c as { intended_target?: unknown }).intended_target;
    if (t) targetByStmt.set(normalizeCompetencyKey(c.statement), t);
  }
  if (!prevAdopted && targetByStmt.size === 0) return next;

  const competencies = next.competencies.map((c): CaptureCompetency => {
    const t = targetByStmt.get(normalizeCompetencyKey(c.statement));
    return t ? ({ ...c, intended_target: t } as CaptureCompetency) : c;
  });
  return { ...next, competencies, adopted_from_scenario_id: prevAdopted } as CaptureProfile;
}
