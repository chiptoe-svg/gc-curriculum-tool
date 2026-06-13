import { describe, it, expect } from 'vitest';
import {
  RELIABILITY_THRESHOLDS,
  LAST_MEASURED,
  reliabilityForModel,
} from '@/lib/program/reliability-summary';

describe('RELIABILITY_THRESHOLDS', () => {
  it('has all three required dimension keys', () => {
    expect(typeof RELIABILITY_THRESHOLDS.k).toBe('number');
    expect(typeof RELIABILITY_THRESHOLDS.u).toBe('number');
    expect(typeof RELIABILITY_THRESHOLDS.d).toBe('number');
  });

  it('floors are in sane range (0–1)', () => {
    expect(RELIABILITY_THRESHOLDS.k).toBeGreaterThan(0);
    expect(RELIABILITY_THRESHOLDS.k).toBeLessThan(1);
    expect(RELIABILITY_THRESHOLDS.u).toBeGreaterThan(0);
    expect(RELIABILITY_THRESHOLDS.u).toBeLessThan(1);
    expect(RELIABILITY_THRESHOLDS.d).toBeGreaterThan(0);
    expect(RELIABILITY_THRESHOLDS.d).toBeLessThan(1);
  });

  it('floors are below the observed-good heavy numbers from Part 2b', () => {
    // K=.82, U=1.0, D=.73 — thresholds must be below these to avoid false alarms
    expect(RELIABILITY_THRESHOLDS.k).toBeLessThan(0.82);
    expect(RELIABILITY_THRESHOLDS.u).toBeLessThan(1.0);
    expect(RELIABILITY_THRESHOLDS.d).toBeLessThan(0.73);
  });

  it('floors are far above the mini failure floor (0.25)', () => {
    expect(RELIABILITY_THRESHOLDS.k).toBeGreaterThan(0.25);
    expect(RELIABILITY_THRESHOLDS.u).toBeGreaterThan(0.25);
    expect(RELIABILITY_THRESHOLDS.d).toBeGreaterThan(0.25);
  });
});

describe('reliabilityForModel', () => {
  it('returns the seed entry for gpt-5.5', () => {
    const entry = reliabilityForModel('gpt-5.5');
    expect(entry).not.toBeNull();
    expect(entry!.date).toBe('2026-06-13');
    expect(entry!.k).toBeCloseTo(0.817);
    expect(entry!.u).toBe(1.0);
    expect(entry!.d).toBeCloseTo(0.733);
    expect(entry!.withinOneD).toBe(1.0);
    expect(entry!.source).toContain('Part 2b');
  });

  it('returns null for an unknown model', () => {
    expect(reliabilityForModel('gpt-4o-mini')).toBeNull();
    expect(reliabilityForModel('unknown-model-xyz')).toBeNull();
    expect(reliabilityForModel('')).toBeNull();
  });

  it('LAST_MEASURED seed contains gpt-5.5', () => {
    expect('gpt-5.5' in LAST_MEASURED).toBe(true);
  });
});
