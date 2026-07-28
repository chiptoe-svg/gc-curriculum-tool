/**
 * Global concurrency gate for docling-serve conversions.
 *
 * docling-serve on the Spark runs `--gpus all` with no CUDA memory cap, and has no
 * internal worker/concurrency limit — so N concurrent conversions scale GPU memory by
 * N. Measured per-conversion pressure is modest, but a burst (many PDFs, or a very
 * large one) could exceed the box. We bound total in-flight conversions app-side here
 * (no Spark-side change / restart needed), regardless of how many workers or callers
 * fire docling at once. Default 2; override with DOCLING_MAX_CONCURRENCY.
 */
const DOCLING_MAX_CONCURRENCY = Math.max(1, Number(process.env.DOCLING_MAX_CONCURRENCY ?? 2));

let active = 0;
const waiters: Array<() => void> = [];

export async function withDoclingSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= DOCLING_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}
