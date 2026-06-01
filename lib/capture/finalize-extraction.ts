import {
  updateExtractionResult,
  updateMaterialDigest,
  shouldDigestByDefault,
  updateIndexingStatus,
  updateFerpaRisk,
  updateAutoSetAside,
  type ExtractionStatus,
  type ExtractionMethod,
} from '@/lib/db/course-materials-queries';
import { isCompressionCandidate } from '@/lib/capture/material-compression';
import { generateMaterialDigest } from '@/lib/ai/analyze/material-digest';
import { contextualizeChunk } from '@/lib/ai/analyze/chunk-contextualize';
import { embedBatch } from '@/lib/ai/embeddings';
import { chunkMaterial } from '@/lib/capture/chunker';
import { detectFerpaRisk } from '@/lib/capture/ferpa-detect';
import { evaluateMaterialsPolicy } from '@/lib/capture/materials-policy';
import { tenantForCourse } from '@/lib/capture/vector-store';
import type { VectorStore, ChunkVectorRecord, SectionRecord } from '@/lib/capture/vector-store';

export interface FinalizeExtractionInput {
  id: string;
  courseCode: string;
  fileName: string;
  extractionStatus: ExtractionStatus;
  extractionMethod?: ExtractionMethod;
  extractedText?: string;
  pageCount?: number;
  // Stage 2a additions:
  vectorStore?: VectorStore;
  courseHasLearningObjectives?: boolean;
}

const v2Enabled = (): boolean => process.env.COURSECAPTURE_V2_INGESTION === '1';

/**
 * Persist the result of an extraction attempt. When COURSECAPTURE_V2_INGESTION
 * is set, run the v2 pipeline (FERPA → policy → digest → chunk + embed +
 * index). Otherwise run the legacy reference-compression-only path. Both
 * paths persist into the renamed digest columns.
 *
 * Replaces direct `updateExtractionResult` calls in every extraction-completion
 * site (uploads, canvas import, scan-linked-docs, canvas re-extract).
 */
export async function finalizeExtraction(input: FinalizeExtractionInput): Promise<void> {
  await updateExtractionResult({
    id: input.id,
    extractionStatus: input.extractionStatus,
    ...(input.extractionMethod !== undefined && { extractionMethod: input.extractionMethod }),
    ...(input.extractedText !== undefined && { extractedText: input.extractedText }),
    ...(input.pageCount !== undefined && { pageCount: input.pageCount }),
  });

  if (input.extractionStatus !== 'ok' || !input.extractedText) return;

  if (v2Enabled()) {
    await runV2Pipeline(input);
    return;
  }

  // Legacy path: long reference materials get a digest via the existing summarizer.
  const candidate = isCompressionCandidate({
    fileName: input.fileName,
    extractedText: input.extractedText,
    digest: null,
    useDigest: false,
  });
  if (!candidate) return;
  try {
    const { digest, model } = await generateMaterialDigest({
      fileName: input.fileName,
      extractedText: input.extractedText,
    });
    await updateMaterialDigest({ id: input.id, digest, digestModel: model });
  } catch (err) {
    console.error(`finalizeExtraction (legacy): digest failed for ${input.id} (${input.fileName})`, err);
    // Intentionally swallowed — extraction itself succeeded. The backfill
    // endpoint can re-attempt later.
  }
}

async function runV2Pipeline(input: FinalizeExtractionInput): Promise<void> {
  const { id, courseCode, fileName, extractedText } = input;
  if (!extractedText) return;

  // 1. FERPA detection
  const ferpa = detectFerpaRisk(extractedText);
  await updateFerpaRisk({ id, risk: ferpa.level });

  // 2. Materials policy → set aside if not included
  const policy = evaluateMaterialsPolicy({
    fileName,
    extractedText,
    courseHasLearningObjectives: !!input.courseHasLearningObjectives,
  });
  await updateAutoSetAside({
    id,
    autoSetAside: !policy.included,
    setAsideReason: policy.included ? null : policy.reason,
    ignored: !policy.included,
  });
  if (!policy.included) {
    await updateIndexingStatus({ id, status: 'skipped' });
    return;
  }

  // 3. Digest (every material, not just long reference ones).
  //    useDigest default depends on material shape — Canvas-imported
  //    list-shaped materials (Assignments, Discussions, Quizzes, Pages,
  //    Module List) keep useDigest OFF so the agent reads the structured
  //    original. Narrative documents (PDFs, faculty uploads) keep ON.
  //    Faculty can toggle from the Review panel's per-material checkbox.
  let digestText = '';
  try {
    const { digest, model } = await generateMaterialDigest({ fileName, extractedText });
    digestText = digest;
    await updateMaterialDigest({
      id, digest, digestModel: model,
      useDigest: shouldDigestByDefault(fileName),
    });
  } catch (err) {
    console.error(`finalizeExtraction (v2): digest failed for ${id}`, err);
    await updateIndexingStatus({ id, status: 'failed' });
    return;
  }

  // 4. No vector store wired (dev/test path): stop after digest.
  if (!input.vectorStore) {
    await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
    return;
  }

  // 5–6. Chunk + contextualize + embed + upsert
  await updateIndexingStatus({ id, status: 'indexing' });
  try {
    const { sections, details } = chunkMaterial({ fileName, text: extractedText });
    if (details.length === 0) {
      await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
      return;
    }

    const blurbs = await Promise.all(
      details.map(d => contextualizeChunk({
        materialDigest: digestText,
        sectionTitle: d.sectionTitle,
        chunkText: d.text,
      })),
    );

    const toEmbed = details.map((d, i) => `${blurbs[i]!.blurb}\n\n${d.text}`);
    const vectors = await embedBatch(toEmbed);

    const tenant = tenantForCourse(courseCode);
    const sectionRecords: SectionRecord[] = sections.map(s => ({
      id: s.id,
      materialId: id,
      title: s.title,
      index: s.index,
      text: s.text,
    }));
    const chunkRecords: ChunkVectorRecord[] = details.map((d, i) => ({
      id: d.id,
      vector: vectors[i]!,
      materialId: id,
      courseCode,
      fileName,
      sectionTitle: d.sectionTitle,
      sectionIndex: d.sectionIndex,
      parentSectionId: d.parentSectionId,
      text: d.text,
      contextBlurb: blurbs[i]!.blurb,
    }));

    await input.vectorStore.deleteByMaterial(tenant, id);
    await input.vectorStore.upsertSections(tenant, sectionRecords);
    await input.vectorStore.upsert(tenant, chunkRecords);

    await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
  } catch (err) {
    console.error(`finalizeExtraction (v2): indexing failed for ${id}`, err);
    await updateIndexingStatus({ id, status: 'failed' });
  }
}
