// Materials extraction-health guard (2026-07-27). Extraction can fail silently
// — e.g. GC 3620, where 14 of 18 materials (20-42 MB image-heavy slide decks)
// failed with CUDA errors, so the profile was synthesized from ONE material with
// no warning. This computes an aggregate so the failure is surfaced loudly at the
// point of harm (scoring) and persistently in the capture UI, instead of only a
// per-row status dot nobody notices.

export interface MaterialsHealth {
  /** Active (non-ignored) materials. */
  total: number;
  /** Active materials whose extraction failed → contribute NO text/chunks. */
  failedExtraction: number;
  /** File names of the failed materials (for the "which ones" detail). */
  failedFiles: string[];
  /** none = all good; notice = some failed; severe = enough failed that the
   *  profile is likely under-evidenced (don't trust the scores). */
  severity: 'none' | 'notice' | 'severe';
}

interface MaterialLike {
  fileName: string;
  extractionStatus: string;
  ignored?: boolean;
}

export function assessMaterialsHealth(materials: MaterialLike[]): MaterialsHealth {
  const active = materials.filter(m => !m.ignored);
  const failed = active.filter(m => m.extractionStatus === 'failed');
  const total = active.length;
  const failedExtraction = failed.length;
  const ratio = total > 0 ? failedExtraction / total : 0;
  const severity: MaterialsHealth['severity'] =
    failedExtraction === 0 ? 'none'
      : (ratio >= 0.3 || failedExtraction >= 5) ? 'severe'
        : 'notice';
  return { total, failedExtraction, failedFiles: failed.map(m => m.fileName), severity };
}
