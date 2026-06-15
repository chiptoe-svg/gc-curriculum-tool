# IMSCC (Common Cartridge) Import — Design

**Status:** Design spec (brainstormed + approved 2026-06-15). Sub-project 2 of the external-testing arc; companion to the shipped [course scope & lifecycle model](./2026-06-15-course-scope-lifecycle-design.md) and the pending OKF-bundle + external-access sub-projects.
**Goal:** Let faculty import a Canvas course from an exported **IMS Common Cartridge (`.imscc`)** file as an alternative to the Canvas-API-token import — producing the *same* `Canvas:` materials and flowing through the existing capture pipeline untouched. It's the content-in path for users with no access to our connected Canvas (external testers), and useful standalone for anyone who'd rather export than connect.

---

## 1. Why + the core insight

The Canvas-API import (`canvas-import` route + `fetchCanvasCourse`) pulls a course's content and assembles it into materials named `Canvas: Syllabus / Assignments / Pages / Module List / Discussions / Quizzes` plus `Canvas File: <name>`. An IMSCC export from Canvas contains the *same content* as a zip + `imsmanifest.xml`. **So IMSCC is "Canvas content from a file instead of the API."** The design makes that literally true: the cartridge parser emits the same `CanvasCourseData` shape `fetchCanvasCourse` returns, and both routes share one material assembler. The only genuinely new code is the parser.

The Canvas-token path is institution-bound (it authenticates against *our* Canvas), so an external tester at another university cannot use it. A cartridge upload is their content path.

---

## 2. Components

| File | New/Changed | Responsibility |
|---|---|---|
| `lib/canvas/parseImscc.ts` | **new (the bulk)** | Unzip the `.imscc`, parse `imsmanifest.xml`, walk resources, emit a `CanvasCourseData`. Includes a QTI reader for quizzes. |
| `lib/canvas/assemble-canvas-materials.ts` | **new (extracted)** | The `CanvasCourseData` → `Canvas:` text-materials assembly lifted out of the `canvas-import` route (incl. the "suppress Syllabus when the Sheet has LOs" rule). Pure-ish; returns the list of `{fileName, text, mimeType}` to upsert. Both routes call it. |
| `app/api/courses/[code]/canvas-import/route.ts` | **changed** | Now calls `assembleCanvasMaterials(...)` instead of inlining the assembly (behavior-preserving refactor). |
| `app/api/courses/[code]/imscc-import/route.ts` | **new (thin)** | Accepts the multipart `.imscc` upload (+ `slug`, + optional `sourceCode`), calls `parseImscc` → `assembleCanvasMaterials` → `insertMaterial`; runs cartridge file bytes through Docling; returns the **same response shape** as `canvas-import`. |
| `app/capture/[code]/boxes/CanvasBox.tsx` | **changed** | A "Upload Common Cartridge (.imscc)" file input in the single-mode form and each bundled per-slot form, POSTing to `imscc-import`. |
| `tests/fixtures/sample.imscc` | **new** | Small committed cartridge for tests (syllabus + 1 assignment + 1 page + 1 file + 1 classic QTI quiz). |

**New dependencies (both small, widely used):** `yauzl` (streaming / random-access zip reader — reads individual entries without inflating the whole archive; see §3a) and `fast-xml-parser` (manifest + QTI XML). HTML→text reuses the existing helper `canvas-import` already uses.

---

## 3. The parser (`parseImscc`)

**Input:** the `.imscc` bytes. **Output:** `CanvasCourseData` (`{ course: { syllabusHtml }, assignments[], modules[], pages[], discussions[], quizzes[], files[] }`).

1. **Open (don't inflate)** — the route streams the upload to a temp file (§3a); the parser opens it with `yauzl` (random access) and reads only the entries it needs.
2. **Parse `imsmanifest.xml`** (fast-xml-parser) → the `<resources>` list (each `<resource>` has `type`, `identifier`, `href`, child `<file>` paths) and the `<organizations>` tree (module structure).
3. **Map resource `type` → `CanvasCourseData` field:**
   - Canvas wiki pages (`webcontent`, under `wiki_content/`) → `pages[]`; `course_settings/syllabus.html` → `course.syllabusHtml`.
   - Assignments (Canvas `associatedcontent/imscc_xmlv1p1/learning-application-resource` with `assignment_settings`, or assignment HTML) → `assignments[]`.
   - Discussion topics (`imsdt_xmlv1p1`) → `discussions[]`.
   - Quizzes (`imsqti_xmlv1p2/imscc_xmlv1p1/assessment`) → **QTI reader** → `quizzes[]` (map QTI `<item>`s to `CanvasQuizQuestion`).
   - File resources under `web_resources/` → `files[]`, but **only** text-bearing, Docling-supported types (PDF/docx/pptx/txt/html) under the per-file cap (§3a); images/video/audio are skipped (zero capture value, and the cartridge's size hogs).
   - `<organizations>` tree → `modules[]`.
4. Lean on Canvas's `course_settings/` extension files for fidelity (canvas export), with a **generic-CC manifest fallback** for non-Canvas cartridges (extract pages + files + any QTI even without the Canvas extensions).

---

## 3a. Handling large cartridges (memory)

Real `.imscc` files run to hundreds of MB, but that bulk is bundled **media** (`web_resources/`: images, video, audio) — the parts with **no capture value**. The structured content we want (manifest, HTML pages, assignments, QTI quizzes) is tiny. So the size strategy both solves memory and loses nothing:

1. **Stream the upload to a temp file** (`os.tmpdir()`), never buffering the multi-MB request body in memory; delete the temp file in a `finally`.
2. **Random-access reads, not full inflation.** `yauzl` reads the zip's central directory, then opens a read stream for *only* the entries we ingest: `imsmanifest.xml`, the HTML/QTI text resources (all small), and the *selected* `web_resources/` files. The archive is never fully decompressed.
3. **Filter file resources before extracting:** Docling-supported text types only, each under a **per-file size cap** (config'd, e.g. 25 MB); skip everything else and log a one-line "skipped (media / over cap)" note so the omission is visible (not silent).
4. **Peak memory tracks the largest single ingested text file**, not the cartridge size.
5. **Optional local convenience (since the app runs on the Mac):** allow pointing the import at a server-side file path to skip the browser upload for the on-machine case. Remote faculty + external testers still upload (stream-to-temp is the primary path), so this is a convenience, not the mechanism.

## 4. The assembler extraction + the files split

`assembleCanvasMaterials(data: CanvasCourseData, ctx: { sheetsHasCatalog: boolean }): Array<{ fileName; text; mimeType }>` — the structured-text assembly (Syllabus/Assignments/Pages/Module List/Discussions/Quizzes), moved verbatim from the `canvas-import` route so output is identical. Both routes map its result through `insertMaterial` (upsert by `fileName`, scoped by `sourceCode`).

**Files differ by source and stay per-route:** the API path downloads files from Canvas; the cartridge has the bytes in the zip. So each route takes its file blobs, runs them through the existing `material-extractor` (Docling), and inserts `Canvas File: <name>`. The assembler is source-agnostic; only file *acquisition* differs.

---

## 5. Route, UI, dedup, auth

- **Route** `POST /api/courses/[code]/imscc-import`: multipart body (`file` = the `.imscc`, `slug`, optional `sourceCode`). Enforces a size cap (config'd; friendly over-limit message). Stamps provenance (`canvasCourseName` = "Common Cartridge: <manifest title>", `canvasImportedAt`). Returns `{ imported, inserted, updated, error }` — identical to `canvas-import` so `CanvasBox` handles both paths with the same messaging + auto-scan.
- **UI:** in `CanvasBox`, a file-input "Upload Common Cartridge (.imscc)" beside the URL+token import, in both single-mode and each bundled per-slot form; reuses the existing import-result message + auto-scan-after-import. A one-line hint: "Export from Canvas: Settings → Export Course Content."
- **Dedup:** materials upsert by `fileName`, so a cartridge import and an API import **merge/refresh by name** — same behavior and same `Canvas File:` stale-leftover caveat as the reimport URL-switch ([STATE.md Deferred/debt](../../STATE.md)).
- **Auth:** faculty Basic Auth, same as `canvas-import`. (The external-access plan will expose this exact route to a scoped sandbox session.)

---

## 6. Error handling

- Not a zip / missing `imsmanifest.xml` → 400 with a clear message.
- A single quiz's QTI failing to parse → skip that quiz, log, continue (never fail the whole import).
- **New Quizzes** (Canvas's newer engine) often don't export to standard QTI in the cartridge → captured-what's-there; documented limitation, not a bug.
- Oversized upload → 413-style friendly message.
- Unsupported file types in `web_resources/` → handled exactly as uploads are (skipped/labelled by `material-extractor`).

---

## 7. Testing

- **Fixture** `tests/fixtures/sample.imscc` (syllabus + 1 assignment + 1 page + 1 supported file (PDF) + 1 classic QTI quiz with ≥2 questions + 1 image in `web_resources/` to exercise the media-skip).
- `parseImscc(fixture)` → asserts the `CanvasCourseData` shape (syllabus text non-empty, 1 assignment, 1 page, 1 quiz with its questions, the PDF in `files[]`) **and that the image is skipped** (not in `files[]`) — the size/type filter.
- `assembleCanvasMaterials(data)` → asserts the produced material `fileName`s (`Canvas: Syllabus/Assignments/Pages/Quizzes`, etc.) and that the Sheets-has-LOs suppression still fires.
- Route test (mock DB, mirroring `canvas-import` route tests) → POST the fixture, assert the expected `insertMaterial` calls.
- **Regression:** the existing `canvas-import` tests must stay green after the assembler extraction (behavior-preserving).

---

## 8. Out of scope / deferred

- New-Quizzes high-fidelity import (blocked by Canvas's cartridge export, not us).
- LTI links, calendar events, rubrics-as-separate-materials (rubrics already ride along in assignment text via the API path; cartridge rubric parsing is deferred).
- The external-tester scoped-session access to this route (the external-access sub-project).
- A "replace, don't merge" option for re-import (shared deferred item with the Canvas reimport URL-switch).

---

## 9. Relationship to the arc

Sub-project 2 of the external-testing arc. **(1) scope & lifecycle model — shipped.** **(2) this — IMSCC import** (content in). **(3) OKF bundle export** (content out + durability). **(4) external-access scoped link** (ties them together; external testing becomes usable here). IMSCC also stands alone: any faculty member can capture from a cartridge without connecting Canvas.
