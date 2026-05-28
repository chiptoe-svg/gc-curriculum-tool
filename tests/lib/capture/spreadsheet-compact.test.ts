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

  it('drops a table with header + separator but no data rows', () => {
    const input = [
      '| A | B | C |',
      '|---|---|---|',
    ].join('\n');
    const result = compactSpreadsheetMarkdown(input);
    expect(result).not.toMatch(/\|---\|/);
    expect(result).not.toContain('| A | B | C |');
  });

  it('strips inline base64 data URI images (Docling xlsx embed quirk)', () => {
    const input = [
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '![chart](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==)',
      '',
      '![](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD)',
      '',
      'Trailing text.',
    ].join('\n');
    const out = compactSpreadsheetMarkdown(input);
    expect(out).not.toContain('base64,');
    expect(out).not.toContain('iVBORw0K');
    expect(out).toContain('(image)');
    expect(out).toContain('Trailing text.');
    expect(out).toContain('| 1 | 2 |');
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
