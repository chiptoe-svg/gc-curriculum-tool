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
import type { Tier } from '@/lib/capture/material-tier';
import { renderToImages } from '@/lib/capture/render-pages';
import { describeSlide } from '@/lib/capture/slide-vision';

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
  // Tier routing (background → digest-only, middle → slide-vision, high/null → full pipeline):
  tier?: Tier | null;
  // Middle-tier slide-vision: raw file bytes and MIME type for page rendering.
  // File-backed materials pass bytes from the blob store; text-backed rows
  // (Canvas HTML) leave these undefined and fall through to the full pipeline.
  fileBytes?: Buffer;
  mimeType?: string;
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

  // 1. FERPA detection — ENFORCED, not merely advisory. High content-risk
  //    material (CUIDs, gradebook/roster tables, multiple student emails,
  //    multiple "Submitted by" names) is auto-set-aside BEFORE any external
  //    LLM digest or embedding call, so student PII never leaves the box.
  //    This is the CONTENT gate; the filename-based materials policy below is
  //    the complementary shape gate. Faculty can override from the Review panel.
  //    Medium/low risk continues to the policy step (medium surfaces a warning
  //    badge but is not blocked, since a single "Submitted by" name is often
  //    benign and the one-click include remains available).
  const ferpa = detectFerpaRisk(extractedText);
  await updateFerpaRisk({ id, risk: ferpa.level });

  if (ferpa.level === 'high') {
    const rules = [...new Set(ferpa.matches.map(m => m.rule))].join(', ') || 'content';
    await updateAutoSetAside({
      id,
      autoSetAside: true,
      setAsideReason: `FERPA risk detected (${rules}) — set aside automatically so student data is not sent to the AI provider. Review and override to include.`,
      ignored: true,
    });
    await updateIndexingStatus({ id, status: 'skipped' });
    return;
  }

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
  // Stage timing (2026-06-16) — attribute indexing latency across digest /
  // contextualize / embed / upsert. Logged as one summary line at the end so a
  // slow real-PDF ingest shows exactly which stage dominates.
  const tDigest = Date.now();
  let digestMs = 0;
  let digestText = '';
  try {
    const { digest, model } = await generateMaterialDigest({ fileName, extractedText });
    digestMs = Date.now() - tDigest;
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

  // 4b. Background tier: embed the digest as a single retrieval unit —
  //     skip chunkMaterial/contextualizeChunk entirely.
  if (input.tier === 'background') {
    await updateIndexingStatus({ id, status: 'indexing' });
    try {
      const [vector] = await embedBatch([digestText]);
      const tenant = tenantForCourse(courseCode);
      const sectionId = `${id}-digest`;
      await input.vectorStore.deleteByMaterial(tenant, id);
      await input.vectorStore.upsertSections(tenant, [{
        id: sectionId,
        materialId: id,
        title: fileName,
        index: 0,
        text: digestText,
      }]);
      await input.vectorStore.upsert(tenant, [{
        id: `${id}-digest-0`,
        vector: vector!,
        materialId: id,
        courseCode,
        fileName,
        sectionTitle: fileName,
        sectionIndex: 0,
        parentSectionId: sectionId,
        text: digestText,
        contextBlurb: '',
      }]);
      console.log(`[ingest] ${courseCode} "${fileName}": background tier — 1 digest unit`);
      await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
    } catch (err) {
      console.error(`finalizeExtraction (background): failed for ${id}`, err);
      await updateIndexingStatus({ id, status: 'failed' });
    }
    return;
  }

  // 4c. Middle tier — slide-vision path.
  //     Renders pages to PNG, describes each via vision model, and upserts one
  //     ChunkVectorRecord per substantive slide under a single doc-level section.
  //     Falls through to the full chunk pipeline when:
  //       • fileBytes are absent (text-backed Canvas row — no file to render), OR
  //       • renderToImages returns [] (not a slide/PDF, or render error), OR
  //       • all slides score 'low' contentLevel (nothing substantive to index).
  //     The try/catch ensures a render or vision error never leaves the row stuck.
  if (input.tier === 'middle') {
    let handledBySlide = false;
    try {
      const images = input.fileBytes
        ? await renderToImages(input.fileBytes, input.mimeType ?? '', fileName)
        : [];

      if (images.length > 0) {
        const allNotes = await Promise.all(images.map(describeSlide));
        // Keep notes with original index for stable IDs before filtering.
        const substantive = allNotes
          .map((note, i) => ({ note, i }))
          .filter(({ note }) => note.contentLevel === 'substantive');

        if (substantive.length > 0) {
          handledBySlide = true;
          await updateIndexingStatus({ id, status: 'indexing' });

          const texts = substantive.map(({ note }) =>
            [note.topic, note.teaches, note.keyVisual].filter(Boolean).join('\n'),
          );
          const vectors = await embedBatch(texts);

          const tenant = tenantForCourse(courseCode);
          const deckSectionId = `${id}-deck`;
          const deckSection: SectionRecord = {
            id: deckSectionId,
            materialId: id,
            title: fileName,
            index: 0,
            text: digestText || fileName,
          };
          const chunkRecords: ChunkVectorRecord[] = substantive.map(({ note: n, i }, batchIdx) => ({
            id: `${id}-slide-${i}`,
            vector: vectors[batchIdx]!,
            materialId: id,
            courseCode,
            // sectionTitle MUST be the document name — no slide ordinals in any surfaced field
            fileName,
            sectionTitle: fileName,
            sectionIndex: 0,
            parentSectionId: deckSectionId,
            text: [n.topic, n.teaches, n.keyVisual].filter(Boolean).join('\n'),
            contextBlurb: '',
          }));

          await input.vectorStore.deleteByMaterial(tenant, id);
          await input.vectorStore.upsertSections(tenant, [deckSection]);
          await input.vectorStore.upsert(tenant, chunkRecords);

          const skipped = allNotes.length - substantive.length;
          console.log(
            `[ingest] ${courseCode} "${fileName}": middle/slide tier — ${substantive.length} slide notes (${skipped} skipped)`,
          );
          await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
        }
      }
    } catch (err) {
      console.error(`finalizeExtraction (middle/slide): failed for ${id} — falling through to chunk pipeline`, err);
      handledBySlide = false;
    }

    if (handledBySlide) return;
    // Fall through to the full chunk pipeline below.
  }

  // 5–6. Chunk + contextualize + embed + upsert
  await updateIndexingStatus({ id, status: 'indexing' });
  try {
    const { sections, details } = chunkMaterial({ fileName, text: extractedText });
    if (details.length === 0) {
      await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
      return;
    }

    const tCtx = Date.now();
    const blurbs = await Promise.all(
      details.map(d => contextualizeChunk({
        materialDigest: digestText,
        sectionTitle: d.sectionTitle,
        chunkText: d.text,
      })),
    );
    const ctxMs = Date.now() - tCtx;

    const toEmbed = details.map((d, i) => `${blurbs[i]!.blurb}\n\n${d.text}`);
    const tEmbed = Date.now();
    const vectors = await embedBatch(toEmbed);
    const embedMs = Date.now() - tEmbed;

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

    const tUpsert = Date.now();
    await input.vectorStore.deleteByMaterial(tenant, id);
    await input.vectorStore.upsertSections(tenant, sectionRecords);
    await input.vectorStore.upsert(tenant, chunkRecords);
    const upsertMs = Date.now() - tUpsert;

    console.log(
      `[ingest] ${courseCode} "${fileName}": ${details.length} chunks — ` +
      `digest ${digestMs}ms, contextualize ${ctxMs}ms, embed ${embedMs}ms, upsert ${upsertMs}ms`,
    );
    await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
  } catch (err) {
    console.error(`finalizeExtraction (v2): indexing failed for ${id}`, err);
    await updateIndexingStatus({ id, status: 'failed' });
  }
}
