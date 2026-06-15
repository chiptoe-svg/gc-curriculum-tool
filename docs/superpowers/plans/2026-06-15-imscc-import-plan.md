# IMSCC (Common Cartridge) Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a Canvas course from an exported `.imscc` (Common Cartridge) file as an alternative to the Canvas-API-token import, producing the same `Canvas:` materials and flowing through the existing capture pipeline.

**Architecture:** A new memory-safe parser (`parseImscc`) reads only the entries it needs from the cartridge zip and emits the same `CanvasCourseData` shape `fetchCanvasCourse` returns, plus a filtered `files[]`. A shared `assembleCanvasMaterials` (extracted from the `canvas-import` route) turns that into `Canvas:` text materials for both routes; cartridge file bytes go through the existing Docling extractor. A thin `imscc-import` route + a Canvas-box upload affordance complete it.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle/Postgres, Vitest. New deps: `yauzl` (random-access zip), `fast-xml-parser` (manifest + QTI).

**Spec:** [`2026-06-15-imscc-import-design.md`](../specs/2026-06-15-imscc-import-design.md)

---

### Task 1: Add dependencies

**Files:** `package.json`

- [ ] **Step 1: Install.**

Run: `pnpm add yauzl fast-xml-parser && pnpm add -D @types/yauzl`
Expected: both land in `dependencies`, `@types/yauzl` in `devDependencies`.

- [ ] **Step 2: Type-check.**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add yauzl + fast-xml-parser for IMSCC import"
```

---

### Task 2: Build the fixture cartridge

**Files:**
- Create: `tests/fixtures/imscc-src/` (unzipped cartridge contents — committed as the source of truth)
- Create: `tests/fixtures/sample.imscc` (the zipped cartridge, committed binary)

A real `.imscc` is a zip with `imsmanifest.xml` at the root. Build a minimal Canvas-flavored one by hand so the parser can be TDD'd against it.

- [ ] **Step 1: Create the source tree.** Make these files under `tests/fixtures/imscc-src/`:

`imsmanifest.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="g-test" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">
  <organizations>
    <organization>
      <item identifier="root">
        <item identifier="m1"><title>Module One</title>
          <item identifier="i_page" identifierref="r_page"><title>Welcome</title></item>
        </item>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r_syllabus" type="webcontent" href="course_settings/syllabus.html">
      <file href="course_settings/syllabus.html"/>
    </resource>
    <resource identifier="r_page" type="webcontent" href="wiki_content/welcome.html">
      <file href="wiki_content/welcome.html"/>
    </resource>
    <resource identifier="r_asg" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="assignment1/assignment.html">
      <file href="assignment1/assignment.html"/>
    </resource>
    <resource identifier="r_quiz" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment" href="quiz1/assessment.xml">
      <file href="quiz1/assessment.xml"/>
    </resource>
    <resource identifier="r_pdf" type="webcontent" href="web_resources/reading.pdf">
      <file href="web_resources/reading.pdf"/>
    </resource>
    <resource identifier="r_img" type="webcontent" href="web_resources/diagram.png">
      <file href="web_resources/diagram.png"/>
    </resource>
  </resources>
</manifest>
```
`course_settings/syllabus.html`: `<html><body><h1>Syllabus</h1><p>Course goals and policies.</p></body></html>`
`wiki_content/welcome.html`: `<html><body><h2>Welcome</h2><p>Read chapter 1.</p></body></html>`
`assignment1/assignment.html`: `<html><body><h1>Project 1</h1><p>Build a thing. Worth 100 points.</p></body></html>`
`quiz1/assessment.xml` (minimal QTI 1.2, two items):
```xml
<?xml version="1.0"?>
<questestinterop>
  <assessment title="Quiz 1">
    <section>
      <item title="Q1"><presentation><material><mattext texttype="text/html">What is color management?</mattext></material>
        <response_lid><render_choice>
          <response_label ident="a"><material><mattext>ICC profiles</mattext></material></response_label>
          <response_label ident="b"><material><mattext>A printer brand</mattext></material></response_label>
        </render_choice></response_lid></presentation>
        <resprocessing><respcondition><conditionvar><varequal respident="r">a</varequal></conditionvar><setvar varname="SCORE" action="Set">1</setvar></respcondition></resprocessing>
      </item>
      <item title="Q2"><presentation><material><mattext>Name one rendering intent.</mattext></material></presentation></item>
    </section>
  </assessment>
</questestinterop>
```
`web_resources/reading.pdf`: any tiny valid PDF (e.g. copy an existing small test PDF from the repo, or `printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF' > web_resources/reading.pdf`).
`web_resources/diagram.png`: any tiny PNG (a 1×1 px file is fine — it only needs to be present to prove it's skipped).

- [ ] **Step 2: Zip it.**

Run: `cd tests/fixtures/imscc-src && zip -r -X ../sample.imscc . && cd -`
Expected: `tests/fixtures/sample.imscc` exists; `unzip -l tests/fixtures/sample.imscc` lists `imsmanifest.xml` at the root.

- [ ] **Step 3: Commit.**

```bash
git add tests/fixtures/imscc-src tests/fixtures/sample.imscc
git commit -m "test(fixtures): minimal IMSCC cartridge (syllabus, page, assignment, QTI quiz, pdf, image)"
```

---

### Task 3: Extract `assembleCanvasMaterials` (behavior-preserving DRY refactor)

**Files:**
- Create: `lib/canvas/assemble-canvas-materials.ts`
- Modify: `app/api/courses/[code]/canvas-import/route.ts` (replace the inlined assembly)
- Test: `tests/lib/canvas/assemble-canvas-materials.test.ts`

- [ ] **Step 1: Create the module.** Move the assembly **verbatim** out of the route. Create `lib/canvas/assemble-canvas-materials.ts`:

```ts
import type { CanvasCourseData } from '@/lib/canvas/fetchCanvasCourse';
import { htmlToText } from '@/lib/canvas/htmlToText'; // same helper the route imports today — match its import path

export interface AssembledMaterial { fileName: string; text: string; mimeType: string; }

/**
 * Turn fetched/parsed Canvas content into the `Canvas:` text materials. Shared by
 * the Canvas-API import and the IMSCC import so both produce identical materials.
 * `sheetsHasCatalog` suppresses `Canvas: Syllabus` when the Google-Sheet catalog
 * already supplies learning objectives.
 */
export function assembleCanvasMaterials(
  data: CanvasCourseData,
  opts: { sheetsHasCatalog: boolean },
): AssembledMaterial[] {
  const { sheetsHasCatalog } = opts;
  const toInsert: AssembledMaterial[] = [];
  // ⤵ paste lines 142–267 of canvas-import/route.ts here VERBATIM — the syllabus,
  //   assignments, modules, pages, discussions, and quizzes blocks that push onto
  //   `toInsert`, replacing the route-local `course.learningObjectives` check with
  //   the `sheetsHasCatalog` param (already computed there as that same expression).
  return toInsert;
}
```
(Confirm the route's `htmlToText` import path and reuse it; do not reimplement it.)

- [ ] **Step 2: Rewire the route.** In `canvas-import/route.ts`, delete the moved block (the `const toInsert … ` through the end of the quizzes block) and replace with:
```ts
const sheetsHasCatalog = (course.learningObjectives ?? []).length > 0;
const toInsert = assembleCanvasMaterials(data, { sheetsHasCatalog });
```
Leave the downstream `insertMaterial`/file-handling loop unchanged.

- [ ] **Step 3: Unit test.** `tests/lib/canvas/assemble-canvas-materials.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assembleCanvasMaterials } from '@/lib/canvas/assemble-canvas-materials';
const EMPTY = { course: { id: '1', name: 'C', syllabusHtml: '' }, assignments: [], modules: [], pages: [], discussions: [], quizzes: [] };
describe('assembleCanvasMaterials', () => {
  it('emits Canvas: Syllabus when syllabus present and the Sheet has no LOs', () => {
    const out = assembleCanvasMaterials({ ...EMPTY, course: { id: '1', name: 'C', syllabusHtml: '<p>Hi</p>' } }, { sheetsHasCatalog: false });
    expect(out.map(m => m.fileName)).toContain('Canvas: Syllabus');
  });
  it('suppresses Canvas: Syllabus when the Sheet already has LOs', () => {
    const out = assembleCanvasMaterials({ ...EMPTY, course: { id: '1', name: 'C', syllabusHtml: '<p>Hi</p>' } }, { sheetsHasCatalog: true });
    expect(out.map(m => m.fileName)).not.toContain('Canvas: Syllabus');
  });
});
```

- [ ] **Step 4: Verify + commit.**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run tests/lib/canvas/assemble-canvas-materials.test.ts && pnpm exec vitest run canvas-import`
Expected: clean + PASS, and the **existing canvas-import route tests stay green** (behavior preserved).
```bash
git add lib/canvas/assemble-canvas-materials.ts "app/api/courses/[code]/canvas-import/route.ts" tests/lib/canvas/assemble-canvas-materials.test.ts
git commit -m "refactor(canvas): extract assembleCanvasMaterials (shared by canvas-import + imscc-import)"
```

---

### Task 4: QTI reader (`parseQti`)

**Files:**
- Create: `lib/canvas/parseQti.ts`
- Test: `tests/lib/canvas/parseQti.test.ts`

- [ ] **Step 1: Write the failing test** (against the fixture's QTI string, read from disk):
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseQtiAssessment } from '@/lib/canvas/parseQti';

const xml = readFileSync('tests/fixtures/imscc-src/quiz1/assessment.xml', 'utf8');
describe('parseQtiAssessment', () => {
  it('maps a QTI 1.2 assessment to a CanvasQuiz', () => {
    const quiz = parseQtiAssessment(xml, 'r_quiz');
    expect(quiz.title).toBe('Quiz 1');
    expect(quiz.source).toBe('classic');
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.questions[0].textHtml).toContain('color management');
    expect(quiz.questions[0].answers.map(a => a.text)).toContain('ICC profiles');
    expect(quiz.questions[0].answers.find(a => a.text === 'ICC profiles')?.correct).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fails** (module missing).

- [ ] **Step 3: Implement.** `lib/canvas/parseQti.ts` — use `fast-xml-parser` (`XMLParser` with `{ ignoreAttributes: false, attributeNamePrefix: '@_' }`), walk `questestinterop.assessment.section.item[]`, map each `<item>` to a `CanvasQuizQuestion`: `name` from `@_title`; `textHtml` from `presentation.material.mattext['#text']`; `answers` from `response_lid.render_choice.response_label[]` (`{ text: mattext, correct: ident matches the `<varequal>` in resprocessing }`); `questionType` best-effort (`'multiple_choice_question'` when `response_lid` present, else `'essay_question'`). Return `CanvasQuiz` (`source: 'classic'`, `published: true`, `pointsPossible: null`, `questionCount: questions.length`). Normalize single-vs-array (`fast-xml-parser` returns a bare object when there's one `<item>`; coerce with `Array.isArray(x) ? x : [x]`). Import `CanvasQuiz`/`CanvasQuizQuestion` types from `@/lib/canvas/fetchCanvasCourse`.

- [ ] **Step 4: Run → PASS.** `pnpm exec vitest run tests/lib/canvas/parseQti.test.ts`

- [ ] **Step 5: Commit.**
```bash
git add lib/canvas/parseQti.ts tests/lib/canvas/parseQti.test.ts
git commit -m "feat(canvas): QTI 1.2 assessment reader → CanvasQuiz"
```

---

### Task 5: The cartridge parser (`parseImscc`)

**Files:**
- Create: `lib/canvas/parseImscc.ts`
- Test: `tests/lib/canvas/parseImscc.test.ts`

`parseImscc(zipPath: string, opts?: { maxFileBytes?: number }): Promise<{ data: CanvasCourseData; files: ImsccFile[] }>` where `ImsccFile = { name: string; bytes: Buffer; mimeType: string }`. Memory-safe: open with `yauzl` (random access), read only needed entries.

- [ ] **Step 1: Write the failing test** (against `tests/fixtures/sample.imscc`):
```ts
import { describe, it, expect } from 'vitest';
import { parseImscc } from '@/lib/canvas/parseImscc';

describe('parseImscc', () => {
  it('parses the fixture cartridge into CanvasCourseData + filtered files', async () => {
    const { data, files } = await parseImscc('tests/fixtures/sample.imscc');
    expect(data.course.syllabusHtml).toContain('Course goals');
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].title).toBe('Welcome');
    expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0].name).toBe('Project 1');
    expect(data.quizzes).toHaveLength(1);
    expect(data.quizzes[0].questions).toHaveLength(2);
    expect(data.modules).toHaveLength(1);
    // size/type filter: the PDF is kept, the PNG is skipped
    expect(files.map(f => f.name)).toContain('reading.pdf');
    expect(files.some(f => f.name.endsWith('.png'))).toBe(false);
  });
  it('rejects a non-cartridge zip (no imsmanifest.xml)', async () => {
    await expect(parseImscc('tests/fixtures/imscc-src/quiz1/assessment.xml')).rejects.toThrow(/manifest/i);
  });
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** (iterate against the fixture until the test passes):
  - Open the zip with `yauzl.open(zipPath, { lazyEntries: true })`; read the central directory; build a map of `entryName → entry`. **Do not** read entry data yet.
  - Read + parse `imsmanifest.xml` (error `"No imsmanifest.xml — not a Common Cartridge"` if absent). Parse with `fast-xml-parser`. Collect `<resource>`s (coerce single→array) and the `<organizations>` item tree.
  - For each resource, read **only that resource's** entry bytes on demand (open a read stream, collect to buffer) and map by `type`/`href`:
    - `course_settings/syllabus.html` → `data.course.syllabusHtml`.
    - `wiki_content/*.html` (webcontent not under web_resources, not the syllabus) → `data.pages[]` (`title` from `<title>` in the HTML or the manifest item; `bodyHtml` = file contents; `published: true`).
    - `…learning-application-resource` / assignment HTML → `data.assignments[]` (`name` from `<h1>`/title; `descriptionHtml` = contents; `rubric: []`, `rubricTitle: null`, `pointsPossible: null`, `published: true`).
    - `imsdt_*` → `data.discussions[]`.
    - `imsqti_*` → `parseQtiAssessment(xml, identifier)` → `data.quizzes[]`.
    - `web_resources/*` → candidate `files[]`, **filtered**: keep only Docling-supported text types (by extension → MIME: `.pdf`, `.docx`, `.pptx`, `.txt`, `.html`/`.htm`) **and** `entry.uncompressedSize <= (opts.maxFileBytes ?? 25*1024*1024)`; skip others and `console.log` a one-line "skipped (media/over-cap): <name>".
  - Build `data.modules[]` by walking the `<organizations>` item tree (module = top-level item with children; items = leaf titles).
  - Always close the zip in a `finally`.
  - `course.id`/`name`: id = manifest `@_identifier`; name = manifest `<organization>`/`metadata` title or fallback to the file stem.

- [ ] **Step 4: Run → PASS** (both tests). Iterate the mapping until green.

- [ ] **Step 5: Commit.**
```bash
git add lib/canvas/parseImscc.ts tests/lib/canvas/parseImscc.test.ts
git commit -m "feat(canvas): parseImscc — memory-safe cartridge parser → CanvasCourseData + filtered files"
```

---

### Task 6: The `imscc-import` route

**Files:**
- Create: `app/api/courses/[code]/imscc-import/route.ts`
- Test: `app/api/courses/[code]/imscc-import/__tests__/route.test.ts`

Mirror `canvas-import/route.ts`'s response shape + insert loop; swap the Canvas fetch for the cartridge parse.

- [ ] **Step 1: Implement the route.**
  - `POST`: read `multipart/form-data` via `await req.formData()`; pull `file` (a `File`), `slug`, optional `sourceCode`. Enforce a total-size cap (e.g. reject `file.size > 500*1024*1024` with a friendly 413 message).
  - Stream the upload to a temp file: `const tmp = path.join(os.tmpdir(), \`imscc-${crypto.randomUUID()}.imscc\`); await writeFile(tmp, Buffer.from(await file.arrayBuffer()));` in a `try`, `await unlink(tmp)` in `finally`. (Note: `file.arrayBuffer()` buffers once; acceptable for the upload boundary. The *parser* is what avoids inflating the whole archive.)
  - `const { data, files } = await parseImscc(tmp);`
  - `const sheetsHasCatalog = (course.learningObjectives ?? []).length > 0;` then `const toInsert = assembleCanvasMaterials(data, { sheetsHasCatalog });`
  - Upsert each `toInsert` via the same `findMaterialByFileName`/`insertMaterial`/`updateMaterialMetadata` pattern the canvas-import route uses (copy that loop), passing `sourceCode`.
  - For each `files[]` entry: run bytes through the existing `material-extractor` (Docling) and `insertMaterial` as `Canvas File: <name>` with its MIME (same as canvas-import's file path — reuse that helper).
  - Stamp provenance: `updateCourseCanvasImport(code, \`Common Cartridge: ${data.course.name}\`, new Date())` (the existing helper).
  - Return `NextResponse.json({ imported: <count>, inserted, updated })`; on parse error return `{ error }` with 400.
  - Auth: same Basic-Auth guard the other course routes use (copy from `canvas-import/route.ts`).

- [ ] **Step 2: Route test** (mock DB like `canvas-import`'s route test; feed the fixture):
```ts
// Mirror canvas-import/__tests__/route.test.ts mocking. POST a multipart body whose
// `file` is the bytes of tests/fixtures/sample.imscc; assert 200 + that insertMaterial
// was called with 'Canvas: Syllabus' / 'Canvas: Assignments' / 'Canvas: Pages' /
// 'Canvas: Quizzes' and a 'Canvas File: reading.pdf' (and NOT a .png file).
```

- [ ] **Step 3: Verify + commit.**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run imscc-import`
```bash
git add "app/api/courses/[code]/imscc-import/route.ts" "app/api/courses/[code]/imscc-import/__tests__/route.test.ts"
git commit -m "feat(api): imscc-import route — upload a Common Cartridge, produce Canvas: materials"
```

---

### Task 7: Canvas-box upload UI

**Files:** `app/capture/[code]/boxes/CanvasBox.tsx`

- [ ] **Step 1: Add an upload handler + file input** to the single-mode token panel and each `BundledGroupHeader` form. A `<input type="file" accept=".imscc,application/zip">` plus an "Upload .imscc" button that POSTs `FormData` (`file`, `slug`, and `sourceCode` for a bundled slot) to `/api/courses/${courseCode}/imscc-import`. Reuse the existing import-result message state + `onImported`/`fetchCourseMaterials` refresh + auto-scan-after-import that the URL+token import already uses (mirror `handleImport`/`handleReextract`). Add the one-line hint: "Export from Canvas: Settings → Export Course Content."

- [ ] **Step 2: Verify + commit.**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run CanvasBox`
Expected: clean + the existing 17 CanvasBox tests still pass.
```bash
git add "app/capture/[code]/boxes/CanvasBox.tsx"
git commit -m "feat(capture): Canvas-box '.imscc upload' affordance (single + per-slot), alt to token import"
```

---

### Task 8: Full-suite regression + finish

- [ ] **Step 1:** `pnpm exec tsc --noEmit && pnpm test` → green.
- [ ] **Step 2:** Manual smoke (optional, deploy-time): upload a real exported `.imscc` on a course's capture Step-1 Canvas box; confirm `Canvas:` materials appear and a large cartridge doesn't spike memory (the PNG-style media is skipped).
- [ ] **Step 3:** Use superpowers:finishing-a-development-branch.

---

## Self-review

**Spec coverage:** parser → Task 5 (+ QTI Task 4); `CanvasCourseData`+files shape → Task 5; assembler extraction → Task 3; route → Task 6; Canvas-box UI (single + per-slot) → Task 7; large-cartridge handling (§3a: temp file + yauzl random-access + type/size filter + skip media) → Tasks 5–6; full parity incl. quizzes → Tasks 4–5; deps → Task 1; fixture + tests → Tasks 2,4,5,6; error handling (no manifest, bad quiz, oversize) → Tasks 5–6. Out-of-scope items (New-Quizzes fidelity, LTI, external-scoped access) correctly absent. ✓

**Placeholder scan:** Task 3 Step 1 says "paste lines 142–267 verbatim" — that's a *move* of existing, working code (not new code to invent), with the one substitution called out explicitly; acceptable. Task 5's parser implementation is specified as fixture-driven TDD with the exact resource-type→field mapping table + the exact fixture assertions that gate it — the iterative parts (manifest quirks) are bounded by the passing test rather than pre-written, which is the honest way to build a parser. No TBD/"handle edge cases"/vague-validation left.

**Type consistency:** `CanvasCourseData`, `CanvasQuiz`, `CanvasQuizQuestion`, `CanvasAssignment`, `CanvasPage`, `CanvasModule`, `CanvasDiscussion` all imported from `@/lib/canvas/fetchCanvasCourse` (the existing source). `assembleCanvasMaterials(data, { sheetsHasCatalog })` signature is identical in Tasks 3, 6. `parseImscc(zipPath) → { data, files }` and `ImsccFile = { name, bytes, mimeType }` consistent across Tasks 5, 6. `parseQtiAssessment(xml, identifier) → CanvasQuiz` consistent across Tasks 4, 5.
