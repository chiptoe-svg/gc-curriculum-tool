/**
 * clearRawBlobsForCourse — delete raw uploaded files after snapshot approval.
 *
 * Called after createSnapshot succeeds when isTriageEnabled() is true.
 * Only deletes local-filesystem blobs (keyFromLocalUrl → non-null). Remote
 * refs (Canvas HTML rows, YouTube, Google Docs, etc.) are skipped because
 * they have no local file to delete.
 *
 * Best-effort: a missing or unwritable file must not throw. The durable
 * record (extractedText, digest, Weaviate vectors) is never touched — only
 * raw_cleared is set to true.
 */

import { listMaterialsByCourse, setMaterialRawCleared } from '@/lib/db/course-materials-queries';
import { keyFromLocalUrl, deleteLocal } from '@/lib/storage/local-storage';

export async function clearRawBlobsForCourse(courseCode: string): Promise<{ cleared: number }> {
  const materials = await listMaterialsByCourse(courseCode);
  let cleared = 0;

  for (const material of materials) {
    // Skip already-cleared materials
    if (material.rawCleared) continue;

    // Skip remote refs — nothing to delete locally
    const key = keyFromLocalUrl(material.blobUrl);
    if (!key) continue;

    // Best-effort delete — a missing or permission-denied file must not throw
    await deleteLocal(key).catch(() => {});

    // Mark cleared regardless of whether the file existed (it may already have
    // been manually removed; the important thing is we won't try again)
    await setMaterialRawCleared(material.id);
    cleared += 1;
  }

  return { cleared };
}
