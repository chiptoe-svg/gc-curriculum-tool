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
import { chunkMaterial, syntheticUuid } from '@/lib/capture/chunker';
import { detectFerpaRisk } from '@/lib/capture/ferpa-detect';
import { evaluateMaterialsPolicy, isSyllabusFileName } from '@/lib/capture/materials-policy';
import { tenantForCourse } from '@/lib/capture/vector-store';
import type { VectorStore, ChunkVectorRecord, SectionRecord } from '@/lib/capture/vector-store';
import type { Tier } from '@/lib/capture/material-tier';
import { renderToImages } from '@/lib/capture/render-pages';
import { describeSlides, type SlideNote } from '@/lib/capture/slide-vision';
import { sanitizeExtractedText } from '@/lib/capture/sanitize-extracted-text';
import { scrubForRecord } from '@/lib/privacy/scrub';

export interface FinalizeExtractionInput {
  id: string;
  courseCode: string;
  fileName: string;
  /** The material's `is_syllabus` flag. When true, exempt from the FERPA risk
   *  check the same as a syllabus-shaped filename (syllabi are public documents). */
  isSyllabus?: boolean;
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
  /**
   * Per-slide notes from the extract-time adaptive vision pass. When present, the
   * middle-tier chunk build REUSES them instead of re-rendering + re-describing
   * (removes the double vision pass). Absent (text-backed / non-vision) → the
   * middle tier renders + describes as before.
   */
  slideNotes?: SlideNote[];
  /** Local-only run: suppress the OpenAI fallback in digest/contextualize. */
  noOpenAIFallback?: boolean;
}

const v2Enabled = (): boolean => process.env.COURSECAPTURE_V2_INGESTION === '1';

/**
 * Run `fn` over `items` with at most `limit` concurrent calls, preserving
 * insertion order in the returned array.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
  // Persistence-boundary scrub: strip VLM reasoning preambles (Flavour A) and
  // failure narration / decoder repetition (Flavour B) from ANY source path
  // before extracted_text is stored. Every extracted_text write funnels through
  // here, so this is the one place that covers docling-text and vision alike.
  const cleanedText =
    input.extractedText !== undefined ? sanitizeExtractedText(input.extractedText) : undefined;
  const scrubbed: FinalizeExtractionInput = { ...input, extractedText: cleanedText };

  // updateExtractionResult privacy-scrubs the text before storing it
  // (spec 2026-10-05) and returns what it stored.
  const persisted = await updateExtractionResult({
    id: scrubbed.id,
    extractionStatus: scrubbed.extractionStatus,
    ...(scrubbed.extractionMethod !== undefined && { extractionMethod: scrubbed.extractionMethod }),
    ...(scrubbed.extractedText !== undefined && { extractedText: scrubbed.extractedText }),
    ...(scrubbed.pageCount !== undefined && { pageCount: scrubbed.pageCount }),
  });
  if (persisted.outcome === 'scrub_failed') {
    // Nothing was stored, so nothing downstream (digest, chunks, embeddings) may see this text.
    await updateIndexingStatus({ id: input.id, status: 'failed' });
    return;
  }
  // Downstream reads use `stored` — the text exactly as written — never `input`.
  const stored: FinalizeExtractionInput = { ...scrubbed, extractedText: persisted.extractedText };

  if (stored.extractionStatus !== 'ok' || !stored.extractedText) return;

  if (v2Enabled()) {
    await runV2Pipeline(stored);
    return;
  }

  // Legacy path: long reference materials get a digest via the existing summarizer.
  const candidate = isCompressionCandidate({
    fileName: stored.fileName,
    extractedText: stored.extractedText,
    digest: null,
    useDigest: false,
  });
  if (!candidate) return;
  try {
    const { digest, model } = await generateMaterialDigest({
      fileName: stored.fileName,
      extractedText: stored.extractedText,
    });
    await updateMaterialDigest({ id: stored.id, digest, digestModel: model });
  } catch (err) {
    console.error(`finalizeExtraction (legacy): digest failed for ${input.id} (${input.fileName})`, err);
    // Intentionally swallowed — extraction itself succeeded. The backfill
    // endpoint can re-attempt later.
  }
}

async function runV2Pipeline(input: FinalizeExtractionInput): Promise<void> {
  const { id, courseCode, fileName, extractedText } = input;
  if (!extractedText) return;

  // 1. FERPA risk — recorded for display only (privacy-scrub spec 2026-10-05).
  //    Student identifiers were scrubbed out of `extractedText` by
  //    updateExtractionResult before it was stored, so the old FERPA hold
  //    (auto set-aside of high-risk files) is retired. The value now describes
  //    the stored, scrubbed text. Syllabi are exempt: they are public
  //    documents (owner, 2026-10-05). A material explicitly flagged
  //    `is_syllabus` is exempt too, even when its filename doesn't look like a
  //    syllabus (e.g. a Canvas File: upload named via the Syllabus box).
  const ferpa = (input.isSyllabus === true || isSyllabusFileName(fileName))
    ? { level: 'low' as const, matches: [] }
    : detectFerpaRisk(extractedText);
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
  // Stage timing (2026-06-16) — attribute indexing latency across digest /
  // contextualize / embed / upsert. Logged as one summary line at the end so a
  // slow real-PDF ingest shows exactly which stage dominates.
  const tDigest = Date.now();
  let digestMs = 0;
  let digestText = '';
  try {
    const { digest, model } = await generateMaterialDigest({ fileName, extractedText }, { noOpenAIFallback: input.noOpenAIFallback });
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
      // UUID-formatted: Weaviate rejects non-UUID ids (see syntheticUuid).
      const sectionId = syntheticUuid(`${id}-digest`);
      await input.vectorStore.deleteByMaterial(tenant, id);
      await input.vectorStore.upsertSections(tenant, [{
        id: sectionId,
        materialId: id,
        title: fileName,
        index: 0,
        text: digestText,
      }]);
      await input.vectorStore.upsert(tenant, [{
        id: syntheticUuid(`${id}-digest-0`),
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
      // Single vision pass: reuse the notes from the extract-time adaptive pass when
      // they were threaded (the image-PDF path), else render + describe here (covers a
      // non-vision caller that still lands in the middle tier). This removes the old
      // double pass where extract-text transcribed AND finalize re-described the deck.
      const allNotes: SlideNote[] = input.slideNotes?.length
        ? input.slideNotes
        : input.fileBytes
          ? await describeSlides(await renderToImages(input.fileBytes, input.mimeType ?? '', fileName))
          : [];

      if (allNotes.length > 0) {
        // Reliability guard (issue #4 follow-up): 'unknown' means a slide could NOT be
        // scored (vision offload + local both failed), which is distinct from the model
        // deciding 'low'. If most slides are unscorable the vision path was down for this
        // deck — do NOT silently degrade to skip/prose (that drops a whole deck of real
        // content, as happened to GC 3620 WK1-Intro). Mark 'failed' so the health guard
        // surfaces it and a re-index retries cleanly once vision is back.
        const unknownCount = allNotes.filter(n => n.contentLevel === 'unknown').length;
        if (allNotes.length > 0 && unknownCount / allNotes.length >= 0.5) {
          console.warn(
            `[ingest] ${courseCode} "${fileName}": ${unknownCount}/${allNotes.length} slides unscorable (vision failure) — marking failed for retry, not skipping`,
          );
          await updateIndexingStatus({ id, status: 'failed' });
          handledBySlide = true;
        } else {
        // Keep notes with original index for stable IDs before filtering.
        const substantive = allNotes
          .map((note, i) => ({ note, i }))
          .filter(({ note }) => note.contentLevel === 'substantive');

        if (substantive.length > 0) {
          await updateIndexingStatus({ id, status: 'indexing' });

          const texts = substantive.map(({ note }) =>
            [note.topic, note.teaches, note.keyVisual].filter(Boolean).join('\n'),
          );
          // Privacy scrub (spec 2026-10-05): slide-vision text is model-generated
          // from the deck's images and can itself name a student (e.g. a
          // "presented by" slide) or carry a CUID/email. Chunk text and
          // embeddings are stored records under the spec, same as
          // extracted_text, so scrub BEFORE embedBatch and BEFORE any
          // vector-store write. A scrub failure throws here, inside the
          // existing try below, and is caught by the existing catch, which
          // falls through to the full chunk pipeline — that pipeline indexes
          // `extractedText`, the already-scrubbed stored text, so the
          // fallback is safe.
          const scrubbedSlideTexts = (
            await Promise.all(texts.map(t => scrubForRecord(t, { fileName, isSyllabus: isSyllabusFileName(fileName) })))
          ).map(r => r.text);
          const vectors = await embedBatch(scrubbedSlideTexts);

          const tenant = tenantForCourse(courseCode);
          const deckSectionId = syntheticUuid(`${id}-deck`);
          const deckSection: SectionRecord = {
            id: deckSectionId,
            materialId: id,
            title: fileName,
            index: 0,
            text: digestText || fileName,
          };
          const chunkRecords: ChunkVectorRecord[] = substantive.map(({ note: n, i }, batchIdx) => ({
            id: syntheticUuid(`${id}-slide-${i}`),
            vector: vectors[batchIdx]!,
            materialId: id,
            courseCode,
            // sectionTitle MUST be the document name — no slide ordinals in any surfaced field
            fileName,
            sectionTitle: fileName,
            sectionIndex: 0,
            parentSectionId: deckSectionId,
            text: scrubbedSlideTexts[batchIdx]!,
            contextBlurb: '',
          }));

          await input.vectorStore.deleteByMaterial(tenant, id);
          await input.vectorStore.upsertSections(tenant, [deckSection]);
          await input.vectorStore.upsert(tenant, chunkRecords);

          // Only mark handled after all three upserts succeed.
          handledBySlide = true;

          const skipped = allNotes.length - substantive.length;
          console.log(
            `[ingest] ${courseCode} "${fileName}": middle/slide tier — ${substantive.length} slide notes (${skipped} skipped)`,
          );
          await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
        }
        }
      }
    } catch (err) {
      console.error(`finalizeExtraction (middle/slide): failed for ${id} — falling through to chunk pipeline`, err);
      // handledBySlide was never set on the throwing path — no reset needed.
    }

    if (handledBySlide) return;

    // 4d. Middle tier — prose-section path.
    //     When a material isn't slide-renderable, split it into heading-based
    //     sections, generate a per-section digest, embed, and upsert.  This
    //     produces doc-level citation (sectionTitle === fileName throughout) with
    //     denser per-section summaries, avoiding the flat digest-unit of the
    //     background tier and the expensive contextualize+chunk of the full pipeline.
    //
    //     Skip conditions (fall through to full pipeline):
    //       • fewer than 2 sections meet the 200-char minimum (short / flat doc)
    //       • any error in the block (try/catch)
    let handledByProse = false;
    if (extractedText) {
      try {
        const MIN_SECTION_CHARS = 200;
        const { sections } = chunkMaterial({ fileName, text: extractedText });
        const qualifying = sections.filter(s => s.text.trim().length >= MIN_SECTION_CHARS);

        if (qualifying.length >= 2) {
          await updateIndexingStatus({ id, status: 'indexing' });

          const summaries = await mapWithConcurrency(
            qualifying,
            4,
            (s) => generateMaterialDigest({ fileName: `${fileName} — ${s.title}`, extractedText: s.text }, { noOpenAIFallback: input.noOpenAIFallback }),
          );

          const vectors = await embedBatch(summaries.map(x => x.digest));

          const tenant = tenantForCourse(courseCode);
          const docSectionId = syntheticUuid(`${id}-doc`);

          const rollupSection: SectionRecord = {
            id: docSectionId,
            materialId: id,
            title: fileName,
            index: 0,
            text: digestText || fileName,
          };

          // sectionTitle MUST be the document name — section indices live only
          // in the record `id`, never in any surfaced field.
          const chunkRecords: ChunkVectorRecord[] = qualifying.map((_, i) => ({
            id: syntheticUuid(`${id}-section-${i}`),
            vector: vectors[i]!,
            materialId: id,
            courseCode,
            fileName,
            sectionTitle: fileName,
            sectionIndex: 0,
            parentSectionId: docSectionId,
            text: summaries[i]!.digest,
            contextBlurb: '',
          }));

          await input.vectorStore!.deleteByMaterial(tenant, id);
          await input.vectorStore!.upsertSections(tenant, [rollupSection]);
          await input.vectorStore!.upsert(tenant, chunkRecords);

          // Only mark handled after all three upserts succeed.
          handledByProse = true;

          console.log(
            `[ingest] ${courseCode} "${fileName}": middle/prose tier — ${qualifying.length} section summaries`,
          );
          await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
        }
      } catch (err) {
        console.error(`finalizeExtraction (middle/prose): failed for ${id} — falling through to chunk pipeline`, err);
        // handledByProse was never set on the throwing path — no reset needed.
      }
    }

    if (handledByProse) return;
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
      }, { noOpenAIFallback: input.noOpenAIFallback })),
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
