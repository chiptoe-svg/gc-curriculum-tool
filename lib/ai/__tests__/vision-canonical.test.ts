import { describe, it, expect } from 'vitest';
import {
  canonicalDims,
  tokensForDims,
  pickCaptionBudget,
  UNIT,
} from '@/lib/ai/vision-canonical';

describe('canonicalDims — matches the render contract test vectors', () => {
  // (aspect W:H, B) → expected {width, contentHeight, height, tokens}
  const cases: Array<[string, number, number, number, number, number, number]> = [
    // name,            srcW, srcH,  B,     width, height, tokens
    ['OCR Letter', 850, 1100, 1120, 1392, 1824, 1102],
    ['OCR 4:3', 4, 3, 1120, 1824, 1392, 1102],
    ['OCR 16:9', 16, 9, 1120, 2112, 1200, 1100],
    ['Slides 4:3', 4, 3, 560, 1248, 960, 520],
    ['Slides 16:9', 16, 9, 560, 1488, 864, 558],
    ['Caption 5:4', 5, 4, 280, 864, 720, 270],
  ];

  it.each(cases)('%s', (_n, sw, sh, B, width, height, tokens) => {
    const d = canonicalDims(B, sw, sh);
    expect(d.width).toBe(width);
    expect(d.height).toBe(height);
    expect(d.tokens).toBe(tokens);
  });

  it('always: dims on the 48-grid and tokens ≤ B', () => {
    const shapes: Array<[number, number]> = [[850, 1100], [4, 3], [16, 9], [1, 1], [3, 2], [11, 8.5]];
    for (const B of [70, 140, 280, 560, 1120]) {
      for (const [sw, sh] of shapes) {
        const d = canonicalDims(B, sw, sh);
        expect(d.width % UNIT).toBe(0);
        expect(d.height % UNIT).toBe(0);
        expect(d.tokens).toBeLessThanOrEqual(B);
        expect(tokensForDims(d.width, d.height)).toBe(d.tokens);
      }
    }
  });

  it('content aspect is exact (contentHeight = width / aspect)', () => {
    const d = canonicalDims(1120, 850, 1100);
    const a = 850 / 1100;
    expect(Math.abs(d.contentHeight - d.width / a)).toBeLessThan(1);
  });
});

describe('tokensForDims', () => {
  it('is the inverse of the grid', () => {
    expect(tokensForDims(1392, 1824)).toBe(1102);
    expect(tokensForDims(864, 720)).toBe(270);
  });
});

describe('pickCaptionBudget — smallest tier ≥ rendered tokens, capped 1120', () => {
  it.each([
    [50, 70],
    [70, 70],
    [200, 280],
    [280, 280],
    [500, 560],
    [900, 1120],
    [1120, 1120],
    [5000, 1120], // over the top tier → cap
  ])('rendered %i → tier %i', (rendered, tier) => {
    expect(pickCaptionBudget(rendered)).toBe(tier);
  });
});
