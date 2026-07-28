import { describe, it, expect } from 'vitest';
import { withDoclingSlot } from '@/lib/courses/docling-gate';

describe('withDoclingSlot', () => {
  it('caps concurrent docling conversions at the default (2)', async () => {
    let active = 0;
    let peak = 0;
    const task = () =>
      withDoclingSlot(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return 'ok';
      });
    const results = await Promise.all([task(), task(), task(), task(), task()]);
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('releases the slot even when the task throws', async () => {
    await expect(withDoclingSlot(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // A subsequent task still runs (slot was released).
    await expect(withDoclingSlot(async () => 'recovered')).resolves.toBe('recovered');
  });
});
