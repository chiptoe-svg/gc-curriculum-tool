/**
 * Shared "DGX offload with local fallback" for the vision paths (image-PDF OCR
 * and slide description).
 *
 * Architecture (2026-07-02): local omlx = real-time voice (whisper STT); the DGX
 * Spark (SGLang, Gemma-4-26B-A4B-NVFP4) = ALL vision, run at HIGH concurrency
 * because SGLang continuous-batches it (the volume win: ~100+ docs/min at conc 16
 * vs local's ~30/min ceiling). Any item that errors on the offload re-runs on the
 * local model at LOW concurrency — so a DGX outage never fans the high concurrency
 * at the memory-bound, voice-shared box.
 */

export interface VisionOffload {
  baseURL: string;
  model: string;
  apiKey: string;
  concurrency: number;
  /** Only offload batches of at least this many items; smaller ones stay local. */
  minItems: number;
}

/** `VISION_OFFLOAD_*` config, or null when unset (→ local only). Shared by OCR + slides. */
export function visionOffloadConfig(): VisionOffload | null {
  const baseURL = process.env.VISION_OFFLOAD_BASE_URL?.trim();
  const model = process.env.VISION_OFFLOAD_MODEL?.trim();
  if (!baseURL || !model) return null;
  return {
    baseURL,
    model,
    apiKey: process.env.VISION_OFFLOAD_API_KEY?.trim() || 'offload',
    concurrency: Math.max(1, Number.parseInt(process.env.VISION_OFFLOAD_CONCURRENCY ?? '12', 10) || 12),
    // Small/quick jobs stay on the local omlx (fast, and they clear before they
    // tie up the box that v2v needs); time-consuming jobs shunt to the DGX. The
    // default 4 matches the measured per-doc crossover (~4-5 items). Set 1 to
    // always offload; a huge number to keep everything local.
    minItems: Math.max(1, Number.parseInt(process.env.VISION_OFFLOAD_MIN_ITEMS ?? '4', 10) || 4),
  };
}

/** Should a batch of `count` items go to the DGX? (config present AND big enough) */
export function shouldOffload(off: VisionOffload | null, count: number): boolean {
  return !!off && count >= off.minItems;
}

async function pool(indices: number[], limit: number, fn: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < indices.length) await fn(indices[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, indices.length) }, worker));
}

/**
 * Two-phase over `count` items, results returned in index order.
 *   Phase 1 — `offload(i)` at `offloadConcurrency` (skipped when offload is null);
 *             any i whose offload throws is left for phase 2.
 *   Phase 2 — `local(i)` at `localConcurrency` for the not-yet-done indices.
 * `local` is the source of truth — if it throws, that propagates to the caller
 * (callers that must never throw should make `local` swallow + return a default).
 */
export async function twoPhaseOffload<T>(
  count: number,
  args: {
    offload: ((i: number) => Promise<T>) | null;
    local: (i: number) => Promise<T>;
    offloadConcurrency: number;
    localConcurrency: number;
    onFallback?: (fellBack: number, total: number, firstError: string | null) => void;
  },
): Promise<T[]> {
  const results = new Array<T | undefined>(count).fill(undefined);
  const done = new Array<boolean>(count).fill(false);

  if (args.offload) {
    let firstError: string | null = null;
    await pool([...Array(count).keys()], args.offloadConcurrency, async (i) => {
      try {
        results[i] = await args.offload!(i);
        done[i] = true;
      } catch (e) {
        firstError ??= (e as Error).message;
      }
    });
    const fellBack = done.filter((d) => !d).length;
    if (fellBack > 0) args.onFallback?.(fellBack, count, firstError);
  }

  const remaining = done.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
  if (remaining.length > 0) {
    await pool(remaining, args.localConcurrency, async (i) => {
      results[i] = await args.local(i);
    });
  }

  return results as T[];
}
