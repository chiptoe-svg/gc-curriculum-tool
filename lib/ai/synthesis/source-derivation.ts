import type { CaptureProfile, CaptureProfileCitationType, CaptureProfileSourceType } from '@/lib/ai/capture/schema';

/**
 * Derive the `source` flag for a finding from its citation set, per the
 * CourseCapture v2 spec § Phase C — Synthesis (mechanical-rule clause).
 *
 *   - All citations type=instructor → 'instructor'
 *   - All citations type=chunk → 'materials'
 *   - Mixed (at least one of each) → 'inferred'
 *   - No citations → 'inferred' (the finding is speculative)
 *
 * The function is pure: no I/O, deterministic from inputs. Used by the
 * synthesis layer to verify the model's `source` output and as a fallback
 * when the model emits citations but forgets the explicit `source` field.
 */
export function deriveSourceFlag(citations: CaptureProfileCitationType[]): CaptureProfileSourceType {
  if (citations.length === 0) return 'inferred';
  const hasInstructor = citations.some(c => c.type === 'instructor');
  const hasChunk = citations.some(c => c.type === 'chunk');
  if (hasInstructor && !hasChunk) return 'instructor';
  if (hasChunk && !hasInstructor) return 'materials';
  return 'inferred';
}

/**
 * Override each competency's `source` with the mechanically-derived flag
 * (A9, 2026-06-12). The synthesis model emits `source` itself, but a
 * self-reported provenance flag is exactly the thing it could misclaim — a
 * "materials" label with zero citations would launder speculation into
 * apparent evidence. Deriving from the citation set makes the flag
 * trustworthy by construction: no resolvable citations → 'inferred',
 * downgraded honestly. Pure; returns a new profile object.
 *
 * Scope: competencies only — they are the scored findings the evidence
 * ladder and program views read. Other blocks (overview, verification,
 * audit notes) keep the model's flag; tighten later if they ever feed
 * scoring.
 */
export function withDerivedCompetencySources(profile: CaptureProfile): CaptureProfile {
  return {
    ...profile,
    competencies: profile.competencies.map(c => ({
      ...c,
      source: deriveSourceFlag(c.citations ?? []),
    })),
  };
}
