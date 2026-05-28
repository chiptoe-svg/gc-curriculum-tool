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
 *   - A column is dropped when every data row's cell in that column is
 *     empty, regardless of whether the column header is non-empty.
 *     (A header-only column carries no audit-relevant content and would
 *     just inflate token count.)
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
  if (!isTableRowLine(line)) return false;
  // Cells in a separator are all dashes (with optional :: for alignment).
  const cells = splitCells(line.trim());
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
  // Non-empty cells are padded with a space on each side for readability.
  // Empty cells are rendered without extra whitespace (||) to minimise
  // token overhead in sparse tables.
  const parts = cells.map(c => {
    const v = c.trim();
    return v ? ` ${v} ` : '';
  });
  return '|' + parts.join('|') + '|';
}

/**
 * Rebuild a separator line from the filtered original separator cells,
 * preserving the exact dash token (e.g. `---`, `:---:`) rather than
 * normalising to `---`.
 */
function joinSeparatorCells(cells: string[]): string {
  return '|' + cells.map(c => c).join('|') + '|';
}

function compactTableBlock(tableLines: string[]): string[] {
  if (tableLines.length < 3) return tableLines; // header + separator + at least one row

  const header = tableLines[0]!;
  const separator = tableLines[1]!;
  const rows = tableLines.slice(2);

  const headerCells = splitCells(header).map(c => c.trim());
  // Keep separator cells raw (preserve exact dash token + any leading/trailing space).
  const separatorCells = splitCells(separator);
  const rowsCells = rows.map(r => splitCells(r).map(c => c.trim()));

  // Identify which columns are empty across ALL data rows. A column is kept
  // if at least one data row has a non-empty value in that column. Header
  // content alone does not keep a column — a column whose every data cell is
  // empty provides no information and is dropped regardless of its header.
  const colCount = headerCells.length;
  const keepColumns: boolean[] = [];
  for (let c = 0; c < colCount; c++) {
    const dataNonEmpty = rowsCells.some(r => ((r[c] ?? '').length > 0));
    keepColumns[c] = dataNonEmpty;
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
  const newSeparator = joinSeparatorCells(separatorCells.filter((_, c) => keepColumns[c]));
  const newRows = keptRows.map(r => joinCells(r.filter((_, c) => keepColumns[c])));

  return [newHeader, newSeparator, ...newRows];
}
