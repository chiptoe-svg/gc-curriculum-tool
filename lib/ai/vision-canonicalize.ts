/**
 * Render a raw page/slide/crop image to Gemma-4 canonical dims for a soft-token
 * budget: resize aspect-exact to the 48-grid width, pad the bottom white to the
 * 48-grid height. The result feeds the model at exactly `tokens` (≤ budget) soft
 * tokens on either backend (DGX `max_soft_tokens=B` / omlx `vision_soft_tokens_per_image=B`).
 *
 * Caller should render the raw source at a resolution ≥ the canonical width so this
 * only ever downscales (crisp); upscaling a too-small source adds no detail.
 */
import sharp from 'sharp';
import {
  canonicalDims,
  tokensForDims,
  pickCaptionBudget,
  UNIT,
  type SoftTokenTier,
} from './vision-canonical';

export interface CanonicalImage {
  /** Canonical PNG (dims are multiples of 48). */
  png: Buffer;
  /** Actual soft tokens the model will see (≤ budget). */
  tokens: number;
  /** Budget B to send as max_soft_tokens (DGX) / vision_soft_tokens_per_image (omlx). */
  budget: number;
  width: number;
  height: number;
}

async function dims(raw: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(raw).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error('canonicalize: could not read source image dimensions');
  return { w, h };
}

/** Fixed-budget canonicalization — OCR (B=1120) and slides (B=560). */
export async function canonicalize(raw: Buffer, budget: number): Promise<CanonicalImage> {
  const { w, h } = await dims(raw);
  const d = canonicalDims(budget, w, h);
  let pipe = sharp(raw).resize(d.width, d.contentHeight, { fit: 'fill' });
  const pad = d.height - d.contentHeight;
  if (pad > 0) pipe = pipe.extend({ bottom: pad, background: '#ffffff' });
  const png = await pipe.png().toBuffer();
  return { png, tokens: d.tokens, budget, width: d.width, height: d.height };
}

/**
 * Adaptive canonicalization — Docling figure captions. Ride the crop's NATIVE
 * resolution (pad up to the 48-grid, no upscale) and pick the smallest tier that
 * fits; only downscale when the crop already exceeds the top tier.
 */
export async function canonicalizeAdaptive(raw: Buffer): Promise<CanonicalImage> {
  const { w, h } = await dims(raw);
  // Native token count if we snap the crop up to the 48-grid (no scaling).
  const padW = Math.ceil(w / UNIT) * UNIT;
  const padH = Math.ceil(h / UNIT) * UNIT;
  const nativeTokens = tokensForDims(padW, padH);
  if (nativeTokens > 1120) {
    return canonicalize(raw, 1120); // too big → downscale to the top tier
  }
  const budget: SoftTokenTier = pickCaptionBudget(nativeTokens);
  const png = await sharp(raw)
    .extend({ right: padW - w, bottom: padH - h, background: '#ffffff' })
    .png()
    .toBuffer();
  return { png, tokens: nativeTokens, budget, width: padW, height: padH };
}
