import { describe, it, expect } from 'vitest';
import { depthBand } from '@/lib/program/depth-band';

describe('depthBand', () => {
  it('maps the 0-5 scale into the four bands', () => {
    expect(depthBand(0)).toEqual({ key: 'none', short: '—', word: 'not present' });
    expect(depthBand(1)).toEqual({ key: 'low', short: 'L', word: 'low (1–2)' });
    expect(depthBand(2)).toEqual({ key: 'low', short: 'L', word: 'low (1–2)' });
    expect(depthBand(3)).toEqual({ key: 'working', short: 'W', word: 'working (3)' });
    expect(depthBand(4)).toEqual({ key: 'high', short: 'H', word: 'high (4–5)' });
    expect(depthBand(5)).toEqual({ key: 'high', short: 'H', word: 'high (4–5)' });
  });

  it('passes null through (no data ≠ a band)', () => {
    expect(depthBand(null)).toBeNull();
  });

  it('clamps out-of-range values rather than throwing', () => {
    expect(depthBand(-1)!.key).toBe('none');
    expect(depthBand(7)!.key).toBe('high');
  });
});
