import { eq, asc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';

export type CourseMaterialRow = typeof courseMaterials.$inferSelect;
export type ExtractionStatus = 'pending' | 'ok' | 'low_text' | 'failed';
export type ExtractionMethod = 'text' | 'vision';

export interface InsertMaterialInput {
  courseCode: string;
  fileName: string;
  blobUrl: string;
  mimeType: string;
  sizeBytes: number;
  ipHash: string;
}

export async function insertMaterial(input: InsertMaterialInput): Promise<CourseMaterialRow> {
  const [row] = await db
    .insert(courseMaterials)
    .values({ ...input, extractionStatus: 'pending' })
    .returning();
  if (!row) throw new Error('insertMaterial: no row returned');
  return row;
}

export async function listMaterialsByCourse(courseCode: string): Promise<CourseMaterialRow[]> {
  return db
    .select()
    .from(courseMaterials)
    .where(eq(courseMaterials.courseCode, courseCode))
    .orderBy(asc(courseMaterials.uploadedAt));
}

export interface UpdateExtractionInput {
  id: string;
  extractionStatus: ExtractionStatus;
  extractionMethod?: ExtractionMethod;
  extractedText?: string;
  pageCount?: number;
}

export async function updateExtractionResult(input: UpdateExtractionInput): Promise<void> {
  await db
    .update(courseMaterials)
    .set({
      extractionStatus: input.extractionStatus,
      ...(input.extractionMethod !== undefined && { extractionMethod: input.extractionMethod }),
      ...(input.extractedText !== undefined && { extractedText: input.extractedText }),
      ...(input.pageCount !== undefined && { pageCount: input.pageCount }),
    })
    .where(eq(courseMaterials.id, input.id));
}

export async function getMaterialById(id: string): Promise<CourseMaterialRow | null> {
  const rows = await db
    .select()
    .from(courseMaterials)
    .where(eq(courseMaterials.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteMaterial(id: string): Promise<void> {
  await db.delete(courseMaterials).where(eq(courseMaterials.id, id));
}

/**
 * Toggle the ignored flag for a material. When true, AI-facing context
 * loaders should exclude this material's extractedText. The row itself
 * stays in the database (set to false again to re-include).
 */
export async function setMaterialIgnored(id: string, ignored: boolean): Promise<boolean> {
  const rows = await db
    .update(courseMaterials)
    .set({ ignored })
    .where(eq(courseMaterials.id, id))
    .returning({ id: courseMaterials.id });
  return rows.length > 0;
}
