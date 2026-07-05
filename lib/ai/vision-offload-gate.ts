/**
 * Client-side WEIGHTED concurrency gate for DGX 26B vision requests.
 *
 * The Spark 26B serves everyone (chat + OCR/slides/captions) from ONE model.
 * High-resolution requests (max_soft_tokens=1120) are heavy on the vision encoder
 * and CRASH the whole server past ~4-5 concurrent — taking the model down for all
 * users, not just this job. The server cap doesn't protect against it, so we
 * govern it here: weight each in-flight request by its budget, cap total slots.
 *
 *   max_soft_tokens   slot cost (= B/560)   max concurrent of that budget
 *   280               0.5                    16
 *   560               1.0                    8
 *   1120              2.0                    4
 *
 * One PROCESS-GLOBAL gate governs the whole mix (e.g. 2×1120 + 4×560 = 8 slots).
 * 280/560 effectively flow freely (they just queue); 1120 is held to ~4 concurrent.
 * Raise/disable via VISION_OFFLOAD_SLOT_BUDGET once the DGX server-side patch lands.
 */

const SLOT_BUDGET = Math.max(1, Number(process.env.VISION_OFFLOAD_SLOT_BUDGET) || 8);

/** Slot cost for a budget — linear (B/560): 280→0.5, 560→1, 1120→2; capped at the total. */
export function slotCost(budget: number): number {
  return Math.min(budget / 560, SLOT_BUDGET);
}

interface Waiter {
  weight: number;
  grant: () => void;
}
interface GateState {
  used: number;
  waiters: Waiter[];
}

// Process-global (not a module const): OCR, slides and the caption proxy all run in
// the same Next server and must share ONE gate. globalThis survives Next's split
// module instances (same rationale as vision-offload-health).
const g = globalThis as unknown as { __gcVisionOffloadGate?: GateState };
const state: GateState = (g.__gcVisionOffloadGate ??= { used: 0, waiters: [] });

function pump(): void {
  // FIFO: the head waiter must fit before any behind it → no starvation of heavy
  // (1120) requests. The `used === 0` clause lets an over-budget request through
  // when the gate is otherwise idle (never happens for our tiers, but is safe).
  while (state.waiters.length > 0) {
    const head = state.waiters[0]!;
    if (state.used === 0 || state.used + head.weight <= SLOT_BUDGET) {
      state.waiters.shift();
      state.used += head.weight;
      head.grant();
    } else {
      break;
    }
  }
}

/** Acquire weighted slots for a DGX request of the given budget; returns an (idempotent) release fn. */
export async function acquireVisionSlot(budget: number): Promise<() => void> {
  const w = slotCost(budget);
  await new Promise<void>((resolve) => {
    state.waiters.push({ weight: w, grant: resolve });
    pump();
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.used = Math.max(0, state.used - w);
    pump();
  };
}

/** Run `fn` while holding weighted slots for `budget` (DGX requests only). */
export async function withVisionSlot<T>(budget: number, fn: () => Promise<T>): Promise<T> {
  const release = await acquireVisionSlot(budget);
  try {
    return await fn();
  } finally {
    release();
  }
}
