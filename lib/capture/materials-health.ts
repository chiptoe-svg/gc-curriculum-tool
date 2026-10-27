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

import { materialProvenance } from '@/lib/capture/material-display';

interface MaterialLike {
  fileName: string;
  extractionStatus: string;
  ignored?: boolean;
}

export function assessMaterialsHealth(materials: MaterialLike[]): MaterialsHealth {
  // Linked-external references we couldn't fetch (Drive PDF:/YouTube:/Google … with a
  // failed status) are intentional "a reference exists but we couldn't fetch it"
  // breadcrumbs from scan-linked-docs — NOT failed extractions of provided content. They
  // must not inflate the under-evidenced signal, so exclude them from the health calculus
  // entirely (a successfully-fetched linked material has status 'ok' and still counts).
  // (issue #4 follow-up)
  const active = materials.filter(
    m => !m.ignored && !(m.extractionStatus === 'failed' && materialProvenance(m) === 'linked'),
  );
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

// Thin-evidence check (owner, 2026-10-27: "push back when it has basically
// nothing to go on"). GC 4400 was captured from a syllabus alone: two uploads
// were never read and nothing came from Canvas, and the guard above saw none of
// it (their extraction was still pending, not failed). The capture page warns
// before the interview and again at approval; faculty may continue anyway.

export interface EvidenceCheck {
  /** Show the warning. */
  warn: boolean;
  /** Active files not read yet (waiting, in progress or failed). */
  unreadFiles: string[];
  /** Nothing has been read except the syllabus (or the generated catalog syllabus). */
  onlySyllabus: boolean;
  /** No Canvas content among the active materials. */
  noCanvas: boolean;
}

interface EvidenceMaterial {
  fileName: string;
  indexingStatus: string;
  extractionStatus: string;
  ignored?: boolean;
  retiredAt?: string | Date | null;
  isSyllabus?: boolean;
}

const READ = new Set(['ready', 'skipped']);
const CATALOG_SYLLABUS_PREFIX = 'Catalog syllabus';

export function assessEvidence(materials: EvidenceMaterial[]): EvidenceCheck {
  // Same exclusions as assessMaterialsHealth: unfetched linked references are
  // breadcrumbs, not provided content.
  const active = materials.filter(
    m => !m.ignored && !m.retiredAt && !(m.extractionStatus === 'failed' && materialProvenance(m) === 'linked'),
  );
  const unreadFiles = active.filter(m => !READ.has(m.indexingStatus)).map(m => m.fileName);
  // 'skipped' files were read but set aside, so they are not evidence.
  const evidence = active.filter(
    m => m.indexingStatus === 'ready' && !m.isSyllabus && !m.fileName.startsWith(CATALOG_SYLLABUS_PREFIX),
  );
  const onlySyllabus = evidence.length === 0;
  const noCanvas = !active.some(m => materialProvenance(m) === 'canvas');
  return { warn: unreadFiles.length > 0 || onlySyllabus, unreadFiles, onlySyllabus, noCanvas };
}
