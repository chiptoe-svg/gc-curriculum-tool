# Unified slide vision: one adaptive describe-and-transcribe pass — Design

**Date:** 2026-08-02
**Status:** Design — pending operator OK before the plan. *(Rev. 2026-08-02: broadened to cover both
contamination flavours — see §1a.)*
**Origin:** rag-core contamination report (2026-08-02) + operator reframe. The image-PDF extraction
path persists **VLM failure narration** ("the image is completely blank, no content to transcribe")
and decoder repetition as `extracted_text`, because it routes design slides into a **verbatim-
transcription** prompt (`transcribeDocument`: *"Output only the verbatim text… No description"*).
On an image-only/near-blank slide the model, obeying that prompt, narrates the absence. Root cause is
a **prompt mismatch**, not a model limitation — a describe-or-both prompt never produces that.

## 1a. Two flavours, two paths (both must be covered)

The report measured **two distinct contaminations in two distinct code paths**:

- **Flavour B — failure narration + decoder repetition** (`method=vision`, GC 3620 `_Wk4-Vectors`,
  `Wk2-DesignThinking`, `Wk8-DigitalDesign`, dated 2026-07-28). The `transcribeDocument` verbatim
  path. **Fixed at the source** by the reframe below (§1–§3): the adaptive prompt never asks for
  verbatim-only, so the model never narrates an absence.
- **Flavour A — leaked reasoning preambles** (`method=text`, GC 1010's 8 PDFs at 58% of sections,
  GC 4440/4060/3460, dated 06-01–06-23). This is **docling's `do_picture_description` VLM**
  (gemma via `DOCLING_VLM`) emitting *"The user wants a description… 1. Identify the main subject…"*
  into `md_content`, stored verbatim. **The reframe does not touch this path.** It is **still live**
  (`DOCLING_VLM_ENABLED=true`, `do_picture_description=true`), and the picture-description prompt
  already says *"Reply with only the description — no preamble"* yet gemma ignores it — so the source
  prompt cannot reliably suppress it.

Both flavours share one exit: every `extracted_text` write goes through `updateExtractionResult`,
called from a single site at the top of `finalizeExtraction`. So the cross-cutting fix for **A** (and
belt-and-suspenders for **B**) is a **persistence-boundary scrub** applied there — see §3.5. Flavour A
requires **span-scrubbing** (strip the reasoning-preamble span from within otherwise-good markdown),
not whole-field rejection, because the contaminated GC 1010 files also carry real content.

## 1. The reframe

The model can transcribe *and* describe in one pass. So we stop splitting slide handling by
content type and use **one adaptive prompt** for all image-based materials:

> *"Transcribe any visible text verbatim; briefly describe the dominant imagery; a slide may have
> either or both. If the page is genuinely empty, output nothing — never narrate the absence."*

"Transcribe" (not "summarize") preserves the competency-bearing words the KUD audit needs; the
describe half handles design/visual slides; the both-case handles the mixed reality. The
failure-narration failure mode **structurally disappears** — there is always something to say, and
truly-empty pages emit nothing rather than an excuse.

## 2. Architecture (what routes where)

- **Text-heavy / born-digital PDFs** (`charsPerPage ≥ 100`) → **docling text/OCR, verbatim, no
  vision** — unchanged. You do not "describe" a syllabus; you want the exact words, cheaply, off-GPU.
- **Image-based PDFs** (`charsPerPage < 100`, deck *or* scan) → **one adaptive vision pass**
  (`describeSlides`, extended), which produces **both** outputs from a single render+VLM pass:
  - `extracted_text` (the digest/KUD-audit source) = per-page concatenation of the verbatim `text`
    (+ a one-line imagery note when present).
  - retrieval **chunks** = the substantive `SlideNote`s, exactly as today.

`transcribeDocument`'s verbatim-only prompt is **removed from this path**. (It stays defined for any
hardscan-lane caller, but the adaptive prompt subsumes the scanned-text case too — "transcribe
visible text" *is* verbatim transcription when there is no imagery.)

## 3. Changes

1. **`SlideNote` gains `text: string`** (verbatim visible text, `""` if none) alongside
   `topic/teaches/keyVisual/contentLevel`. `keyVisual` stays the imagery description.
2. **`describeSlides` prompt → adaptive** (transcribe `text` + describe `keyVisual`; empty page →
   empty fields, never a narration). `SAFE_DEFAULT`/`contentLevel:'unknown'` reliability handling
   (from the 2026-07-28 fix) is retained.
3. **`extract-text.ts` image-based branch stops calling `transcribeDocument`.** It runs the adaptive
   `describeSlides` pass **once**, derives `extracted_text` from the notes, and returns
   `{ method:'vision', text, slideNotes }`.
4. **Thread the notes to `finalizeExtraction`** so the middle-tier path **reuses** them instead of
   re-rendering + re-describing (removes the double vision pass). If notes are absent (non-vision
   path), finalize behaves as today.
5. **`sanitizeExtractedText` — persistence-boundary scrub (load-bearing for Flavour A).** A single
   function applied to `input.extractedText` at the **top of `finalizeExtraction`** (before the
   `updateExtractionResult` write), so it covers **every** source path — docling-text *and* vision.
   It **span-scrubs**, not whole-field-drops:
   - **Reasoning preambles (Flavour A):** strip spans matching the leaked-thinking signature
     (`/(?:^|\n)\s*(?:the user wants a description|the user is asking|i (?:need|should|will) (?:to )?describe|let me describe|here is a description|1\.\s+identify the main subject)/i`)
     up to the next docling structural marker (`--- page N ---`, `<!-- image -->`, blank line, or
     end) — removing the model's self-talk while preserving surrounding real markdown.
   - **Failure narration (Flavour B):** drop whole sentences matching
     `/the (?:provided )?image is (?:completely )?blank|no (?:visible )?content to transcribe|does not contain any (?:textual )?content/i`.
   - **Degenerate repetition:** collapse/drop runs of a short character cycle repeated ≥N times
     (the `bbbmtttllwwccccc…` decoder pathology).
   - If scrubbing empties the field (the whole extraction was contamination), return `''` and let the
     existing `extractionStatus !== 'ok' || !extractedText` guard mark it non-ok rather than storing junk.
   The vision reframe (§1–§3) still fixes B **at the source**; this scrub is the only fix for A and a
   second line for B.
6. **`raw_cleared` ordering:** never purge the raw file until `extracted_text` passes the gate
   (turns a transient bug back into a recoverable one). *(May land as a separate small change.)*

## 4. Fidelity + scope notes

- For a **scanned text document**, the adaptive pass transcribes the text (imagery note empty) — same
  fidelity as the old verbatim path, minus the failure-narration risk.
- The `topic/teaches/contentLevel` fields are slide-shaped; on non-slide image PDFs they are less
  meaningful but harmless — the `text` field is what feeds `extracted_text` either way.
- **Not touched:** docling text path; the geometry/`isImageHeavyPdf` detection (still decides
  vision-vs-docling); the render cap; the content-gate reliability rule.

## 5. Testing

- `describeSlides`: adaptive prompt returns `text` + `keyVisual`; an empty page yields empty fields,
  **not** a narration; existing SAFE_DEFAULT/`unknown` tests hold.
- `sanitizeExtractedText`: (a) a docling md with a `"the user wants a description…"` preamble between
  two `--- page N ---` markers → preamble span removed, real markdown on both sides intact (Flavour A);
  (b) failure-narration sentence → dropped, surrounding text kept (Flavour B); (c) `bbbmttt…` repetition
  run → dropped; (d) all-contamination input → returns `''`; (e) clean real text → returned byte-identical.
- `extract-text.ts`: image-based path returns `method:'vision'` with derived `text` + `slideNotes`,
  and **does not** call `transcribeDocument`.
- `finalize-extraction.ts`: given threaded `slideNotes`, does **not** re-render/re-describe; chunks
  match; missing-notes path unchanged. Full capture suite green.

## 6. Remediation (after the fix ships)

- **Scope corpus-wide first** — run the contamination query (both flavours) over **all tiers**, not
  just the 27 middle-tier rows rag-core surveyed, to size the true blast radius before remediating.
- **Flavour B, recoverable** (raw file present) — re-extract the decks under the new path (GC 3620
  `_Wk4-Vectors`, `Wk2-DesignThinking`, `Wk8-DigitalDesign`, + any surfaced), re-score, verify clean.
- **Flavour A, recoverable** (raw file present, `method=text` docling) — the `sanitizeExtractedText`
  scrub can be run **in place** over the stored `extracted_text` (no re-extraction needed, since the
  real markdown is already there under the preamble spans); re-digest/re-index the scrubbed rows.
  Prefer this over re-extraction where the raw is `raw_cleared` but the text is mostly real.
- **Permanent-loss set:** GC 1010's `raw_cleared` materials whose text is *majority* contamination
  (94%/92%/72%… — scrubbing leaves too little) cannot be recovered — produce the faculty **re-upload**
  list (rag-core's priority order), the only recovery path. Rows where the scrub leaves substantive
  real content move to the Flavour-A in-place bucket instead.
- Optionally accept rag-core's per-material contaminated-section-index lists to target + verify.

## 7. Phasing

1. `sanitizeExtractedText` (both flavours) + wire it into `finalizeExtraction` (+ tests). This alone
   stops **both** flavours from being persisted going forward — ship it first, independently.
2. `SlideNote.text` + adaptive prompt (Flavour-B source fix) (+ tests).
3. Rewire `extract-text.ts` (drop `transcribeDocument` on the slide path; derive `extracted_text`)
   + thread notes to `finalizeExtraction` (single pass).
4. Verify end-to-end on a staged deck; deploy; scope corpus-wide; remediate (in-place scrub for
   recoverable Flavour A, re-extract for Flavour B); emit the faculty re-upload list.
