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
 * The gemma `vision_soft_tokens_per_image` budget requires the PATCHED omlx stack
 * (mlx-vlm #1426 + omlx #1986 — the resolution knob); see ~/.dev-ports.yaml. A
 * budget sent to a non-gemma model (e.g. Qwen) is harmlessly ignored.
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
      return { model: s('SLIDE_VISION_MODEL') ?? 'gemma-4-12B-it-qat-4bit', budget: n('SLIDE_VISION_BUDGET') ?? 560 };
    case 'docTranscribe':
      return { model: s('LOCAL_VISION_MODEL') ?? 'gemma-4-26B-A4B-it-QAT-MLX-4bit', budget: n('LOCAL_VISION_BUDGET') ?? 1120 };
    case 'docPicture':
      return { model: s('DOCLING_VLM_MODEL') ?? 'gemma-4-12B-it-qat-4bit' };
  }
}
