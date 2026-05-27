import type { CaptureProfileCitationType, CaptureProfileSourceType } from '@/lib/ai/capture/schema';

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
