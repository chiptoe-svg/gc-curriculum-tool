import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkIngestCooldown,
  recordIngestStart,
  __resetIngestCooldownForTest,
  COOLDOWN_MS,
} from '@/lib/capture/ingest-cooldown';

describe('ingest cooldown (F2 — security review 2026-10-07)', () => {
  beforeEach(() => __resetIngestCooldownForTest());

  it('allows the first call for a course', () => {
    expect(checkIngestCooldown('GC 1010', 0)).toEqual({ allowed: true });
  });

  it('refuses a second call within the cooldown window, with seconds remaining', () => {
    recordIngestStart('GC 1010', 0);
    expect(checkIngestCooldown('GC 1010', 1000)).toEqual({ allowed: false, retryAfterSeconds: 59 });
  });

  it('allows again once the window has fully elapsed', () => {
    recordIngestStart('GC 1010', 0);
    expect(checkIngestCooldown('GC 1010', COOLDOWN_MS)).toEqual({ allowed: true });
  });

  it('is keyed per course — another course is unaffected', () => {
    recordIngestStart('GC 1010', 0);
    expect(checkIngestCooldown('GC 2020', 1000)).toEqual({ allowed: true });
  });

  it('rounds the remaining time up to a whole second', () => {
    recordIngestStart('GC 1010', 0);
    // 1ms into the window → 59999ms left → 59.999s → rounds up to 60
    expect(checkIngestCooldown('GC 1010', 1)).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});
