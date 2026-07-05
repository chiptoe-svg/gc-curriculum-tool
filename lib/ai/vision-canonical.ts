/**
 * Gemma-4 canonical vision geometry (closed-form, no I/O).
 *
 * The model encodes an image to soft tokens on a fixed grid:
 *   patch = 16px, pool = 3  →  every 48×48 px block → 1 soft token
 *   tokens = (W/16)·(H/16)/9 = W·H / 2304
 *
 * To hit a per-task token budget B *exactly to the model's advertised tier*, we
 * render each image to canonical dims: aspect-exact width on the 48-grid, height
 * padded (white, bottom) to the 48-grid. Flooring keeps tokens ≤ B (a hair under),
 * so the router's ceiling check (`tokens ≤ B`, `dims % 48 == 0`) always passes.
 * See docs/superpowers/plans/2026-07-04-vision-canonical-render-unify.md and the
 * render contract handed to the DGX.
 */

export const PATCH = 16;
export const POOL = 3;
export const UNIT = PATCH * POOL; // 48 — dims must be multiples of this
export const PX_PER_TOKEN = PATCH * PATCH * POOL * POOL; // 2304 (a token = a 3×3 pool of 16×16 patches)
export const SOFT_TOKEN_TIERS = [70, 140, 280, 560, 1120] as const;
export type SoftTokenTier = (typeof SOFT_TOKEN_TIERS)[number];

/** Soft tokens for a W×H image. Exact integer when W,H are multiples of 48. */
export function tokensForDims(w: number, h: number): number {
  return Math.round((Math.floor(w / PATCH) * Math.floor(h / PATCH)) / (POOL * POOL));
}

export interface CanonicalDims {
  /** Final image width, multiple of 48. */
  width: number;
  /** Aspect-exact content height to render to (before bottom padding). */
  contentHeight: number;
  /** Final image height (content + white bottom pad), multiple of 48. */
  height: number;
  /** Actual soft tokens for width×height — guaranteed ≤ B. */
  tokens: number;
}

/**
 * Canonical render dims for budget `B` and a source of `srcW × srcH`.
 * Zero aspect distortion: width is the 48-floor, contentHeight = width/aspect
 * (exact), height pads the bottom up to the 48-grid. The guard steps width down
 * one unit if the white pad would push tokens over B.
 */
export function canonicalDims(B: number, srcW: number, srcH: number): CanonicalDims {
  const a = srcW / srcH; // aspect W/H
  let width = Math.floor(Math.sqrt(B * PX_PER_TOKEN * a) / UNIT) * UNIT;

  const at = (w: number) => {
    const contentHeight = w / a;
    const height = Math.ceil(contentHeight / UNIT) * UNIT;
    return { contentHeight, height, tokens: tokensForDims(w, height) };
  };

  let d = at(width);
  while (d.tokens > B && width > UNIT) {
    width -= UNIT;
    d = at(width);
  }
  return { width, contentHeight: Math.round(d.contentHeight), height: d.height, tokens: d.tokens };
}

/**
 * Adaptive caption budget: render the crop at its native resolution, then declare
 * the smallest supported tier ≥ the rendered token count (capped at 1120). Small
 * crops ride native at a low tier; large crops cap at the top tier.
 */
export function pickCaptionBudget(renderedTokens: number): SoftTokenTier {
  return SOFT_TOKEN_TIERS.find((t) => t >= renderedTokens) ?? 1120;
}
