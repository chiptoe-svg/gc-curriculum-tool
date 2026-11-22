import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { priceFor, costUsdCents, costCredits, whisperCostUnits, hasPrice } from '@/lib/ai/prices';
import { CAMPUS_MODELS } from '@/lib/ai/models';

describe('priceFor: dated lookup', () => {
  it('uses the entry in force on the date', () => {
    // gpt-6.1-sol: list 2.0/10.0 with cached at 10% from 2026-10-05; Clemson 5% cached from 2026-11-21.
    expect(priceFor('gpt-6.1-sol', new Date('2026-11-01')).cachedInput).toBeCloseTo(0.2, 10);
    expect(priceFor('gpt-6.1-sol', new Date('2026-11-25')).cachedInput).toBeCloseTo(0.1, 10);
  });
  it('switches on the boundary day itself', () => {
    expect(priceFor('gpt-6.1-sol', new Date('2026-11-20T23:59:59Z')).from).toBe('2026-10-05');
    expect(priceFor('gpt-6.1-sol', new Date('2026-11-21T00:00:00Z')).from).toBe('2026-11-21');
    expect(priceFor('gpt-6.1-sol', new Date('2026-11-21T23:59:59Z')).from).toBe('2026-11-21');
  });
  it('defaults to now (newest entry)', () => {
    expect(priceFor('gpt-6.1-terra').cachedInput).toBeCloseTo(0.05, 10);
  });
  it('a model with no entry yet on that date falls back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(priceFor('gpt-6.1-terra', new Date('2026-09-01')).source).toMatch(/fallback/);
    warn.mockRestore();
  });
});

describe('priceFor: campus and unknown', () => {
  it('campus models are free', () => {
    for (const m of CAMPUS_MODELS) {
      const p = priceFor(m);
      expect([p.input, p.cachedInput, p.output]).toEqual([0, 0, 0]);
    }
    expect(costUsdCents(CAMPUS_MODELS[0]!, { freshInput: 1e6, cachedInput: 1e6, output: 1e6 })).toBe(0);
    expect(hasPrice(CAMPUS_MODELS[0]!)).toBe(true);
  });
  describe('unknown model', () => {
    beforeEach(() => vi.restoreAllMocks());
    it('uses the fallback entry and warns once per model', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const a = priceFor('no-such-model-x');
      priceFor('no-such-model-x');
      expect(a.source).toMatch(/fallback/);
      expect([a.input, a.output]).toEqual([2.5, 15]);
      expect(warn).toHaveBeenCalledTimes(1);
      priceFor('no-such-model-y');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(hasPrice('no-such-model-x')).toBe(false);
    });
  });
});

describe('costUsdCents', () => {
  it('matches the Clemson worked example for gpt-6.1-sol: $3.10', () => {
    // 1M fresh ($2.00) + 1M cached ($0.10) + 100k output ($1.00) = $3.10 = 31000 units
    expect(costUsdCents('gpt-6.1-sol', { freshInput: 1_000_000, cachedInput: 1_000_000, output: 100_000 }, new Date('2026-11-21'))).toBe(31000);
  });
  it('before the Clemson date cached input was 10% of list (what the code computed then)', () => {
    // 2.00 + 0.20 + 1.00 = $3.20
    expect(costUsdCents('gpt-6.1-sol', { freshInput: 1_000_000, cachedInput: 1_000_000, output: 100_000 }, new Date('2026-11-01'))).toBe(32000);
  });
  it('rounds each term up on its own', () => {
    // gpt-4o 2.5/0.25/10 per M: 50 fresh -> 1.25 -> 2; 50 cached -> 0.125 -> 1; 20 out -> 2 : 5
    expect(costUsdCents('gpt-4o', { freshInput: 50, cachedInput: 50, output: 20 })).toBe(5);
  });
  it('charges Anthropic cache writes at 125% of input', () => {
    // sonnet 3.0/M: 1M writes = $3.75 = 37500 units
    expect(costUsdCents('claude-sonnet-4-6', { freshInput: 0, cachedInput: 0, output: 0, cacheWrite: 1_000_000 })).toBe(37500);
  });
  it('cache writes on a model with no write rate cost the fresh-input rate', () => {
    expect(costUsdCents('gpt-6.1-sol', { freshInput: 0, cachedInput: 0, output: 0, cacheWrite: 1_000_000 })).toBe(20000);
  });
});

describe('costCredits', () => {
  it('uses the measured RCD rates for gpt-6.1-sol', () => {
    expect(costCredits('gpt-6.1-sol', { freshInput: 1_000_000, cachedInput: 1_000_000, output: 100_000 })).toBeCloseTo(2.5 + 0.08 + 1.25, 10);
  });
  it('still finds the rate after a later USD entry', () => {
    expect(costCredits('gpt-6.1-sol', { freshInput: 1_000_000, cachedInput: 0, output: 0 }, new Date('2027-01-01'))).toBeCloseTo(2.5, 10);
  });
  it('is null with no rate known (or none yet on that date)', () => {
    expect(costCredits('gpt-5.4', { freshInput: 1, cachedInput: 0, output: 0 })).toBeNull();
    expect(costCredits('gpt-6.1-sol', { freshInput: 1, cachedInput: 0, output: 0 }, new Date('2026-10-01'))).toBeNull();
  });
});

describe('whisperCostUnits', () => {
  it('is $0.006 per minute = 60 units, rounded up', () => {
    expect(whisperCostUnits(1)).toBe(60);
    expect(whisperCostUnits(5)).toBe(300);
    expect(whisperCostUnits(0)).toBe(0);
    expect(whisperCostUnits(100 / (1024 * 1024))).toBe(1);
  });
});

// Guard: prices and cached-rate factors live only in lib/ai/prices.ts.
describe('guard: no price literals outside prices.ts', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const SKIP = new Set(['node_modules', '.next', '.git', '__tests__', 'tests', '.claude', 'coverage']);
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
    }
    return out;
  }
  const RULES: Array<[string, RegExp]> = [
    ['price table name', /\b(MODEL_PRICING|FALLBACK_PRICING)\b/],
    ['{ input: <n>, output: <n> } price object', /\binput:\s*(?!0\s*,)\d+(\.\d+)?\s*,\s*output:\s*\d/], // a zero usage object ({ input: 0, output: 0 }) is not a price
    ['cached-rate / cache-write factor on a price', /\.input\s*\*\s*(0\.1|1\.25)\b/],
    ['credit-rate literal', /cachedRead:\s*\d/],
    ['Whisper per-minute price', /\b0\.006\b/],
  ];
  it('finds none in lib/, app/, scripts/', () => {
    const hits: string[] = [];
    for (const top of ['lib', 'app', 'scripts']) {
      for (const file of walk(path.join(ROOT, top))) {
        if (file.endsWith(path.join('lib', 'ai', 'prices.ts'))) continue;
        const text = readFileSync(file, 'utf8');
        for (const [label, re] of RULES) if (re.test(text)) hits.push(`${path.relative(ROOT, file)}: ${label}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
