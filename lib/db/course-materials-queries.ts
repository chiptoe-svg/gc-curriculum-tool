import { eq, and, asc } from 'drizzle-orm';
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

/**
 * Returns the existing row for a (courseCode, fileName) pair, or null.
 * Used by canvas-import's upsert path: Canvas content has stable
 * filenames per course (Canvas: Syllabus, Canvas File: X.pdf, etc.),
 * so re-imports refresh in place instead of creating duplicates.
 */
export async function findMaterialByFileName(
  courseCode: string,
  fileName: string,
): Promise<CourseMaterialRow | null> {
  const rows = await db
    .select()
    .from(courseMaterials)
    .where(and(eq(courseMaterials.courseCode, courseCode), eq(courseMaterials.fileName, fileName)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Updates the metadata fields a canvas-import refresh might change.
 * Distinct from updateExtractionResult which only writes extraction
 * outcomes — this covers blobUrl + mimeType + sizeBytes too because a
 * Canvas re-import can change those (token rotated, file replaced
 * upstream, mimeType inferred correctly the second time).
 */
export interface UpdateMaterialMetadataInput {
  id: string;
  blobUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
}
export async function updateMaterialMetadata(input: UpdateMaterialMetadataInput): Promise<void> {
  const patch: Partial<typeof courseMaterials.$inferInsert> = {};
  if (input.blobUrl !== undefined) patch.blobUrl = input.blobUrl;
  if (input.mimeType !== undefined) patch.mimeType = input.mimeType;
  if (input.sizeBytes !== undefined) patch.sizeBytes = input.sizeBytes;
  if (Object.keys(patch).length === 0) return;
  await db.update(courseMaterials).set(patch).where(eq(courseMaterials.id, input.id));
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

export interface UpdateMaterialDigestInput {
  id: string;
  digest: string;
  digestModel: string;
  /**
   * Whether to also turn useDigest ON. Default `true` (matches the original
   * behavior — most materials are narrative and benefit from the digest
   * standing in for full text in at-rest context). Pass `false` for
   * structured-list Canvas materials where the original is already
   * curriculum-shaped and precision (point values, rubric criteria) matters
   * more than compression. See `shouldDigestByDefault()`.
   */
  useDigest?: boolean;
}
export async function updateMaterialDigest(input: UpdateMaterialDigestInput): Promise<void> {
  await db
    .update(courseMaterials)
    .set({
      digest: input.digest,
      digestModel: input.digestModel,
      digestGeneratedAt: new Date(),
      useDigest: input.useDigest ?? true,
    })
    .where(eq(courseMaterials.id, input.id));
}

/**
 * Whether a freshly-extracted material should default to `useDigest = true`
 * (digest replaces raw text in the agent's at-rest context) or `false`
 * (agent reads the original extracted text).
 *
 * **Defaults to false** for Canvas-imported list-shaped materials
 * (`Canvas: Assignments`, `Canvas: Discussions`, `Canvas: Quizzes`,
 * `Canvas: Module List`, `Canvas: Pages`) — the originals are already
 * structured per-block (title + points + description) and the audit
 * specifically needs to read assignment-by-assignment precision (point
 * weights, rubric criteria). Summarizing them loses signal.
 *
 * **Defaults to true** for everything else — `Canvas File: *.pdf`
 * (narrative documents pulled from Canvas) and faculty-uploaded files.
 * Faculty can still toggle via the Review panel's per-material checkbox;
 * this controls only the initial value.
 */
export function shouldDigestByDefault(fileName: string): boolean {
  if (fileName.startsWith('Canvas: ')) return false;
  return true;
}

export async function setMaterialUseDigest(id: string, useDigest: boolean): Promise<boolean> {
  const rows = await db
    .update(courseMaterials)
    .set({ useDigest })
    .where(eq(courseMaterials.id, id))
    .returning({ id: courseMaterials.id });
  return rows.length > 0;
}

export async function updateIndexingStatus(args: {
  id: string;
  status: 'pending' | 'indexing' | 'ready' | 'failed' | 'skipped';
  indexedAt?: Date;
}): Promise<void> {
  await db.update(courseMaterials)
    .set({
      indexingStatus: args.status,
      ...(args.indexedAt ? { indexedAt: args.indexedAt } : {}),
    })
    .where(eq(courseMaterials.id, args.id));
}

export async function updateFerpaRisk(args: {
  id: string;
  risk: 'low' | 'medium' | 'high';
}): Promise<void> {
  await db.update(courseMaterials)
    .set({ ferpaRisk: args.risk })
    .where(eq(courseMaterials.id, args.id));
}

export async function updateAutoSetAside(args: {
  id: string;
  autoSetAside: boolean;
  setAsideReason: string | null;
  ignored: boolean;
}): Promise<void> {
  await db.update(courseMaterials)
    .set({
      autoSetAside: args.autoSetAside,
      setAsideReason: args.setAsideReason,
      ignored: args.ignored,
    })
    .where(eq(courseMaterials.id, args.id));
}
