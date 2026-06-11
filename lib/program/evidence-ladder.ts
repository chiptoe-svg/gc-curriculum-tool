/**
 * Evidence Ladder — read-time credibility band derivation
 *
 * Derives a credibility band from the provenance signals already stored on
 * every captured claim (source + citations).  No schema change, no migration.
 * Applies retroactively to every existing snapshot.
 *
 * Conceptual ladder (from the design spec 2026-06-04):
 *
 *   L0  Instructor claim only                    → band: 'claimed'
 *   L1  Assignment / course-material chunk       → band: 'materials_supported'
 *   L2  Rubric explicitly assessing the claim    → band: 'materials_supported'
 *       (L1 vs L2 distinction deferred — needs material-type classification;
 *       both collapse to 'materials_supported' for now)
 *   L3  Student-produced work cited              → band: 'artifact_verified'
 *   L4  Pre/post / external validation           → out of reach in v1
 *
 * NOTE: 'artifact_verified' is CURRENTLY UNREACHABLE by derivation because
 * CaptureProfileCitation.type only has 'chunk' | 'instructor' today.
 * The band is present in the type and has a placeholder branch so the UI
 * can reference it and it becomes live the moment a 'student_artifact'
 * citation type is added to the schema.  Document this gap so future
 * implementors don't have to rediscover it.
 */

import type {
  CaptureProfileSourceType,
  CaptureProfileCitationType,
} from '@/lib/ai/capture/schema';

export type EvidenceBand = 'claimed' | 'materials_supported' | 'artifact_verified';

export interface EvidenceClaim {
  /** 'instructor' | 'materials' | 'inferred' — absent on pre-v2 snapshots */
  source?: CaptureProfileSourceType | null;
  /** chunk / instructor citations; absent or empty on pre-v2 snapshots */
  citations?: CaptureProfileCitationType[] | null;
}

/**
 * Derive the credibility band for a single claim at read time.
 *
 * Rules (v1):
 * - source === 'inferred', no citations, only instructor citations → 'claimed'
 * - ≥1 citation with type === 'chunk'                            → 'materials_supported'
 * - citation resolving to student-produced work                  → 'artifact_verified'
 *   (UNREACHABLE today — no student-artifact citation type in current schema)
 *
 * Pre-v2 / missing source gracefully defaults to 'claimed'.
 */
export function deriveEvidenceBand(claim: EvidenceClaim): EvidenceBand {
  const { source, citations } = claim;

  // Inferred source — the synthesizer couldn't attribute the claim to a real
  // source; treat as instructor-level regardless of any citations present.
  if (source === 'inferred') {
    return 'claimed';
  }

  const cites = citations ?? [];

  // Walk citations looking for the highest-ladder type.
  for (const c of cites) {
    // PLACEHOLDER: when 'student_artifact' (or equivalent) citation type lands,
    // add:  if (c.type === 'student_artifact') return 'artifact_verified';
    // For now 'artifact_verified' is unreachable from current data.

    if (c.type === 'chunk') {
      // A real course-material chunk (syllabus / assignment / rubric) resolves
      // to at least L1–L2 on the ladder → materials_supported.
      return 'materials_supported';
    }
    // c.type === 'instructor' → still a claim; keep looking for a chunk.
  }

  // The synthesizer attributed the claim to course materials. Honor that even
  // when no chunk citation resolved — `source` is itself an L1 signal, so a
  // materials-sourced claim is materials_supported, not a bare claim.
  if (source === 'materials') {
    return 'materials_supported';
  }

  // Nothing elevated the band: no citations, only instructor citations,
  // source undefined / null / 'instructor' with no material evidence.
  return 'claimed';
}
