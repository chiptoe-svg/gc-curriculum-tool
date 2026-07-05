import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { canonicalize, canonicalizeAdaptive } from '@/lib/ai/vision-canonicalize';
import { canonicalDims, tokensForDims, UNIT } from '@/lib/ai/vision-canonical';

async function png(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
}
async function meta(buf: Buffer) {
  const m = await sharp(buf).metadata();
  return { w: m.width!, h: m.height! };
}

describe('canonicalize — fixed budget (OCR/slides)', () => {
  it('OCR 1120: output matches canonicalDims, on-grid, tokens ≤ B', async () => {
    const src = await png(1500, 1950); // ~Letter-ish
    const out = await canonicalize(src, 1120);
    const d = canonicalDims(1120, 1500, 1950);
    const m = await meta(out.png);
    expect(m.w).toBe(d.width);
    expect(m.h).toBe(d.height);
    expect(m.w % UNIT).toBe(0);
    expect(m.h % UNIT).toBe(0);
    expect(out.tokens).toBe(d.tokens);
    expect(out.tokens).toBeLessThanOrEqual(1120);
    expect(out.budget).toBe(1120);
    expect(tokensForDims(m.w, m.h)).toBe(out.tokens);
  });

  it('slides 560: 16:9 lands on the contract vector (1488×864/558)', async () => {
    const out = await canonicalize(await png(1920, 1080), 560);
    const m = await meta(out.png);
    expect([m.w, m.h, out.tokens]).toEqual([1488, 864, 558]);
  });
});

describe('canonicalizeAdaptive — captions', () => {
  it('small crop rides native, picks a low tier, on-grid, tokens ≤ budget', async () => {
    const out = await canonicalizeAdaptive(await png(600, 400));
    const m = await meta(out.png);
    expect(m.w % UNIT).toBe(0);
    expect(m.h % UNIT).toBe(0);
    expect(out.tokens).toBeLessThanOrEqual(out.budget);
    expect([70, 140, 280, 560, 1120]).toContain(out.budget);
    // native ~ (608*432)/2304 ≈ 114 → tier 140
    expect(out.budget).toBeLessThanOrEqual(280);
  });

  it('oversized crop downscales, caps at 1120', async () => {
    const out = await canonicalizeAdaptive(await png(4000, 3000));
    expect(out.budget).toBe(1120);
    expect(out.tokens).toBeLessThanOrEqual(1120);
    const m = await meta(out.png);
    expect(m.w % UNIT).toBe(0);
    expect(m.h % UNIT).toBe(0);
  });
});
