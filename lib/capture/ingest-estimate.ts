/**
 * Pure time-estimate model for tiered ingestion.
 *
 * Gives faculty a coarse decision-support estimate (not a precise timer) for
 * how long ingesting each material will take, plus a wall-clock range for the
 * full set (accounting for parallel processing).
 *
 * No I/O — pure functions.
 */

// ---------------------------------------------------------------------------
// Tunable constants — calibrated from [ingest] stage logs + ~1s/slide vision
// ---------------------------------------------------------------------------

const DIGEST_S = 2; // fast digest pass (all tiers)
const DOCLING_S_PER_PAGE = 3; // Docling PDF extraction per page
const CTX_S_PER_CHUNK = 0.5; // context embedding per chunk
const VISION_S_PER_SLIDE = 1; // vision model per slide
const SLIDE_CONCURRENCY = 4; // slides processed in parallel within one material
const CONCURRENCY = 2; // matches ingest-queue MAX_CONCURRENCY

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EstimateInput {
  tier: 'high' | 'middle' | 'background' | null;
  pageCount?: number | null;
  extractedText?: string | null;
  sizeBytes?: number | null;
  ignored?: boolean;
}

// ---------------------------------------------------------------------------
// units() — rough page/slide/section count proxy
// ---------------------------------------------------------------------------

/**
 * Returns a rough unit count for a material using the best available signal.
 * Always >= 1.
 */
export function units(m: EstimateInput): number {
  let raw: number;

  if (m.pageCount != null) {
    raw = m.pageCount;
  } else if (m.extractedText != null) {
    raw = Math.ceil(m.extractedText.length / 2000);
  } else if (m.sizeBytes != null) {
    raw = Math.ceil(m.sizeBytes / 50000);
  } else {
    raw = 8;
  }

  return Math.max(1, raw);
}

// ---------------------------------------------------------------------------
// estimateSeconds() — per-material wall-clock estimate
// ---------------------------------------------------------------------------

/**
 * Returns estimated seconds for a single material.
 * Rounds to a whole number. Ignored materials → 0.
 */
export function estimateSeconds(m: EstimateInput): number {
  if (m.ignored) return 0;

  const u = units(m);

  if (m.tier === 'background') {
    return DIGEST_S;
  }

  if (m.tier === 'middle') {
    // slides: render pass + per-slide vision (batched at SLIDE_CONCURRENCY)
    const visionBatches = Math.ceil(u / SLIDE_CONCURRENCY);
    return Math.round(DIGEST_S + 3 /* render */ + visionBatches * VISION_S_PER_SLIDE);
  }

  // 'high' or null — full pipeline
  const chunks = u * 3; // ~3 chunks per page/unit
  return Math.round(DIGEST_S + u * DOCLING_S_PER_PAGE + chunks * CTX_S_PER_CHUNK);
}

// ---------------------------------------------------------------------------
// formatDuration() — human-readable bucket label
// ---------------------------------------------------------------------------

/**
 * Formats a duration in seconds as a coarse human-readable string.
 *
 * Buckets:
 *   <= 0        → '—'
 *   < 10        → '~5s'
 *   < 60        → '~Xs' rounded to nearest 5
 *   < 3600      → '~N min' (min 1)
 *   >= 3600     → '~N.M hr'
 */
export function formatDuration(s: number): string {
  if (s <= 0) return '—';
  if (s < 10) return '~5s';
  if (s < 60) {
    const rounded = Math.round(s / 5) * 5;
    return `~${rounded}s`;
  }
  if (s < 3600) {
    const mins = Math.max(1, Math.round(s / 60));
    return `~${mins} min`;
  }
  return `~${(s / 3600).toFixed(1)} hr`;
}

// ---------------------------------------------------------------------------
// estimateTotal() — concurrency-adjusted wall-clock total
// ---------------------------------------------------------------------------

/**
 * Returns total wall-clock estimate for a set of materials, accounting for
 * parallel processing (CONCURRENCY=2).
 *
 * Wall-clock ≈ sum(individual seconds) / CONCURRENCY.
 * Label is a ±range (×0.7 to ×1.4) to communicate coarseness.
 *
 * Returns { seconds: 0, label: '—' } if no non-ignored materials.
 */
export function estimateTotal(materials: EstimateInput[]): { seconds: number; label: string } {
  const sum = materials
    .filter((m) => !m.ignored)
    .reduce((acc, m) => acc + estimateSeconds(m), 0);

  if (sum === 0) return { seconds: 0, label: '—' };

  const seconds = Math.ceil(sum / CONCURRENCY);

  const lo = Math.round(seconds * 0.7);
  const hi = Math.round(seconds * 1.4);

  const loLabel = formatDuration(lo);
  // Strip leading '~' from upper bound so it reads "~30s–1 min" not "~30s–~1 min"
  const hiLabel = formatDuration(hi).replace(/^~/, '');

  const label = `${loLabel}–${hiLabel}`;

  return { seconds, label };
}
