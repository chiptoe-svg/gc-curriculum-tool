import { describe, it, expect, vi } from 'vitest';

async function freshGate() {
  // globalThis-backed singleton — clear it so each test starts empty.
  delete (globalThis as unknown as { __gcVisionOffloadGate?: unknown }).__gcVisionOffloadGate;
  vi.resetModules();
  return import('@/lib/ai/vision-offload-gate');
}

const tick = () => new Promise((r) => setTimeout(r, 15));

describe('vision-offload weighted gate', () => {
  it('slotCost is linear B/560 (matches the DGX table)', async () => {
    const { slotCost } = await freshGate();
    expect(slotCost(280)).toBe(0.5);
    expect(slotCost(560)).toBe(1);
    expect(slotCost(1120)).toBe(2);
  });

  it('caps 1120 at 4 concurrent (8 slots / 2 each); the 5th blocks until a release', async () => {
    const { acquireVisionSlot } = await freshGate();
    const rels = await Promise.all([1120, 1120, 1120, 1120].map((b) => acquireVisionSlot(b)));

    let fifthGranted = false;
    const fifth = acquireVisionSlot(1120).then((r) => { fifthGranted = true; return r; });
    await tick();
    expect(fifthGranted).toBe(false); // 4×1120 = 8 slots, no room

    rels[0]!(); // free 2 slots
    const r5 = await fifth;
    expect(fifthGranted).toBe(true);

    rels.slice(1).forEach((r) => r());
    r5();
  });

  it('mixes budgets up to the slot budget (2×1120 + 4×560 = 8)', async () => {
    const { acquireVisionSlot } = await freshGate();
    const rels = await Promise.all(
      [1120, 1120, 560, 560, 560, 560].map((b) => acquireVisionSlot(b)),
    );
    expect(rels).toHaveLength(6); // all 6 granted (4 + 4 slots)

    let extraGranted = false;
    void acquireVisionSlot(560).then(() => { extraGranted = true; });
    await tick();
    expect(extraGranted).toBe(false); // would be slot 9

    rels.forEach((r) => r());
  });

  it('lets small (280) requests flow freely (16 at 0.5 each)', async () => {
    const { acquireVisionSlot } = await freshGate();
    const rels = await Promise.all(Array.from({ length: 16 }, () => acquireVisionSlot(280)));
    expect(rels).toHaveLength(16);
    rels.forEach((r) => r());
  });
});
