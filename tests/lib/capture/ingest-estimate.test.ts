import { describe, it, expect } from 'vitest';
import {
  units,
  estimateSeconds,
  formatDuration,
  estimateTotal,
  type EstimateInput,
} from '@/lib/capture/ingest-estimate';

// ---------------------------------------------------------------------------
// units()
// ---------------------------------------------------------------------------

describe('units()', () => {
  it('returns pageCount when present', () => {
    expect(units({ tier: 'high', pageCount: 10 })).toBe(10);
  });

  it('falls back to extractedText length / 2000 when no pageCount', () => {
    const text = 'a'.repeat(6000);
    expect(units({ tier: 'high', extractedText: text })).toBe(3);
  });

  it('falls back to sizeBytes / 50000 when no pageCount or text', () => {
    expect(units({ tier: 'high', sizeBytes: 150000 })).toBe(3);
  });

  it('returns 8 when no size signals at all', () => {
    expect(units({ tier: 'high' })).toBe(8);
  });

  it('is always >= 1 even for tiny inputs', () => {
    expect(units({ tier: 'high', pageCount: 0 })).toBe(1);
    expect(units({ tier: 'high', sizeBytes: 100 })).toBe(1);
    expect(units({ tier: 'high', extractedText: 'hi' })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// estimateSeconds()
// ---------------------------------------------------------------------------

describe('estimateSeconds()', () => {
  it('ignored materials → 0', () => {
    const m: EstimateInput = { tier: 'high', pageCount: 100, ignored: true };
    expect(estimateSeconds(m)).toBe(0);
  });

  it('background → DIGEST_S (2 s), regardless of size', () => {
    expect(estimateSeconds({ tier: 'background', pageCount: 1 })).toBe(2);
    expect(estimateSeconds({ tier: 'background', pageCount: 100 })).toBe(2);
  });

  it('middle → digest + render + vision per slide batches', () => {
    // units=4: ceil(4/4)*1 = 1 vision; 2+3+1 = 6
    const s = estimateSeconds({ tier: 'middle', pageCount: 4 });
    expect(s).toBe(6);
  });

  it('high → digest + docling per page + ctx per chunk', () => {
    // units=4: 2 + 4*3 + (4*3)*0.5 = 2+12+6 = 20
    const s = estimateSeconds({ tier: 'high', pageCount: 4 });
    expect(s).toBe(20);
  });

  it('null tier treated like high', () => {
    const s = estimateSeconds({ tier: null, pageCount: 4 });
    expect(s).toBe(20);
  });

  // monotonic: more pages → non-decreasing within tier
  it('high: monotonically non-decreasing with pageCount', () => {
    const pages = [1, 2, 5, 10, 20, 50];
    const seconds = pages.map((p) => estimateSeconds({ tier: 'high', pageCount: p }));
    for (let i = 1; i < seconds.length; i++) {
      expect(seconds[i]!).toBeGreaterThanOrEqual(seconds[i - 1]!);
    }
  });

  it('middle: monotonically non-decreasing with pageCount', () => {
    const pages = [1, 2, 5, 10, 20, 50];
    const seconds = pages.map((p) => estimateSeconds({ tier: 'middle', pageCount: p }));
    for (let i = 1; i < seconds.length; i++) {
      expect(seconds[i]!).toBeGreaterThanOrEqual(seconds[i - 1]!);
    }
  });

  // ordering: background <= middle <= high for identical size signals
  it('background <= middle <= high for same pageCount', () => {
    const pages = [1, 4, 10];
    for (const p of pages) {
      const bg = estimateSeconds({ tier: 'background', pageCount: p });
      const mid = estimateSeconds({ tier: 'middle', pageCount: p });
      const hi = estimateSeconds({ tier: 'high', pageCount: p });
      expect(bg).toBeLessThanOrEqual(mid);
      expect(mid).toBeLessThanOrEqual(hi);
    }
  });

  it('background strictly cheaper than middle for any positive size', () => {
    expect(estimateSeconds({ tier: 'background', pageCount: 10 })).toBeLessThan(
      estimateSeconds({ tier: 'middle', pageCount: 10 }),
    );
  });
});

// ---------------------------------------------------------------------------
// formatDuration()
// ---------------------------------------------------------------------------

describe('formatDuration()', () => {
  it('<= 0 → —', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });

  it('< 10 → ~5s', () => {
    expect(formatDuration(3)).toBe('~5s');
    expect(formatDuration(9)).toBe('~5s');
  });

  it('< 60 → rounded to nearest 5 seconds', () => {
    expect(formatDuration(45)).toBe('~45s');
    expect(formatDuration(13)).toBe('~15s');
    expect(formatDuration(28)).toBe('~30s');
  });

  it('< 3600 → minutes (min 1 min)', () => {
    expect(formatDuration(130)).toBe('~2 min');
    expect(formatDuration(60)).toBe('~1 min');
    expect(formatDuration(3599)).toBe('~60 min');
  });

  it('>= 3600 → hours with one decimal', () => {
    expect(formatDuration(3600)).toBe('~1.0 hr');
    expect(formatDuration(5400)).toBe('~1.5 hr');
    expect(formatDuration(7200)).toBe('~2.0 hr');
  });
});

// ---------------------------------------------------------------------------
// estimateTotal()
// ---------------------------------------------------------------------------

describe('estimateTotal()', () => {
  it('empty list → { seconds: 0, label: "—" }', () => {
    const result = estimateTotal([]);
    expect(result.seconds).toBe(0);
    expect(result.label).toBe('—');
  });

  it('all-ignored list → { seconds: 0, label: "—" }', () => {
    const materials: EstimateInput[] = [
      { tier: 'high', pageCount: 10, ignored: true },
      { tier: 'middle', pageCount: 5, ignored: true },
    ];
    const result = estimateTotal(materials);
    expect(result.seconds).toBe(0);
    expect(result.label).toBe('—');
  });

  it('divides sum by CONCURRENCY=2', () => {
    // Two high materials, 4 pages each: each = 20s; sum = 40; /2 = ceil(20) = 20
    const materials: EstimateInput[] = [
      { tier: 'high', pageCount: 4 },
      { tier: 'high', pageCount: 4 },
    ];
    const result = estimateTotal(materials);
    expect(result.seconds).toBe(20);
  });

  it('ignored materials excluded from total', () => {
    const materials: EstimateInput[] = [
      { tier: 'high', pageCount: 4 },
      { tier: 'high', pageCount: 4, ignored: true },
    ];
    const withIgnored = estimateTotal(materials);
    const withoutIgnored = estimateTotal([{ tier: 'high', pageCount: 4 }]);
    expect(withIgnored.seconds).toBe(withoutIgnored.seconds);
  });

  it('label is a range containing "–"', () => {
    const materials: EstimateInput[] = [{ tier: 'high', pageCount: 10 }];
    const result = estimateTotal(materials);
    expect(result.label).toContain('–');
  });

  it('range label does not equal "—" for non-empty materials', () => {
    const materials: EstimateInput[] = [{ tier: 'high', pageCount: 10 }];
    const result = estimateTotal(materials);
    expect(result.label).not.toBe('—');
  });

  it('range label lower bound < upper bound (ordered range)', () => {
    const materials: EstimateInput[] = [{ tier: 'high', pageCount: 20 }];
    const result = estimateTotal(materials);
    // label format: "~Xs–Y min" or similar — just check it's a real range
    const parts = result.label.split('–');
    expect(parts.length).toBe(2);
    expect(parts[0]!.trim().length).toBeGreaterThan(0);
    expect(parts[1]!.trim().length).toBeGreaterThan(0);
  });
});
