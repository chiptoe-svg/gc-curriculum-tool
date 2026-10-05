# Privacy scrub — design

**Date:** 2026-10-05. **Status:** the owner approved the approach in conversation ("do your scrub on both the wiki and before it could get into the database"). This spec awaits owner review.

## Why

Clemson's OpenAI education contract permits confidential data to go to OpenAI (owner, 2026-10-05), so materials no longer need to be held back from the AI. Records built from those materials are a different matter. Course profiles, coverage evidence quotes and especially the public `/wiki` pages can quote material text. Student names, emails and ID numbers must never appear in those records.

Today the only protection is the FERPA hold (`lib/capture/finalize-extraction.ts`). It keeps whole files away from the AI, but the raw text of held files is still stored in `course_materials.extracted_text`. The hold is replaced by a scrub that runs before text is stored, plus a second scrub on wiki pages.

## Rule

Student-identifying data never enters a stored record. Records are material text, chunks and embeddings, snapshots, and wiki pages. Student-identifying data means student names, student emails, student ID numbers (CUIDs) and grades tied to a named person.

Kept, because it is public or not about students:
- instructor and TA names and contact details, but only in syllabi;
- authors, companies and public figures.

## Layer 1: scrub before the database

- **New module `lib/privacy/scrub.ts`:**

  ```ts
  scrubForRecord(text: string, opts: { fileName: string; isSyllabus: boolean }): Promise<{ text: string; redactions: Record<string, number> }>
  ```

  1. **Deterministic, always.** Every CUID becomes `[student ID]`. Every email address becomes `[email]`, except in syllabi.
  2. **AI name pass, only when needed.** It runs when `detectFerpaRisk` (existing, `lib/capture/ferpa-detect.ts`) reports `submitted-by`, `posted-by`, `roster-names` or `gradebook`, or the file is `Canvas: Discussions`.
     - One call to a new AI function, `privacy-scrub`, on the light tier.
     - The prompt says: replace every student's name with `[student]`; keep instructors, TAs, authors, companies and public figures; change nothing else.
     - Long text is processed in chunks.
     - **Guard:** the output must keep the input's length within a tolerance, and its non-name text must be unchanged (compared token-wise). If the guard fails, the material is stored as `failed` with the reason. Raw text is never stored as a fallback.
- **Single choke point.** `updateExtractionResult` and `insertMaterial` in `lib/db/course-materials-queries.ts` are the only writers of `extracted_text`. Both call `scrubForRecord` before the write, so no import path (Canvas, IMSCC, uploads, linked docs) can skip it.
  - A test lists every caller and asserts that no other code writes the column.
- **Redaction counts** are stored in a new jsonb column `course_materials.redactions`, so the capture page can say "3 student names removed".
- **The FERPA hold is retired.** `runV2Pipeline` no longer sets files aside for FERPA risk.
  - The detector still runs. Its job is now to choose files for the AI name pass, and `ferpa_risk` is kept for display.
  - The policy rule that sets aside `Canvas: Discussions` is removed too, since discussions are scrubbed instead.
- **The original file blob is untouched**, so faculty can still open it. Only the stored text that feeds the tool is scrubbed.

## Layer 2: scrub before a wiki page is published

- **Scrub every page in `writeAndPush`** (`lib/wiki/git-ops.ts`), the single writer of wiki files, before it writes. Pages run through `scrubForRecord` with `isSyllabus: false`, so all emails are removed from public pages. The AI name pass runs only when the detector flags the page.
- **Then a hard check.** If any email or CUID pattern remains, the page is not written. The failure is logged and surfaced like other wiki-update failures.
- **Scrub the stored copy too.** Wiki pages are also stored in the database (wiki raw layer and snapshot-derived pages), and those writes go through the same scrub.

## Existing data (one-time backfill)

`scripts/privacy/backfill-scrub.ts`, with `--dry-run`:

1. Scrubs `extracted_text` and `digest` on every active material. That includes the 22 currently held, whose raw text is stored today.
2. Re-indexes any material whose text changed, so chunks and embeddings are rebuilt from scrubbed text.
3. Includes the 22 held materials (`ignored=false`) once scrubbed. The FERPA hold is gone, per the owner.
4. Scans the published wiki for email or CUID patterns and reports any it finds, then republishes those pages through the scrub.

The backfill reports counts per course. Nothing is published before the owner has seen the dry-run.

## Limits, stated plainly

- **The AI name pass is strong but not perfect,** and the hard check after it catches only emails and IDs. A student name in an unusual place could still reach a page.
- **Interview transcripts are not scrubbed.** Faculty may mention a student by name in the capture interview. That is out of scope here and logged in Deferred/debt.

## Testing

Each regression test gets a red proof.
- **Deterministic rules:**
  - CUIDs;
  - emails in a syllabus versus a non-syllabus file;
  - text with nothing to remove comes back unchanged.
- **AI pass** (provider faked):
  - it is called only for flagged files;
  - the guard rejects an output that changed non-name text;
  - when the guard fails, nothing is stored.
- **Choke point:** both writers scrub, and no other writer exists.
- **Wiki:** a page containing an email is scrubbed, and a page that still fails the check is not written.
- **Live, after the backfill:**
  - the 22 materials are included, with counts reported;
  - a grep of the published wiki finds no email or CUID patterns.

## Tracking

STATE.md is updated in the same commits. The changes:
- new AI function `privacy-scrub`;
- new column `redactions` (migration);
- FERPA hold retired;
- wiki publish check;
- backfill;
- transcripts noted as deferred.
