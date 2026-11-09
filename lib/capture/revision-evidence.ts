/**
 * Which citations count as NEW evidence for a revision, and which point at
 * material no longer in use (spec 2026-11-08-course-revision-modes-labels-design.md).
 *
 * New: an instructor answer from this session, or a passage from a file added
 * or edited since the baseline snapshot (drift against its frozen inputs,
 * including the text fingerprint). Stale: a passage whose chunk or file is
 * gone, retired, set aside from the AI, or no longer among the live files.
 * A failed lookup is never new and always stale.
 */
import type { CaptureProfile, CaptureProfileCitationType } from '@/lib/ai/capture/schema';
import type { SnapshotRow } from '@/lib/db/capture-snapshots-queries';
import type { CourseMaterialRow } from '@/lib/db/course-materials-queries';
import { getSessionMessages } from '@/lib/db/capture-messages-queries';
import { diffInputsVsSnapshot } from '@/lib/capture/inputs-drift';
import { isSentToAI } from '@/lib/capture/material-in-use';
import { createVectorStore, tenantForCourse, type VectorStore } from '@/lib/capture/vector-store';

export interface CitationClassifiers {
  isNewCitation: (c: CaptureProfileCitationType) => boolean;
  isStaleCitation: (c: CaptureProfileCitationType) => boolean;
}

function chunkIdsOf(profile: CaptureProfile | null | undefined): string[] {
  return (profile?.competencies ?? []).flatMap(c =>
    (c.citations ?? []).flatMap(cit => (cit.type === 'chunk' && cit.chunkId ? [cit.chunkId] : [])),
  );
}

export async function buildCitationClassifiers(input: {
  courseCode: string;
  sessionId: string;
  baseline: SnapshotRow;
  materials: CourseMaterialRow[];
  course: { canvasImportedAt: string | Date | null };
  scored: CaptureProfile;
  store?: VectorStore;
}): Promise<CitationClassifiers> {
  const { courseCode, baseline, materials } = input;
  const messages = await getSessionMessages(courseCode, input.sessionId);
  const sessionMessageIds = messages.map(m => m.id);

  const drift = diffInputsVsSnapshot(baseline.inputsMeta, materials, input.course);
  const newMaterialIds = new Set([...drift.added, ...drift.changed].map(m => m.id));
  const removedMaterialIds = new Set(drift.removed.map(m => m.id));
  const materialById = new Map(materials.map(m => [m.id, m]));

  // One lookup per distinct chunk id; a failed lookup resolves to null.
  const store = input.store ?? createVectorStore();
  const tenant = tenantForCourse(courseCode);
  const chunkIds = [...new Set([...chunkIdsOf(input.scored), ...chunkIdsOf(baseline.profile)])];
  const materialOfChunk = new Map<string, string | null>();
  await Promise.all(chunkIds.map(async id => {
    try {
      materialOfChunk.set(id, (await store.fetchChunkById(tenant, id))?.materialId ?? null);
    } catch {
      materialOfChunk.set(id, null);
    }
  }));

  const chunkMaterial = (c: CaptureProfileCitationType) =>
    c.type === 'chunk' && c.chunkId ? materialOfChunk.get(c.chunkId) ?? null : null;

  return {
    isNewCitation(c) {
      if (c.type === 'instructor') {
        const id = c.messageId ?? '';
        return id.length > 0 && sessionMessageIds.some(m => m === id || (id.length === 8 && m.startsWith(id)));
      }
      const materialId = chunkMaterial(c);
      return materialId !== null && newMaterialIds.has(materialId);
    },
    isStaleCitation(c) {
      if (c.type !== 'chunk') return false;
      const materialId = chunkMaterial(c);
      if (materialId === null || removedMaterialIds.has(materialId)) return true;
      const m = materialById.get(materialId);
      return !m || !isSentToAI(m);
    },
  };
}
