# Spreadsheet Trial-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make spreadsheet materials usable in CourseCapture v2 audits. Today `lib/capture/materials-policy.ts:57` auto-excludes every xlsx/xls/xlsm Canvas file on the assumption they're gradebook data; for GC curricula that's the wrong default (spreadsheets are common pedagogical artifacts — budgets, asset trackers, QC logs, project scope templates). Even when faculty manually un-ignore one, the extracted markdown is dominated by sparse-grid syntax noise (`||||||| ` runs for empty cells), inflating apparent token count 20–30× over actual content density and pushing materials past the digest threshold.

**Architecture:**
- **Part A — Policy:** Default xlsx to `included: true`. Narrow the auto-exclude to filename patterns that look like grading data (`grade*`, `attendance*`, `roster*`, `*_scores.*`). Faculty retain the manual `ignore` checkbox for course-specific calls.
- **Part B — Density compression:** Add `lib/capture/spreadsheet-compact.ts`, a pure function that takes Docling's xlsx → markdown output and drops empty rows, drops empty columns, collapses contiguous empty-cell runs per row. Wire it into `DoclingExtractor.extract()` to run only when the extracted MIME is xlsx. The legacy-converter path (`.xls` → `.xlsx` via LibreOffice) flows through the same code so xls inherits the fix transparently.

**Tech Stack:** TypeScript strict · Vitest · existing Docling extractor in `lib/courses/material-extractor.ts` · existing legacy-converter in `lib/courses/legacy-converter.ts` (already runs for `.xls` upgrades) · no schema changes · no new dependencies.

**Spec adherence notes:**
- The narrowed gradebook regex is conservative — when in doubt, default to included. Better to surface a non-audit spreadsheet that faculty manually ignores than to silently swallow a load-bearing budget/template.
- The compaction algorithm preserves all non-empty cell content and column headers verbatim. It MUST NOT modify cell values, alter numeric precision, or change column ordering. Its only job is to drop empty/repeated noise.
- We checked Docling-serve's API surface; no spreadsheet-specific flag (sparse-cell filter, max-cell density, etc.) is available. The table-related parameters all relate to PDF table structure detection. Post-processing is the only path.
- Multi-pass digest for genuinely-content-dense oversize materials (200-page PDFs, etc.) is **out of scope for this plan**. Most spreadsheets won't need it after density compression; cases that still exceed the digest threshold after compaction can be deferred or handled with a "manual digest paste" affordance later.

**Out of scope:**
- Multi-pass digest path for oversize materials in general.
- xlsx-aware structured extraction (parsing the workbook directly via `xlsx`/`exceljs` instead of going through Docling). Docling's markdown-table output is good; the issue is just noise compaction.
- An admin/UI affordance for manual digest paste.

---

## File structure

**Created in this plan:**
- `lib/capture/spreadsheet-compact.ts` — pure compaction function.
- `tests/lib/capture/spreadsheet-compact.test.ts` — unit tests (TDD).

**Modified in this plan:**
- `lib/capture/materials-policy.ts` — narrow the xlsx auto-exclude rule to gradebook-shaped filenames only.
- `tests/lib/capture/materials-policy.test.ts` (or wherever the materials-policy tests live; verify via `find tests -name "materials-policy*"`) — add cases for the new policy.
- `lib/courses/material-extractor.ts` — call `compactSpreadsheetMarkdown` from `DoclingExtractor.extract()` when the MIME is xlsx.
- `docs/STATE.md` — note the policy refinement + compaction; bump `Last verified`.

---

## Task list

### Task 1: Narrow the xlsx auto-exclude policy

**Files:**
- Modify: `lib/capture/materials-policy.ts` (the xlsx rule at ~line 57)
- Modify: existing materials-policy tests (find via `find tests -name "materials-policy*"`)

The current rule auto-excludes EVERY `Canvas File:*.xls{,x,m}` regardless of content. Replace with a filename-pattern check for grading-shaped files.

- [ ] **Step 1: Locate the existing rule and its tests**

```bash
cd /Users/admin/projects/curriculum_developer
grep -n "Spreadsheet — usually data" lib/capture/materials-policy.ts
find tests -name "materials-policy*" 2>/dev/null
grep -n "Spreadsheet" tests/lib/capture/materials-policy.test.ts 2>/dev/null
```

- [ ] **Step 2: Write failing tests for the new policy**

In the existing materials-policy test file, add cases (use existing test style as a reference):

```typescript
describe('xlsx policy', () => {
  it('includes a generic Canvas File xlsx by default', () => {
    const result = classifyCanvasMaterial('Canvas File: 4800_budget_2025.xlsx', '');
    expect(result.included).toBe(true);
  });

  it('includes a Canvas File xlsx with project-template-shaped name', () => {
    const result = classifyCanvasMaterial('Canvas File: Project_Scope_Template.xlsx', '');
    expect(result.included).toBe(true);
  });

  it('excludes a Canvas File xlsx with gradebook-shaped name', () => {
    const result = classifyCanvasMaterial('Canvas File: Gradebook_Spring_2025.xlsx', '');
    expect(result.included).toBe(false);
    expect(result.reason).toMatch(/grade/i);
  });

  it('excludes a Canvas File xlsx with attendance-shaped name', () => {
    const result = classifyCanvasMaterial('Canvas File: Attendance_Log.xlsx', '');
    expect(result.included).toBe(false);
  });

  it('excludes a Canvas File xlsx with roster-shaped name', () => {
    const result = classifyCanvasMaterial('Canvas File: Class_Roster_F25.xlsx', '');
    expect(result.included).toBe(false);
  });

  it('excludes a Canvas File xlsx with scores-suffix name', () => {
    const result = classifyCanvasMaterial('Canvas File: Final_Project_Scores.xlsx', '');
    expect(result.included).toBe(false);
  });

  it('applies the same logic to .xls and .xlsm files', () => {
    expect(classifyCanvasMaterial('Canvas File: Budget_Legacy.xls', '').included).toBe(true);
    expect(classifyCanvasMaterial('Canvas File: Gradebook_2020.xls', '').included).toBe(false);
    expect(classifyCanvasMaterial('Canvas File: Budget_With_Macros.xlsm', '').included).toBe(true);
  });
});
```

Match the actual import + function name conventions from the existing file (the public name may be `classifyCanvasMaterial` or `classifySource` — check first).

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
./node_modules/.bin/vitest run tests/lib/capture/materials-policy.test.ts 2>&1 | tail -15
```

Expected: the include-by-default cases fail (returning included: false because of the current broad rule); the exclude-by-name cases pass (current rule still catches them).

- [ ] **Step 4: Replace the rule**

In `lib/capture/materials-policy.ts`, replace the existing xlsx block:

```typescript
if (/^Canvas File:.*\.(xlsx?|xlsm)$/i.test(fileName)) {
  return {
    included: false,
    reason: 'Spreadsheet — usually data, not audit material',
    ferpaRisk: 'low',
    overridable: true,
  };
}
```

with this narrower rule (matches xlsx/xls/xlsm AND a gradebook-shaped filename):

```typescript
// xlsx/xls/xlsm: default to included. Auto-exclude only when the
// filename matches gradebook-shaped patterns where the content is
// almost certainly student data (FERPA-sensitive and not audit-relevant).
// Faculty retain the manual `ignore` checkbox for course-specific calls.
if (/^Canvas File:.*\.(xlsx?|xlsm)$/i.test(fileName)
    && /\b(gradebook|grades?|attendance|roster|scores?|enrolment|enrollment)\b/i.test(fileName)) {
  return {
    included: false,
    reason: 'Filename looks like grading/roster data',
    ferpaRisk: 'high',
    overridable: true,
  };
}
```

Note the `ferpaRisk` change: gradebook-shaped files default to `high` (they likely contain student names/IDs/scores). The existing manual override (`ignore` checkbox) still lets faculty include if needed.

- [ ] **Step 5: Run tests to verify they pass**

```bash
./node_modules/.bin/vitest run tests/lib/capture/materials-policy.test.ts 2>&1 | tail -10
```

Expected: all new tests pass; no regression on existing tests.

- [ ] **Step 6: Commit**

```bash
git add lib/capture/materials-policy.ts tests/lib/capture/materials-policy.test.ts
git commit -m "$(cat <<'EOF'
feat(capture): narrow xlsx auto-exclude to gradebook-shaped filenames

Previous policy auto-excluded every Canvas File xlsx/xls/xlsm
regardless of content, on the assumption all spreadsheets are
gradebook data. For graphic-communications curricula that's wrong:
budgets, asset trackers, QC logs, project-scope templates, and
production schedules are all common pedagogical artifacts.

Narrows the rule to filename patterns that strongly suggest student
data (gradebook, grades, attendance, roster, scores, enrol(l)ment).
When matched, the file is excluded with ferpaRisk='high' (more
conservative than the previous 'low'). All other xlsx/xls/xlsm files
default to included; faculty retain the manual `ignore` checkbox for
course-specific calls.

Legacy .xls files flow through legacy-converter (LibreOffice
upgrade) before reaching this policy, so the same filename rule
applies to them transparently.
EOF
)"
```

---

### Task 2: Spreadsheet-compaction module + tests (TDD)

**Files:**
- Create: `lib/capture/spreadsheet-compact.ts`
- Create: `tests/lib/capture/spreadsheet-compact.test.ts`

A pure function that takes Docling's xlsx → markdown output and drops empty rows, drops empty columns, collapses contiguous empty-cell runs per row. Re-renders the cleaned tables back as markdown so downstream code (digest, chunking, indexing) treats the material like a normal, properly-sized markdown doc.

**Behavior contract:**
- Input: Docling's xlsx → markdown string. May contain multiple sheets separated by `## <SheetName>` headers (Docling's convention) plus `|...|` markdown tables.
- Output: a markdown string with the same logical structure but with empty rows removed, empty columns removed, and empty-cell runs collapsed.
- Non-table content (sheet headers, prose, sheet names) is preserved verbatim.
- Cell values are NEVER modified — no rounding, no whitespace normalization beyond trimming each cell, no column reordering.
- An empty cell is one that, after trimming, is the empty string. Whitespace-only is empty. Cells containing `-`, `0`, or `0.00` are NOT empty (those are real values).

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/capture/spreadsheet-compact.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { compactSpreadsheetMarkdown } from '@/lib/capture/spreadsheet-compact';

describe('compactSpreadsheetMarkdown', () => {
  it('returns input unchanged when there are no tables', () => {
    const input = 'Just some prose.\n\nNo tables here.';
    expect(compactSpreadsheetMarkdown(input)).toBe(input);
  });

  it('preserves a fully-dense table', () => {
    const input = [
      '| Cat | Item | Cost |',
      '|---|---|---|',
      '| A | X | 100 |',
      '| B | Y | 200 |',
    ].join('\n');
    expect(compactSpreadsheetMarkdown(input)).toBe(input);
  });

  it('drops fully-empty rows', () => {
    const input = [
      '| Cat | Item | Cost |',
      '|---|---|---|',
      '| A | X | 100 |',
      '|  |  |  |',
      '|  |  |  |',
      '| B | Y | 200 |',
    ].join('\n');
    const expected = [
      '| Cat | Item | Cost |',
      '|---|---|---|',
      '| A | X | 100 |',
      '| B | Y | 200 |',
    ].join('\n');
    expect(compactSpreadsheetMarkdown(input)).toBe(expected);
  });

  it('drops fully-empty columns', () => {
    const input = [
      '| Cat |  | Item |  | Cost |',
      '|---|---|---|---|---|',
      '| A |  | X |  | 100 |',
      '| B |  | Y |  | 200 |',
    ].join('\n');
    const expected = [
      '| Cat | Item | Cost |',
      '|---|---|---|',
      '| A | X | 100 |',
      '| B | Y | 200 |',
    ].join('\n');
    expect(compactSpreadsheetMarkdown(input)).toBe(expected);
  });

  it('drops both empty rows and empty columns simultaneously', () => {
    const input = [
      '| Cat |  | Item |  | Cost |',
      '|---|---|---|---|---|',
      '| A |  | X |  | 100 |',
      '|  |  |  |  |  |',
      '| B |  | Y |  | 200 |',
    ].join('\n');
    const expected = [
      '| Cat | Item | Cost |',
      '|---|---|---|',
      '| A | X | 100 |',
      '| B | Y | 200 |',
    ].join('\n');
    expect(compactSpreadsheetMarkdown(input)).toBe(expected);
  });

  it('treats whitespace-only cells as empty', () => {
    const input = [
      '| A |   | B |',
      '|---|---|---|',
      '| 1 |    | 2 |',
    ].join('\n');
    const expected = [
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n');
    expect(compactSpreadsheetMarkdown(input)).toBe(expected);
  });

  it('does NOT treat "0", "-", or "0.00" as empty (real values)', () => {
    const input = [
      '| Item | Cost | Discount |',
      '|---|---|---|',
      '| X | 0 | - |',
      '| Y | 0.00 | 0 |',
    ].join('\n');
    expect(compactSpreadsheetMarkdown(input)).toBe(input);
  });

  it('processes multiple sheets independently', () => {
    const input = [
      '## Sheet1',
      '| A |  | B |',
      '|---|---|---|',
      '| 1 |  | 2 |',
      '',
      '## Sheet2',
      '| C | D |',
      '|---|---|',
      '| 3 | 4 |',
      '|  |  |',
      '| 5 | 6 |',
    ].join('\n');
    const expected = [
      '## Sheet1',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '## Sheet2',
      '| C | D |',
      '|---|---|',
      '| 3 | 4 |',
      '| 5 | 6 |',
    ].join('\n');
    expect(compactSpreadsheetMarkdown(input)).toBe(expected);
  });

  it('preserves non-table prose between tables', () => {
    const input = [
      'Workbook overview:',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      'Some commentary.',
      '',
      '| C | D |',
      '|---|---|',
      '| 3 | 4 |',
    ].join('\n');
    expect(compactSpreadsheetMarkdown(input)).toBe(input);
  });

  it('drops a table that becomes degenerate (all rows/cols empty)', () => {
    const input = [
      '| A | B | C |',
      '|---|---|---|',
      '|  |  |  |',
      '|  |  |  |',
    ].join('\n');
    // Acceptable: drop the table entirely, leaving an empty string or a
    // marker comment. We accept either result — the contract is "no
    // empty markdown table left behind"; the implementation can choose.
    const result = compactSpreadsheetMarkdown(input);
    expect(result).not.toMatch(/\|---\|/);
  });

  it('handles a realistic sparse-budget shape with measurable compression', () => {
    // 5x5 grid where only 3 cells have content. Expect compression to a
    // small representation; assert the output is materially smaller than
    // the input (at least 50% shorter).
    const input = [
      '| Category | Q1 | Q2 | Q3 | Q4 |',
      '|---|---|---|---|---|',
      '| Marketing | 1000 |  |  |  |',
      '|  |  |  |  |  |',
      '|  |  |  |  |  |',
      '| Print |  | 500 |  |  |',
      '|  |  |  |  |  |',
      '| Misc |  |  |  | 200 |',
    ].join('\n');
    const out = compactSpreadsheetMarkdown(input);
    expect(out.length).toBeLessThan(input.length * 0.6);
    expect(out).toContain('Marketing');
    expect(out).toContain('1000');
    expect(out).toContain('Print');
    expect(out).toContain('500');
    expect(out).toContain('Misc');
    expect(out).toContain('200');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
./node_modules/.bin/vitest run tests/lib/capture/spreadsheet-compact.test.ts 2>&1 | tail -10
```

Expected: FAIL — `compactSpreadsheetMarkdown` not exported / not a function.

- [ ] **Step 3: Implement the module**

Create `lib/capture/spreadsheet-compact.ts`:

```typescript
/**
 * Compact a Docling-emitted xlsx markdown document by removing empty
 * rows, removing empty columns, and dropping degenerate tables.
 *
 * Docling renders an xlsx workbook as one or more markdown tables (one
 * per sheet, with `## SheetName` headers between them). XLSX files
 * preserve every cell of every sheet, so the resulting markdown is
 * heavy with empty-cell syntax noise — sparse 100x20 grids become 2000+
 * characters of `| | | | | | ` runs that inflate token count without
 * adding content.
 *
 * Contract:
 *   - Pure function. No I/O.
 *   - Non-table content (prose, headers, blank lines) preserved verbatim.
 *   - Cell values never modified beyond trimming whitespace.
 *   - Column order never changed.
 *   - An "empty" cell is one whose trimmed value is the empty string.
 *     Cells containing "0", "-", "0.00", etc. are real values.
 *   - A table that becomes degenerate (zero non-empty rows or zero
 *     non-empty cols) is dropped from the output entirely.
 */
export function compactSpreadsheetMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isTableHeaderLine(line) && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1] ?? '')) {
      // Collect the full table block.
      const tableLines: string[] = [line, lines[i + 1] ?? ''];
      let j = i + 2;
      while (j < lines.length && isTableRowLine(lines[j] ?? '')) {
        tableLines.push(lines[j] ?? '');
        j++;
      }
      const compacted = compactTableBlock(tableLines);
      if (compacted.length > 0) {
        out.push(...compacted);
      }
      i = j;
    } else {
      out.push(line);
      i++;
    }
  }

  return out.join('\n');
}

function isTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isTableHeaderLine(line: string): boolean {
  return isTableRowLine(line);
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!isTableRowLine(line)) return false;
  // Cells in a separator are all dashes (with optional :: for alignment).
  const cells = splitCells(trimmed);
  return cells.every(c => /^:?-+:?$/.test(c.trim()));
}

function splitCells(line: string): string[] {
  // Trim leading + trailing pipes, then split on inner pipes.
  // Note: this does not handle escaped pipes inside cells; Docling's
  // xlsx output doesn't produce those for our use case.
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|');
}

function joinCells(cells: string[]): string {
  return '| ' + cells.map(c => c.trim()).join(' | ') + ' |';
}

function compactTableBlock(tableLines: string[]): string[] {
  if (tableLines.length < 3) return tableLines; // header + separator + at least one row

  const header = tableLines[0]!;
  const separator = tableLines[1]!;
  const rows = tableLines.slice(2);

  const headerCells = splitCells(header).map(c => c.trim());
  const separatorCells = splitCells(separator);
  const rowsCells = rows.map(r => splitCells(r).map(c => c.trim()));

  // Identify which columns are empty across ALL data rows. Header cells
  // count as content — if a header is non-empty, the column stays even if
  // all its data cells are empty. (Headers describe the column.)
  const colCount = headerCells.length;
  const keepColumns: boolean[] = [];
  for (let c = 0; c < colCount; c++) {
    const headerNonEmpty = (headerCells[c] ?? '').length > 0;
    const dataNonEmpty = rowsCells.some(r => ((r[c] ?? '').length > 0));
    keepColumns[c] = headerNonEmpty || dataNonEmpty;
  }

  const anyColumnKept = keepColumns.some(k => k);
  if (!anyColumnKept) return [];

  // Drop fully-empty rows (rows where every kept column is empty).
  const keptRows = rowsCells.filter(r =>
    r.some((cell, c) => keepColumns[c] && cell.length > 0),
  );
  if (keptRows.length === 0) return [];

  // Filter columns in header + separator + each row.
  const newHeader = joinCells(headerCells.filter((_, c) => keepColumns[c]));
  const newSeparator = joinCells(separatorCells.filter((_, c) => keepColumns[c]));
  const newRows = keptRows.map(r => joinCells(r.filter((_, c) => keepColumns[c])));

  return [newHeader, newSeparator, ...newRows];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
./node_modules/.bin/vitest run tests/lib/capture/spreadsheet-compact.test.ts 2>&1 | tail -10
```

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/capture/spreadsheet-compact.ts tests/lib/capture/spreadsheet-compact.test.ts
git commit -m "$(cat <<'EOF'
feat(capture): xlsx markdown density compaction

Adds compactSpreadsheetMarkdown — a pure function that takes Docling's
xlsx → markdown output and drops empty rows, drops empty columns
(unless the header is non-empty), and drops degenerate tables
entirely. Cell values are never modified beyond trimming; column
order is preserved; "0", "-", "0.00" are treated as real values
(not empty).

Sparse multi-sheet workbooks (budgets, asset trackers, QC logs) are
the primary target. Docling preserves every cell of every sheet by
design — necessary for general use, but for our digest + indexing
pipeline the resulting noise inflates token count 20–30× over actual
content density. This module is the offset.

Pure module with 11 unit tests covering dense tables, sparse tables,
empty-row drop, empty-column drop, whitespace-only cells, real-value
zeros, multi-sheet documents, preserved non-table prose, degenerate
tables, and a realistic sparse-budget case with measurable
compression.
EOF
)"
```

---

### Task 3: Wire compaction into the Docling extractor

**Files:**
- Modify: `lib/courses/material-extractor.ts` — `DoclingExtractor.extract()` (around line 112)

After Docling returns markdown for an xlsx (or any xlsx-derived input), pass it through `compactSpreadsheetMarkdown` before returning. The legacy `.xls` upgrade path runs in `legacy-converter.ts` BEFORE this extractor, so by the time we hit this code the MIME is always `xlsx`-shaped — same wiring covers .xls.

- [ ] **Step 1: Identify the call site**

```bash
cd /Users/admin/projects/curriculum_developer
grep -n "md_content\|text_content" lib/courses/material-extractor.ts
```

Expected: a line near 166 reading `const text = (doc.md_content ?? doc.text_content ?? '').trim();`. The compaction goes immediately after this assignment, before the return.

- [ ] **Step 2: Add the import**

At the top of `lib/courses/material-extractor.ts`, add:

```typescript
import { compactSpreadsheetMarkdown } from '@/lib/capture/spreadsheet-compact';
```

(Match the existing import style — `@/`-aliased path.)

- [ ] **Step 3: Apply compaction conditionally inside `DoclingExtractor.extract()`**

Replace the existing extract-text line and the page-count computation. The current block:

```typescript
const text = (doc.md_content ?? doc.text_content ?? '').trim();
// Best-effort page/slide/sheet count from --- separators in the markdown.
// Docling's ExportDocumentResponse doesn't surface a count field when
// only md is requested.
const pageCount = text ? Math.max(1, (text.match(/^---$/gm) ?? []).length + 1) : 0;
return { text, pageCount };
```

becomes:

```typescript
const rawText = (doc.md_content ?? doc.text_content ?? '').trim();
// XLSX → markdown output is dominated by sparse-cell syntax noise
// (Docling preserves every cell of every sheet). Compact it before
// returning so the digest + indexing pipeline sees content-shaped
// markdown rather than 100× syntax overhead.
const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const text = mimeType === xlsxMime ? compactSpreadsheetMarkdown(rawText) : rawText;
// Best-effort page/slide/sheet count from --- separators in the markdown.
// Docling's ExportDocumentResponse doesn't surface a count field when
// only md is requested.
const pageCount = text ? Math.max(1, (text.match(/^---$/gm) ?? []).length + 1) : 0;
return { text, pageCount };
```

(`mimeType` is already destructured in the function signature — no new parameter needed.)

- [ ] **Step 4: Verify type-checking is clean**

```bash
./node_modules/.bin/tsc --noEmit 2>&1 | grep -v -E "scripts/_one-off|tests/lib/ai/agent/audit-agent.test|tests/lib/capture/weaviate-schema" | head -10
```

Expected: empty (baseline noise filtered).

- [ ] **Step 5: Quick integration check**

```bash
./node_modules/.bin/tsx -e "
import { compactSpreadsheetMarkdown } from './lib/capture/spreadsheet-compact';
const sample = ['| A |  | B |', '|---|---|---|', '| 1 |  | 2 |', '|  |  |  |', '| 3 |  | 4 |'].join('\n');
console.log('before:', JSON.stringify(sample));
console.log('after:', JSON.stringify(compactSpreadsheetMarkdown(sample)));
"
```

Expected: a compacted markdown table with the middle column and empty row gone.

- [ ] **Step 6: Run all capture + extractor tests**

```bash
./node_modules/.bin/vitest run tests/lib/capture/ tests/lib/courses/ 2>&1 | tail -10
```

Expected: green; the new compaction tests pass + nothing in the existing extractor tests regressed.

- [ ] **Step 7: Commit**

```bash
git add lib/courses/material-extractor.ts
git commit -m "$(cat <<'EOF'
feat(capture): apply spreadsheet-compact in DoclingExtractor for xlsx

When DoclingExtractor.extract() receives an xlsx MIME type, post-
process the markdown output through compactSpreadsheetMarkdown before
returning. Pure addition — pdf/docx/pptx/csv/html/image paths are
untouched.

Legacy .xls files are upgraded to .xlsx by legacy-converter.ts via
LibreOffice headless before reaching this extractor, so xls inherits
the compaction transparently via the same code path.

Combined with the policy refinement in the prior commit, this makes
spreadsheet materials usable end-to-end: the 4800_budget_2025.xlsx
in faculty trial moves from "131k token monster, auto-excluded" to
"normal-sized material with content readable by the audit agent."
EOF
)"
```

---

### Task 4: Re-extract the 4800 budget xlsx + STATE.md update

**Files:**
- Run: backfill-style re-extraction against the test course.
- Modify: `docs/STATE.md`.

The 4800_budget xlsx is currently sitting in the materials list as `extracted` + `ignored`, with 131k tokens of pre-Stage-6 sparse-grid markdown. To validate the fix end-to-end, re-extract it (the Materials panel has a "Re-extract Canvas files" button) and verify the new token count is materially smaller. Then bump STATE.md.

- [ ] **Step 1: Trigger re-extraction**

Two paths to trigger this:
- **UI path** (preferred): open `/capture/GC%204800?slug=<slug>` in the browser, hit "Re-extract Canvas files" in the Materials panel header. Wait for the row to refresh. Faculty-facing; we should verify the path they'll use works.
- **API path**: `POST /api/courses/GC%204800/canvas-reextract` — used by the button. Either is fine; the UI path is what faculty will use.

If you're a subagent without browser access, ask the controller to perform the UI step and confirm; otherwise hit the API directly via curl (the route is at `app/api/courses/[code]/canvas-reextract/route.ts`; check it for the expected method + payload).

- [ ] **Step 2: Verify the token count dropped**

After re-extraction completes, the Materials panel row for `4800_budget_2025.xlsx` should show:
- Status: `extracted`
- Token estimate: materially lower than 131k (target: <10k; acceptable: <30k)
- The `ignore` checkbox should now reflect the new policy (NO longer auto-checked if the filename doesn't match gradebook patterns — `4800_budget_2025.xlsx` doesn't, so it should default to included)

If the token count is still >50k after compaction, the spreadsheet contains genuinely-dense content that the simple drop-empty-rows-and-cols algorithm can't compress. That's a Task-out-of-scope finding to surface (likely indicates a multi-pass digest is needed for this specific file, but not required for trial-readiness — faculty can manually ignore it).

- [ ] **Step 3: Update STATE.md**

Edit `docs/STATE.md`:

(a) Bump `Last verified` to the HEAD SHA after Tasks 1–3 commit.

(b) Append a short note under the **Deferred / debt** section (find the bullet list under "Deferred / debt") OR add a sentence to the materials-pipeline description, depending on where it fits most cleanly. Suggested wording:

```
- **Spreadsheet handling refined 2026-05-28.** xlsx/xls/xlsm files no longer
  auto-excluded — narrowed to gradebook-shaped filenames. Docling's xlsx →
  markdown output is post-processed through `compactSpreadsheetMarkdown` to
  drop empty rows/columns/runs (Docling preserves every cell by design; the
  noise inflates token count 20–30× for sparse grids). Legacy `.xls` flows
  through the same compaction via legacy-converter's LibreOffice upgrade.
```

Place it where it fits — probably appended to the "Reference-material compression / ingestion" paragraph since it's part of the same pipeline story.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "$(cat <<'EOF'
chore(capture): STATE.md — spreadsheet trial-readiness shipped

xlsx/xls/xlsm files no longer universally auto-excluded; only
gradebook-shaped filenames are. Docling's xlsx markdown output is
post-processed through compactSpreadsheetMarkdown to drop sparse-grid
syntax noise. Legacy .xls flows through the same code path via the
existing LibreOffice upgrade.

Faculty trial can now use spreadsheet materials (budgets, asset
trackers, QC logs, project templates) without manual override or
oversize digest failures.
EOF
)"
```

---

## Acceptance criteria

After all tasks complete:

1. `./node_modules/.bin/vitest run tests/lib/capture/` is green (new compaction + policy tests pass; no regressions in existing capture tests).
2. `./node_modules/.bin/tsc --noEmit` shows no new errors outside the pre-existing baseline.
3. The materials policy includes a generic xlsx by default; excludes gradebook-shaped names with `ferpaRisk='high'`.
4. `compactSpreadsheetMarkdown` is a pure function with 11 passing tests covering dense, sparse, multi-sheet, whitespace-edge, and real-value-zero cases.
5. `DoclingExtractor.extract()` applies the compaction for xlsx MIME only; other extractor paths unchanged.
6. Re-extracting the 4800 budget xlsx in faculty trial drops its token count from ~131k to materially less (target <10k; acceptable <30k).
7. STATE.md reflects the refinement.

## Out of scope (handled separately if needed)

- Multi-pass digest path for genuinely-content-dense oversize materials (long lab manuals, textbook chapters). Hold until a specific case forces it.
- Admin/UI affordance for manual digest paste. Same.
- xlsx-aware structured extraction (parse the workbook directly with `xlsx`/`exceljs` instead of Docling). Docling's output is fine after compaction; no need to swap the extractor.
