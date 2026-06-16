import type { CaptureCompetency, ReviewerOverride } from '@/lib/ai/capture/schema';

export interface OverrideChange { dim: 'k' | 'u' | 'd'; from: number; to: number; }
export interface UpwardBump { index: number; statement: string; changes: OverrideChange[]; }

/**
 * Find competencies whose K/U/D moved UP from the baseline. Matched by index
 * (the review panel edits competencies in place — never reorders/adds/removes).
 * Foundationals carry null K/U (only D is meaningful), so null dimensions are
 * skipped. Downward/unchanged edits produce nothing.
 */
export function upwardBumps(
  baseline: CaptureCompetency[],
  working: CaptureCompetency[],
): UpwardBump[] {
  const out: UpwardBump[] = [];
  for (let i = 0; i < working.length; i++) {
    const b = baseline[i];
    const w = working[i];
    if (!b || !w) continue;
    const dims: { dim: 'k' | 'u' | 'd'; from: number | null; to: number | null }[] = [
      { dim: 'k', from: b.k_depth, to: w.k_depth },
      { dim: 'u', from: b.u_depth, to: w.u_depth },
      { dim: 'd', from: b.d_depth, to: w.d_depth },
    ];
    const changes: OverrideChange[] = [];
    for (const { dim, from, to } of dims) {
      if (from != null && to != null && to > from) changes.push({ dim, from, to });
    }
    if (changes.length > 0) out.push({ index: i, statement: w.statement, changes });
  }
  return out;
}

/**
 * Build the ReviewerOverride[] audit records: each upward-bumped competency
 * paired with its (trimmed, non-empty) reason. Bumps without a reason are
 * omitted — at approval the guard ensures every bump is reasoned, so all are
 * recorded; on a draft save, only the reasoned ones persist.
 */
export function assembleOverrides(
  baseline: CaptureCompetency[],
  working: CaptureCompetency[],
  reasons: Map<number, string>,
): ReviewerOverride[] {
  return upwardBumps(baseline, working)
    .map(b => ({ statement: b.statement, changes: b.changes, reason: (reasons.get(b.index) ?? '').trim() }))
    .filter(o => o.reason.length > 0);
}
