import { describe, it, expect } from 'vitest';
import { softTokenKnob, visionModel } from '../vision-models';

describe('softTokenKnob — the Gemma-only omlx resolution knob', () => {
  it('is sent for a Gemma model with a budget', () => {
    expect(softTokenKnob('gemma-4-12B-it-qat-4bit', 560)).toEqual({ vision_soft_tokens_per_image: 560 });
  });
  it('is never sent for Qwen (stock omlx must not receive it)', () => {
    expect(softTokenKnob('Qwen3.6-35B-A3B-UD-MLX-4bit', 560)).toEqual({});
  });
  it('is not sent without a budget', () => {
    expect(softTokenKnob('gemma-4-12B-it-qat-4bit', undefined)).toEqual({});
    expect(softTokenKnob('gemma-4-12B-it-qat-4bit', null)).toEqual({});
  });
});

describe('vision registry defaults contain no Gemma', () => {
  it('every task defaults to Qwen when its env var is unset', () => {
    const saved = { ...process.env };
    delete process.env.SLIDE_VISION_MODEL; delete process.env.LOCAL_VISION_MODEL; delete process.env.DOCLING_VLM_MODEL;
    try {
      for (const t of ['slideNote', 'docTranscribe', 'docPicture'] as const) {
        expect(visionModel(t).model).not.toMatch(/gemma/i);
      }
    } finally { process.env = saved; }
  });
});
