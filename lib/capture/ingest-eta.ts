/**
 * Upfront, self-correcting ingest ETA (issue #4 / image-PDF routing).
 *
 * The dominant cost for image-heavy decks is per-page qwen vision transcription.
 * We anchor at the Spark-measured 1.25 s/page, divided by the shared-prod
 * concurrency ceiling, plus a flat per-material overhead for the digest +
 * chunk-contextualize + embed tail. This is a live estimate, never a promise:
 * qwen is the shared prod model, so wall time drifts with load — the caller
 * re-derives it as real completions land.
 */
const SEC_PER_PAGE = 1.25; // Spark-measured qwen anchor
const CONCURRENCY = 6; // shared-prod ceiling (backfills off-peak)
const PER_MATERIAL_OVERHEAD = 15; // digest + chunk-contextualize + embed, rough

export function estimateIngestSeconds(
  items: Array<{ pageCount: number; imageHeavy: boolean }>,
): number {
  return items.reduce((acc, m) => {
    const qwen = m.imageHeavy ? (Math.max(m.pageCount, 1) * SEC_PER_PAGE) / CONCURRENCY : 0;
    return acc + qwen + PER_MATERIAL_OVERHEAD;
  }, 0);
}
