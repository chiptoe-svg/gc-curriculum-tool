import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeWithGranite } from '@/lib/courses/material-extractor';

afterEach(() => vi.restoreAllMocks());

function mockFetchOnce(json: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, status: ok ? 200 : 500,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response);
}

describe('transcribeWithGranite', () => {
  it('POSTs to docling-serve with the VLM pipeline + granite model and parses md', async () => {
    const spy = mockFetchOnce({ status: 'success', document: { md_content: '## Heading\n\ntext one\n\ntext two' } });
    const out = await transcribeWithGranite({ fileBytes: Buffer.from('x'), mimeType: 'application/pdf', fileName: 'a.pdf' });
    expect(out.text).toContain('## Heading');
    const form = spy.mock.calls[0]![1]!.body as FormData;
    expect(form.get('pipeline')).toBe('vlm');
    expect(form.get('vlm_pipeline_model')).toBe('granite_docling');
    expect(form.get('to_formats')).toBe('md');
    expect(String(spy.mock.calls[0]![0])).toContain('/v1/convert/file');
  });
  it('throws on a non-ok docling-serve response (so the caller can fall back)', async () => {
    mockFetchOnce({ detail: 'boom' }, false);
    await expect(transcribeWithGranite({ fileBytes: Buffer.from('x'), mimeType: 'application/pdf', fileName: 'a.pdf' }))
      .rejects.toThrow();
  });
});
