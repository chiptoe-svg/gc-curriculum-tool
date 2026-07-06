/**
 * Pure helpers for the calibration-portrait review UI. No React — unit-testable.
 * The portrait is the AI's per-dimension `*_says` sentences, with a graceful
 * fallback to the generic depth anchor for pre-feature snapshots. Correction is
 * expressed by picking a plain-language anchor (never a slider/number).
 */
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { describeDepth, type Dimension } from '@/lib/ai/capture/depth-anchors';

export interface PortraitClause {
  dim: Dimension;
  /** The sentence to show — the AI's `*_says`, or the generic anchor as fallback. */
  text: string;
  /** True when we fell back to the generic anchor (no `*_says` on this snapshot). */
  fallback: boolean;
}

const DIM_LABEL: Record<Dimension, string> = { k: 'Naming', u: 'Reasoning', d: 'Doing' };
export function dimLabel(dim: Dimension): string {
  return DIM_LABEL[dim];
}

/** Ordered clauses for the woven portrait. Skips null-depth dimensions (foundational K/U). */
export function portraitClauses(c: CaptureCompetency): PortraitClause[] {
  const rows: { dim: Dimension; depth: number | null; says: string | null }[] = [
    { dim: 'k', depth: c.k_depth, says: c.k_says ?? null },
    { dim: 'u', depth: c.u_depth, says: c.u_says ?? null },
    { dim: 'd', depth: c.d_depth, says: c.d_says ?? null },
  ];
  const out: PortraitClause[] = [];
  for (const r of rows) {
    if (r.depth === null) continue; // unscored (foundational K/U) — hidden, never zero
    if (r.says && r.says.trim().length > 0) {
      out.push({ dim: r.dim, text: r.says.trim(), fallback: false });
    } else {
      out.push({ dim: r.dim, text: describeDepth(r.dim, r.depth), fallback: true });
    }
  }
  return out;
}

export interface AnchorOption { level: number; text: string; }

/** Every level strictly below `current`, with its anchor text — the "too high" pick list. */
export function lowerAnchorOptions(dim: Dimension, current: number): AnchorOption[] {
  const out: AnchorOption[] = [];
  for (let level = 0; level < current; level++) {
    out.push({ level, text: describeDepth(dim, level) });
  }
  return out;
}

/** Dimension-aware evidence prompt shown before a "too low" raise is allowed. */
export function evidencePromptFor(dim: Dimension): string {
  switch (dim) {
    case 'k':
      return 'What shows students reach a higher level here? An exam or quiz item they answered correctly.';
    case 'u':
      return 'What shows students reason at a higher level here? A student explanation, or a reasoning-based exam item.';
    case 'd':
      return 'What shows students perform at a higher level here? A graded artifact or a completed rubric.';
  }
}
