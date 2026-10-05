/**
 * Single source of truth for the local (omlx) vision model + resolution budget
 * per ingestion vision task.
 *
 * Ingestion has three distinct vision touchpoints that were previously configured
 * independently across three files/envs; this consolidates them into one place.
 * Defaults are the 2026-06-23 vision benchmarks' winners (see
 * docs/superpowers/pilot/2026-06-23-slide-note-bench-results.md). Each is
 * env-overridable, read lazily (per call) so a runtime env change takes effect.
 *
 * 2026-10-05 (owner decision "no more Gemma as backup"): every local fallback is
 * Qwen3.6-35B-A3B on stock omlx. The Gemma-only `vision_soft_tokens_per_image`
 * resolution knob (which needed the patched omlx fork) is now sent ONLY when the
 * resolved model is a Gemma — see softTokenKnob() — so nothing depends on the fork.
 * The June bench found Gemma-26B better at transcription; accepted, because the
 * local leg is only the fallback when the Spark offload fails.
 */
export interface VisionTask {
  /** omlx model id. */
  model: string;
  /** gemma soft-token budget (image resolution); undefined = model default. */
  budget?: number;
}

const s = (k: string): string | undefined => process.env[k]?.trim() || undefined;
const n = (k: string): number | undefined => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

export type VisionTaskName = 'slideNote' | 'docTranscribe' | 'docPicture';

/**
 * Resolve the model + budget for a vision task.
 *  - slideNote     — middle-tier `describeSlide` notes. gemma-12B @ 560 (describe
 *                    bench winner; ~+4% over default resolution).
 *  - docTranscribe — image-PDF OCR in "use local" mode. gemma-26B-A4B @ 1120
 *                    (transcription bench winner; beats Qwen-35B on quality + speed).
 *  - docPicture    — Docling embedded-chart/diagram captioning. gemma-12B
 *                    (light; dropped from the heavyweight 35B — captions don't
 *                    need it, and it was firing once per image on the shared omlx).
 */
export function visionModel(task: VisionTaskName): VisionTask {
  switch (task) {
    case 'slideNote':
      return { model: s('SLIDE_VISION_MODEL') ?? 'Qwen3.6-35B-A3B-UD-MLX-4bit', budget: n('SLIDE_VISION_BUDGET') ?? 560 };
    case 'docTranscribe':
      return { model: s('LOCAL_VISION_MODEL') ?? 'Qwen3.6-35B-A3B-UD-MLX-4bit', budget: n('LOCAL_VISION_BUDGET') ?? 1120 };
    case 'docPicture':
      return { model: s('DOCLING_VLM_MODEL') ?? 'Qwen3.6-35B-A3B-UD-MLX-4bit' };
  }
}

/** Default local (omlx) model for every vision fallback and for LOCAL_MODEL. */
export const DEFAULT_LOCAL_VISION_MODEL = 'Qwen3.6-35B-A3B-UD-MLX-4bit';

/**
 * The omlx `vision_soft_tokens_per_image` resolution knob, ONLY for Gemma models
 * (it exists only in the patched omlx/mlx-vlm fork and only Gemma reads it).
 * Returns {} for any other model, so stock omlx never receives it.
 */
export function softTokenKnob(model: string, budget: number | null | undefined): Record<string, number> {
  return budget && /^gemma/i.test(model) ? { vision_soft_tokens_per_image: budget } : {};
}
