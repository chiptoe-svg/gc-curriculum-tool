# Handoff: multimodal embeddings at ingestion (course content + student projects)

**Date:** 2026-10-12
**From:** curriculum_developer, owner decision: "This should be a rag-core project"
**To:** rag-core
**Status:** proposal for a spike. Nothing is built. Not urgent. Nothing in curriculum_developer depends on it yet.

## The idea

The proposal is to embed course content and student projects at ingestion with a local multimodal embedding model. That covers text, images and video frames, in one vector space, without first writing captions. The candidate the owner raised is Google DeepMind's **EmbeddingGemma 2**:

- Open weights, about 740M parameters in total.
- A modular set of encoders: 270M text, 170M vision, 300M audio.
- 768 dimensions, with Matryoshka truncation to 512, 256 or 128.
- An 8K-token context, which fits roughly 29 images, 58 video frames or about 5.5 minutes of audio.
- About 567MB of RAM for the full multimodal model, quantized.

**These figures are unverified.** They come from a secondary article (Medium) that summarizes Google's announcement of 6 Oct 2026. Check them against the actual model card and license before relying on them.

## Why it matters to curriculum_developer

1. **Do-level evidence is mostly visual in GC.** The framework's evidence rule says a Do score above 0 needs graded student work. GC student work is mostly layouts, packaging, color-corrected proofs and brand systems. Today that work is not ingested at all. Indexed projects would let capture show "here are 12 graded packaging projects" in place of "the syllabus says packaging".
2. **Course materials lose their images today.** Docling and the extractor turn materials into text. Image-only PDFs go to a vision model that produces text. Embeddings are text-only (campus `qwen3-embedding-4b`, 2560-dim). Slides, die-line diagrams, press-sheet photos and demo videos only become searchable through that text.
3. **A program-level view of evidenced practice.** For example: "where do students actually produce brand-system work?", answered from the projects students made rather than from syllabus claims.
4. **Privacy.** A local model means student work is never sent to any outside service, campus or vendor, just to be indexed. Today's FERPA safeguard works by holding such content back from external digest and embedding calls (`runV2Pipeline`). Local embedding would let student work be indexed without that hold-back.

## Constraints from curriculum_developer's side

- **Similarity is not attainment.** Retrieval only surfaces *candidate* evidence. The instructor or the grade record decides whether a piece of work was graded at a given level. No score may come from vector similarity alone.
- **FERPA and consent come before any collection. This is a gate, not a detail.** Running the model locally settles where the data goes. It does not settle whether identifiable student work may be retained and analyzed. Possible bases include:
  - course-level consent;
  - de-identified samples;
  - work faculty already keep for accreditation.

  If the data feeds the graduate-outcome study, it likely needs IRB review. The owner decides the basis before any student work is ingested.
- **Upstream first.** Before designing, check the installed or available artifact:
  - the model card;
  - the license terms;
  - whether it runs on the Mac (Apple silicon) or on the Spark;
  - which runtime supports it.

  Also check whether rag-core's existing extractor or embedding stack already has a multimodal path.
- **Benchmark before switching.** For text, a smaller general model may retrieve worse than the current 4B Qwen. The likely shape is Qwen for text, plus the multimodal model for images and video. Decide that by measurement.

## Suggested spike (about a day; no change to anything live)

1. Verify the model card and license, then run the model locally.
2. Index the materials of 2–3 GC courses, plus a handful of student projects that instructors agree to share or that have been anonymized.
3. Write about 10 real queries, for example:
   - "where do students do structural packaging?"
   - "show color-correction work"
   - "brand-system templates"

   Have the owner or an instructor judge whether each result is right.
4. Compare the results with what text-only Qwen retrieves for the same queries.
5. Report: retrieval quality per modality, how runtime and memory fit on the Mac or Spark, and a recommendation.

## Contact

Use the `curriculum` session (curriculum_developer) for anything about the evidence rule or how capture would consume results. The owner decides the consent basis.
