import { eq, and, asc, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';

export type CourseMaterialRow = typeof courseMaterials.$inferSelect;

/**
 * Maps a raw DB row (from db.execute) to a typed CourseMaterialRow. Used by
 * getMaterialById and claimNextQueued to avoid duplicating field mapping.
 */
function mapMaterialRow(row: Record<string, unknown>): CourseMaterialRow {
  return {
    id: row['id'] as string,
    courseCode: row['course_code'] as string,
    fileName: row['file_name'] as string,
    blobUrl: row['blob_url'] as string,
    mimeType: row['mime_type'] as string,
    sizeBytes: row['size_bytes'] as number,
    pageCount: row['page_count'] as number | null,
    extractionMethod: row['extraction_method'] as string | null,
    extractionStatus: row['extraction_status'] as string,
    extractedText: row['extracted_text'] as string | null,
    analysisFinding: row['analysis_finding'] as CourseMaterialRow['analysisFinding'],
    analysisModel: row['analysis_model'] as string | null,
    analysisCostUsdCents: row['analysis_cost_usd_cents'] as number | null,
    uploadedAt: row['uploaded_at'] as Date,
    ipHash: row['ip_hash'] as string,
    digest: row['digest'] as string | null,
    digestModel: row['digest_model'] as string | null,
    digestGeneratedAt: row['digest_generated_at'] as Date | null,
    useDigest: row['use_digest'] as boolean,
    ferpaRisk: row['ferpa_risk'] as string,
    autoSetAside: row['auto_set_aside'] as boolean,
    setAsideReason: row['set_aside_reason'] as string | null,
    indexingStatus: row['indexing_status'] as string,
    tier: row['tier'] as string | null,
    indexedAt: row['indexed_at'] as Date | null,
    ignored: row['ignored'] as boolean,
    ignoredItems: (row['ignored_items'] as string[] | null) ?? [],
    sourceCode: row['source_code'] as string | null,
    rawCleared: row['raw_cleared'] as boolean,
    retiredAt: row['retired_at'] as Date | null,
    ingestProvider: row['ingest_provider'] as string | null,
  };
}
export type ExtractionStatus = 'pending' | 'ok' | 'low_text' | 'failed';
export type ExtractionMethod = 'text' | 'vision';

export interface InsertMaterialInput {
  courseCode: string;
  fileName: string;
  blobUrl: string;
  mimeType: string;
  sizeBytes: number;
  ipHash: string;
  sourceCode?: string | null;
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
 * Returns the existing row for a (courseCode, fileName, sourceCode) triple,
 * or null. Used by canvas-import's upsert path: Canvas content has stable
 * filenames per course (Canvas: Syllabus, Canvas File: X.pdf, etc.),
 * so re-imports refresh in place instead of creating duplicates.
 *
 * The optional `sourceCode` param scopes the lookup to a specific paired
 * source course. When null (the default), the query matches rows where
 * source_code IS NULL — i.e. primary/legacy rows. This ensures that
 * bundled lecture+lab imports can't collide: each source gets its own rows.
 *
 * Back-compat: existing callers that pass only (courseCode, fileName)
 * continue to match the legacy null-source rows unchanged.
 */
export async function findMaterialByFileName(
  courseCode: string,
  fileName: string,
  sourceCode: string | null = null,
): Promise<CourseMaterialRow | null> {
  const rows = await db
    .select()
    .from(courseMaterials)
    .where(and(
      eq(courseMaterials.courseCode, courseCode),
      eq(courseMaterials.fileName, fileName),
      sourceCode === null ? isNull(courseMaterials.sourceCode) : eq(courseMaterials.sourceCode, sourceCode),
    ))
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
 * Persists the triage tier for a material. Called by list-mode Canvas import
 * after classifyManifestItem resolves. Safe to call on both insert and update
 * paths — the tier column is nullable and defaults to null until classified.
 */
export async function updateMaterialTier(id: string, tier: string): Promise<void> {
  await db.update(courseMaterials).set({ tier }).where(eq(courseMaterials.id, id));
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
 * **Defaults to false** for materials whose original IS the audit signal:
 *   - `Canvas: Assignments / Discussions / Quizzes / Module List / Pages` —
 *     structured per-block (title + points + description + rubric); the
 *     audit needs per-item precision (point weights, rubric criteria)
 *   - `YouTube: <title>` — the transcript IS the material; the digest of a
 *     transcript loses the speaker's actual words, which is exactly the
 *     evidence the audit needs to evaluate K/U/D
 *
 * **Defaults to true** for everything else — `Canvas File: *.pdf`
 * (narrative documents pulled from Canvas) and faculty-uploaded files.
 * Faculty can still toggle via the Review panel's per-material checkbox;
 * this controls only the initial value.
 */
export function shouldDigestByDefault(fileName: string): boolean {
  if (fileName.startsWith('Canvas: ')) return false;
  if (fileName.startsWith('YouTube:')) return false;
  return true;
}

/**
 * Replaces the per-item ignore list for a Canvas-list material. The array
 * stores item titles (the `## Title` text that delimits items in the
 * concatenated extractedText). Audit context + v2 chunker filter these out
 * downstream. Returns true if the row was updated, false if it did not exist.
 */
export async function setMaterialIgnoredItems(id: string, ignoredItems: string[]): Promise<boolean> {
  const rows = await db
    .update(courseMaterials)
    .set({ ignoredItems })
    .where(eq(courseMaterials.id, id))
    .returning({ id: courseMaterials.id });
  return rows.length > 0;
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
  status: 'pending' | 'queued' | 'indexing' | 'ready' | 'failed' | 'skipped';
  indexedAt?: Date;
  /** When present, also write ingest_provider (null clears it). Omit to leave it untouched. */
  ingestProvider?: string | null;
}): Promise<void> {
  await db.update(courseMaterials)
    .set({
      indexingStatus: args.status,
      ...(args.indexedAt ? { indexedAt: args.indexedAt } : {}),
      ...(args.ingestProvider !== undefined ? { ingestProvider: args.ingestProvider } : {}),
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

/**
 * Mark a material's raw blob as cleared. Called after the local file has been
 * deleted on snapshot approval (isTriageEnabled flow). The durable record
 * (extractedText, digest, vectors) is unaffected — only raw_cleared flips.
 */
export async function setMaterialRawCleared(id: string): Promise<void> {
  await db.update(courseMaterials).set({ rawCleared: true }).where(eq(courseMaterials.id, id));
}

/** The currency contract for the cross-course spine: a material contributes
 *  chunks only when it is fully indexed, not ignored, and not retired. */
export function buildIndexableMaterialsWhere(courseCode: string) {
  return and(
    eq(courseMaterials.courseCode, courseCode),
    eq(courseMaterials.indexingStatus, 'ready'),
    eq(courseMaterials.ignored, false),
    isNull(courseMaterials.retiredAt),
  );
}

/** Current, indexable materials for a course (spine currency set). */
export async function listIndexableMaterialsForCourse(
  courseCode: string,
): Promise<CourseMaterialRow[]> {
  return db.select().from(courseMaterials).where(buildIndexableMaterialsWhere(courseCode));
}

/** Set/clear a material's retired state. Returns true if a row was updated. */
export async function setMaterialRetired(id: string, retired: boolean): Promise<boolean> {
  const rows = await db
    .update(courseMaterials)
    .set({ retiredAt: retired ? new Date() : null })
    .where(eq(courseMaterials.id, id))
    .returning({ id: courseMaterials.id });
  return rows.length > 0;
}

/**
 * Atomically claim the oldest queued material for the background ingest
 * worker, flipping it to 'indexing' in the same statement so two workers (or
 * loop ticks) never grab the same row. FOR UPDATE SKIP LOCKED makes concurrent
 * claims pick distinct rows. Returns null when nothing is queued.
 */
export async function claimNextQueued(): Promise<CourseMaterialRow | null> {
  const res = await db.execute(sql`
    UPDATE course_materials SET indexing_status = 'indexing'
    WHERE id = (
      SELECT id FROM course_materials
      WHERE indexing_status = 'queued'
      ORDER BY uploaded_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `);
  const row = (res.rows as Record<string, unknown>[])[0];
  return row ? mapMaterialRow(row) : null;
}

/**
 * Boot recovery: a row left 'indexing' is a crash/restart remnant (a live
 * worker always moves it to ready/failed). Re-queue them. Returns the count.
 */
export async function resetStuckIndexing(): Promise<number> {
  const res = await db.execute(sql`
    UPDATE course_materials SET indexing_status = 'queued'
    WHERE indexing_status = 'indexing';
  `);
  return res.rowCount ?? 0;
}

/** Test seam — exercise the raw-row mapper directly. */
export const __mapMaterialRowForTest = mapMaterialRow;
