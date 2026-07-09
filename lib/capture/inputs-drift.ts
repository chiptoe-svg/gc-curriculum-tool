import type { InputsMeta } from '@/lib/db/capture-snapshots-queries';
import type { CourseMaterialRow } from '@/lib/db/course-materials-queries';

export interface MaterialRef { id: string; fileName: string; }
export interface MaterialChange { id: string; fileName: string; was: string; now: string; }
export interface InputsDrift {
  available: boolean;            // false when the snapshot froze no materials list (legacy)
  added: MaterialRef[];
  removed: MaterialRef[];
  changed: MaterialChange[];
  canvasChanged: boolean;
  docsChanged: boolean;
  hasDrift: boolean;
}

/** Live material is "present" only if not retired. */
function isLive(m: CourseMaterialRow): boolean {
  return (m as { retiredAt?: Date | null }).retiredAt == null;
}
function describe(m: { extractionStatus?: string | null; sizeBytes?: number | null; ignored?: boolean }): string {
  return `${m.extractionStatus ?? '?'}·${m.sizeBytes ?? 0}·${m.ignored ? 'ignored' : 'active'}`;
}

export function diffInputsVsSnapshot(
  inputsMeta: InputsMeta,
  currentMaterials: CourseMaterialRow[],
  course: { canvasImportedAt: string | Date | null },
): InputsDrift {
  const frozen = inputsMeta?.materials ?? [];
  // Only claim canvas drift when the snapshot actually FROZE a timestamp (non-null).
  // Legacy snapshots froze null → unknown → no false "changed". New snapshots freeze it.
  const frozenCanvas = inputsMeta?.scanPasses?.canvasImportedAt ?? null;
  const canvasChanged = frozenCanvas != null && String(frozenCanvas) !== String(course?.canvasImportedAt ?? '');
  const docsChanged = false; // no live per-course googleDocsScannedAt to compare; reserved.

  if (frozen.length === 0) {
    return { available: false, added: [], removed: [], changed: [], canvasChanged, docsChanged, hasDrift: canvasChanged };
  }
  const liveById = new Map(currentMaterials.filter(isLive).map(m => [m.id, m]));
  const frozenById = new Map(frozen.map(f => [f.id, f]));

  const added: MaterialRef[] = [];
  for (const m of liveById.values()) if (!frozenById.has(m.id)) added.push({ id: m.id, fileName: m.fileName });

  const removed: MaterialRef[] = [];
  const changed: MaterialChange[] = [];
  for (const f of frozen) {
    const live = liveById.get(f.id);
    if (!live) { removed.push({ id: f.id, fileName: f.fileName }); continue; }
    const was = describe(f);
    const now = describe(live);
    if (was !== now) changed.push({ id: f.id, fileName: f.fileName, was, now });
  }
  const hasDrift = added.length > 0 || removed.length > 0 || changed.length > 0 || canvasChanged;
  return { available: true, added, removed, changed, canvasChanged, docsChanged, hasDrift };
}
