import { describe, it, expect, vi } from 'vitest';

// Force the image-based-PDF branch: extractor returns near-empty text for a PDF.
vi.mock('@/lib/courses/material-extractor', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  getExtractorFor: () => ({ extract: async () => ({ text: '', pageCount: 3 }) }),
}));
vi.mock('@/lib/courses/legacy-converter', () => ({
  isLegacyOfficeMime: () => false,
  convertLegacyToModern: async () => { throw new Error('unused'); },
}));

// getProvider must NOT be used when a visionProvider is injected.
// Use vi.hoisted so the fn reference is available when vi.mock is hoisted.
const { getProvider } = vi.hoisted(() => ({
  getProvider: vi.fn(() => { throw new Error('getProvider should not be called'); }),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

import { extractText } from '@/lib/courses/extract-text';

describe('extractText with injected vision provider', () => {
  it('routes image-PDF transcription to the injected provider', async () => {
    const transcribeDocument = vi.fn(async () => ({ text: 'LOCAL TRANSCRIPT', costUsdCents: 0, truncated: false }));
    const res = await extractText(
      { fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf', fileName: 'scan.pdf' },
      { visionProvider: { transcribeDocument } as never },
    );
    expect(transcribeDocument).toHaveBeenCalledOnce();
    expect(getProvider).not.toHaveBeenCalled();
    expect(res).toMatchObject({ method: 'vision', status: 'ok', text: 'LOCAL TRANSCRIPT' });
  });
});
