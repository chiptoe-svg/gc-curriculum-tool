import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchIndexCourseCodes, fetchCourseTabCsv, gvizUrl } from '@/lib/sheets/fetchSheet';

describe('fetchSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('gvizUrl encodes the tab name correctly', () => {
    expect(gvizUrl('SHEET_ID', 'GC 4900ap')).toBe(
      'https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:csv&sheet=GC%204900ap'
    );
  });

  it('fetchIndexCourseCodes pulls codes from column A', async () => {
    const csv = `"Code","Title"\n"GC 1010","Orientation"\n"GC 4900ap","Analog Photography"\n`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csv, { status: 200 })));
    const codes = await fetchIndexCourseCodes('SHEET_ID');
    expect(codes).toEqual(['GC 1010', 'GC 4900ap']);
  });

  it('fetchIndexCourseCodes ignores non-course rows (header, blanks, summary tabs)', async () => {
    const csv = `"Code","Title"\n"GC 1010","x"\n"","empty"\n"Summary","ignore"\n"GC 4900ap","y"\n`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csv, { status: 200 })));
    const codes = await fetchIndexCourseCodes('SHEET_ID');
    expect(codes).toEqual(['GC 1010', 'GC 4900ap']);
  });

  it('fetchCourseTabCsv returns raw CSV text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('raw csv', { status: 200 })));
    const text = await fetchCourseTabCsv('SHEET_ID', 'GC 3460');
    expect(text).toBe('raw csv');
  });

  it('fetchCourseTabCsv throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(fetchCourseTabCsv('SHEET_ID', 'GC 0000')).rejects.toThrow(/404/);
  });
});
