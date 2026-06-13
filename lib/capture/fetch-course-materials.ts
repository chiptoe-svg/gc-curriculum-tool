import type { CaptureMaterial } from '@/app/capture/[code]/MaterialsPanel';

/**
 * Fetch the course's materials (as the capture context endpoint returns them)
 * and map to CaptureMaterial[]. Returns null on failure. Shared by MaterialsPanel
 * and CaptureMaterialsStep so the row shape stays in one place.
 */
export async function fetchCourseMaterials(courseCode: string, slug: string): Promise<CaptureMaterial[] | null> {
  try {
    const res = await fetch(
      `/api/capture/${encodeURIComponent(courseCode)}/context?slug=${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return mapContextToMaterials(json);
  } catch {
    return null;
  }
}

function mapContextToMaterials(json: {
  materials: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    pageCount: number | null;
    extractionStatus: string;
    extractionMethod: string | null;
    extractedText: string | null;
    ignored: boolean;
    digest: string | null;
    digestGeneratedAt: string | null;
    useDigest: boolean;
    indexingStatus: CaptureMaterial['indexingStatus'];
    indexedAt: string | null;
    ferpaRisk: CaptureMaterial['ferpaRisk'];
    autoSetAside: boolean;
    setAsideReason: string | null;
    blobUrl: string;
    ignoredItems?: readonly string[];
    sourceCode?: string | null;
  }>;
}): CaptureMaterial[] {
  return json.materials.map(m => ({ ...m, sourceCode: m.sourceCode ?? null }));
}
