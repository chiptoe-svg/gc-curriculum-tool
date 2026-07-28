/**
 * Classifies a materials list into the pre-interview gate's flag buckets (issue #4
 * follow-up). Pure, no I/O. Returns [] for a clean capture (no gate shown).
 *
 * Buckets (checked in this order):
 *  - ferpa-held:        auto-set-aside (ignored && autoSetAside) — held from scoring,
 *                       faculty decides to override or leave.
 *  - inaccessible-link: a linked reference (Drive/YouTube/Google) we couldn't fetch.
 *  - extraction-failed: an uploaded/canvas file that couldn't be read.
 * A manual ignore (ignored but NOT autoSetAside) is deliberate and never flagged.
 */
import { materialProvenance } from '@/lib/capture/material-display';

export type FlagKind = 'extraction-failed' | 'ferpa-held' | 'inaccessible-link';

export interface FlaggedMaterial {
  id: string;
  fileName: string;
  kind: FlagKind;
  facultyNote: string | null;
}

export interface FlagInput {
  id: string;
  fileName: string;
  extractionStatus: string;
  indexingStatus: string;
  ignored: boolean;
  autoSetAside: boolean;
  extractedText?: string | null;
  facultyNote?: string | null;
}

export function flagMaterials(materials: FlagInput[]): FlaggedMaterial[] {
  const out: FlaggedMaterial[] = [];
  for (const m of materials) {
    const facultyNote = m.facultyNote ?? null;
    const linked = materialProvenance(m) === 'linked';

    if (m.ignored && m.autoSetAside) {
      out.push({ id: m.id, fileName: m.fileName, kind: 'ferpa-held', facultyNote });
      continue;
    }
    if (m.ignored) continue; // manual ignore = deliberate, not flagged

    if (linked && (m.extractionStatus === 'failed' || (m.indexingStatus === 'skipped' && !m.extractedText))) {
      out.push({ id: m.id, fileName: m.fileName, kind: 'inaccessible-link', facultyNote });
      continue;
    }
    if (!linked && m.extractionStatus === 'failed') {
      out.push({ id: m.id, fileName: m.fileName, kind: 'extraction-failed', facultyNote });
    }
  }
  return out;
}
