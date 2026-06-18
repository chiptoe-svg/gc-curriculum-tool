import { describe, it, expect, afterEach } from 'vitest';
import { isTriageEnabled } from '@/lib/capture/triage-flag';

const orig = process.env.COURSECAPTURE_TRIAGE;
afterEach(() => {
  if (orig === undefined) delete process.env.COURSECAPTURE_TRIAGE;
  else process.env.COURSECAPTURE_TRIAGE = orig;
});

describe('isTriageEnabled', () => {
  it('is false by default (flag absent)', () => {
    delete process.env.COURSECAPTURE_TRIAGE;
    expect(isTriageEnabled()).toBe(false);
  });
  it('is true only for "1"', () => {
    process.env.COURSECAPTURE_TRIAGE = '1';
    expect(isTriageEnabled()).toBe(true);
    process.env.COURSECAPTURE_TRIAGE = 'true';
    expect(isTriageEnabled()).toBe(false); // strict: only '1' enables
  });
});
