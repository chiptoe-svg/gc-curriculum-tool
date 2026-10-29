import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCanvasCourse } from '@/lib/canvas/fetchCanvasCourse';

afterEach(() => vi.unstubAllGlobals());

/** Canvas gives a File module item's file id as `content_id`; the import
 *  needs it to download files that sit directly in a module. */
describe('fetchCanvasCourse — module items', () => {
  it('keeps the file id of File items and leaves it null for other items', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = /\/courses\/1\?include/.test(url)
        ? { id: 1, name: 'PKSC 2200', syllabus_body: '' }
        : /\/modules\?/.test(url)
          ? [{ id: 10, name: 'Course Information', published: true, items: [
              { title: 'PKSC 2200 Syllabi', type: 'File', content_id: 901, published: true },
              { title: 'Clean Up Requirement', type: 'Page', content_id: 55, published: true },
            ] }]
          : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const data = await fetchCanvasCourse('https://canvas.test', '1', 'tok');
    const [file, page] = data.modules[0]!.items;
    expect(file!.fileId).toBe('901');
    expect(page!.fileId).toBeNull();
  });
});
