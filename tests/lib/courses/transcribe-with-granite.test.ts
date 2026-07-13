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
  it('POSTs the VLM pipeline with a remote-Spark custom config and parses md', async () => {
    const spy = mockFetchOnce({ status: 'success', document: { md_content: '## Heading\n\ntext one\n\ntext two' } });
    const out = await transcribeWithGranite({ fileBytes: Buffer.from('x'), mimeType: 'application/pdf', fileName: 'a.pdf' });
    expect(out.text).toContain('## Heading');
    const form = spy.mock.calls[0]![1]!.body as FormData;
    expect(form.get('pipeline')).toBe('vlm');
    expect(form.get('to_formats')).toBe('md');
    expect(form.get('image_export_mode')).toBe('placeholder');
    // custom config drives Granite on the Spark; the deprecated enum field is NOT sent
    expect(form.get('vlm_pipeline_model')).toBeNull();
    const cfg = JSON.parse(form.get('vlm_pipeline_custom_config') as string);
    expect(cfg.engine_options.engine_type).toBe('api');
    expect(cfg.engine_options.url).toContain('/v1/chat/completions');
    expect(cfg.engine_options.params.skip_special_tokens).toBe(false); // mandatory: keeps DocTags loc tokens
    expect(cfg.model_spec.prompt).toBe('Convert this page to docling.');
    expect(cfg.model_spec.response_format).toBe('doctags');
    expect(String(spy.mock.calls[0]![0])).toContain('/v1/convert/file');
  });

  it('honors GRANITE_VLM_URL / GRANITE_VLM_MODEL env overrides', async () => {
    process.env.GRANITE_VLM_URL = 'http://spark.example/v1/chat/completions';
    process.env.GRANITE_VLM_MODEL = 'granite-x';
    const spy = mockFetchOnce({ status: 'success', document: { md_content: '## H' } });
    await transcribeWithGranite({ fileBytes: Buffer.from('x'), mimeType: 'application/pdf', fileName: 'a.pdf' });
    const form = spy.mock.calls[0]![1]!.body as FormData;
    const cfg = JSON.parse(form.get('vlm_pipeline_custom_config') as string);
    expect(cfg.engine_options.url).toBe('http://spark.example/v1/chat/completions');
    expect(cfg.engine_options.params.model).toBe('granite-x');
    delete process.env.GRANITE_VLM_URL;
    delete process.env.GRANITE_VLM_MODEL;
  });
  it('throws on a non-ok docling-serve response (so the caller can fall back)', async () => {
    mockFetchOnce({ detail: 'boom' }, false);
    await expect(transcribeWithGranite({ fileBytes: Buffer.from('x'), mimeType: 'application/pdf', fileName: 'a.pdf' }))
      .rejects.toThrow();
  });
});
