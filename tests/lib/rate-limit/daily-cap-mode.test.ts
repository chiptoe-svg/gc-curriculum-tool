import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The DB read is the only I/O in checkDailyCap; stub it so the test controls today's spend.
let spent = 0;
vi.mock('@/lib/db/client', () => ({ db: { execute: async () => ({ rows: [{ spent }] }) } }));

import { capMode, checkDailyCap } from '@/lib/rate-limit/daily-cap';

describe('capMode', () => {
  it('is warn only when explicitly set to warn', () => {
    expect(capMode('warn')).toBe('warn');
    expect(capMode(' WARN ')).toBe('warn');
    expect(capMode(undefined)).toBe('block');
    expect(capMode('anything-else')).toBe('block');
  });
});

describe('checkDailyCap', () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env.DAILY_COST_CAP_USD = '10'; });
  afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

  it('block mode refuses work once spend reaches the cap', async () => {
    delete process.env.DAILY_COST_CAP_MODE;
    spent = 100_000; // $10.00 in 1/100-cent units
    expect(await checkDailyCap()).toEqual({ ok: false, spentCents: 100_000, overCap: true });
  });

  it('warn mode never refuses, flags overCap, and logs once per day', async () => {
    process.env.DAILY_COST_CAP_MODE = 'warn';
    spent = 250_000; // $25
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await checkDailyCap()).toEqual({ ok: true, spentCents: 250_000, overCap: true });
    await checkDailyCap();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('under the cap both modes allow work', async () => {
    process.env.DAILY_COST_CAP_MODE = 'warn';
    spent = 10;
    expect(await checkDailyCap()).toEqual({ ok: true, spentCents: 10, overCap: false });
  });
});
