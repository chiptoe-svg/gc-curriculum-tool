import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Default: extractor yields image-based (near-empty) text for a PDF → lane 3.
vi.mock('@/lib/courses/material-extractor', async (orig) => {
  const actual = await orig<typeof import('@/lib/courses/material-extractor')>();
  return {
    ...actual,
    getExtractorFor: () => ({ name: 'docling', supports: () => true, extract: async () => ({ text: '', pageCount: 2 }) }),
    transcribeWithGranite: vi.fn(),
  };
});

// Both provider factories are spies so we can assert which lane fired.
const { getProvider, buildLocalProvider } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  buildLocalProvider: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider, buildLocalProvider }));

import { extractText } from '@/lib/courses/extract-text';

const args = { fileBytes: Buffer.from('%PDF'), mimeType: 'application/pdf' as const, fileName: 'scan.pdf' };
const openaiProvider = { transcribeDocument: vi.fn(async () => ({ text: 'OPENAI TRANSCRIPT long enough', costUsdCents: 5, truncated: false })) };

beforeEach(() => {
  vi.clearAllMocks();
  getProvider.mockReturnValue(openaiProvider);
});
afterEach(() => { delete process.env.LOCAL_HARDSCAN_OCR; });

it('flag ON + local returns text → local used with forceOffload, OpenAI not called', async () => {
  process.env.LOCAL_HARDSCAN_OCR = '1';
  const local = { transcribeDocument: vi.fn(async () => ({ text: 'QWEN SPARK TRANSCRIPT', costUsdCents: 0, truncated: false })) };
  buildLocalProvider.mockReturnValue(local);
  const r = await extractText(args);
  expect(r).toMatchObject({ method: 'vision', status: 'ok', text: 'QWEN SPARK TRANSCRIPT', visionCostUsdCents: 0 });
  expect(local.transcribeDocument).toHaveBeenCalledOnce();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((local.transcribeDocument.mock.calls[0] as any)[0]).toMatchObject({ forceOffload: true });
  expect(openaiProvider.transcribeDocument).not.toHaveBeenCalled();
});

it('flag ON + local throws → OpenAI fallback fires', async () => {
  process.env.LOCAL_HARDSCAN_OCR = '1';
  buildLocalProvider.mockReturnValue({ transcribeDocument: vi.fn(async () => { throw new Error('spark down'); }) });
  const r = await extractText(args);
  expect(r).toMatchObject({ method: 'vision', status: 'ok', text: 'OPENAI TRANSCRIPT long enough' });
  expect(openaiProvider.transcribeDocument).toHaveBeenCalledOnce();
});

it('flag ON + local returns empty → OpenAI fallback fires', async () => {
  process.env.LOCAL_HARDSCAN_OCR = '1';
  buildLocalProvider.mockReturnValue({ transcribeDocument: vi.fn(async () => ({ text: '  ', costUsdCents: 0, truncated: false })) });
  const r = await extractText(args);
  expect(r.method).toBe('vision');
  expect(openaiProvider.transcribeDocument).toHaveBeenCalledOnce();
});

it('flag OFF → buildLocalProvider never called, straight to OpenAI', async () => {
  const r = await extractText(args);
  expect(buildLocalProvider).not.toHaveBeenCalled();
  expect(openaiProvider.transcribeDocument).toHaveBeenCalledOnce();
  expect(r).toMatchObject({ method: 'vision', text: 'OPENAI TRANSCRIPT long enough' });
});

it('use-local mode (visionProvider injected) + flag ON → injected provider used, buildLocalProvider skipped', async () => {
  process.env.LOCAL_HARDSCAN_OCR = '1';
  const injected = { transcribeDocument: vi.fn(async () => ({ text: 'INJECTED LOCAL', costUsdCents: 0, truncated: false })) };
  const r = await extractText(args, { visionProvider: injected as never });
  expect(injected.transcribeDocument).toHaveBeenCalledOnce();
  expect(buildLocalProvider).not.toHaveBeenCalled();
  expect(r).toMatchObject({ method: 'vision', text: 'INJECTED LOCAL' });
});
