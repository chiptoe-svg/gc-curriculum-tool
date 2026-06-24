/**
 * Per-slide vision note via a local omlx vision model (gemma-4).
 *
 * Uses the OpenAI chat-completions protocol at LOCAL_BASE_URL with an
 * image_url data-URI part. On any failure (network, non-OK status, bad JSON,
 * parse error) returns a safe default so the calling worker can silently skip
 * uninformative slides without aborting the ingestion pipeline.
 */

import { visionModel } from '@/lib/ai/vision-models';

export interface SlideNote {
  topic: string;
  teaches: string;
  keyVisual: string;
  contentLevel: 'substantive' | 'low';
}

const SAFE_DEFAULT: SlideNote = {
  topic: '',
  teaches: '',
  keyVisual: '',
  contentLevel: 'low',
};

const TIMEOUT_MS = 60_000;

const INSTRUCTION =
  'You are a curriculum-analysis assistant. ' +
  'Examine the slide image and return STRICT JSON (no markdown fences, no extra keys) with exactly these fields:\n' +
  '{"topic": "<short topic label>", ' +
  '"teaches": "<what the slide teaches or intends students to learn>", ' +
  '"keyVisual": "<brief description of the dominant visual element>", ' +
  '"contentLevel": "substantive" | "low"}\n' +
  'Use contentLevel:"low" for title slides, agenda slides, dividers, thank-you slides, ' +
  'or any slide with no real instructional content. ' +
  'Use contentLevel:"substantive" for all other slides. ' +
  'Return only the JSON object.';

function coerce(raw: unknown): SlideNote {
  if (typeof raw !== 'object' || raw === null) return { ...SAFE_DEFAULT };
  const r = raw as Record<string, unknown>;
  return {
    topic: typeof r['topic'] === 'string' ? r['topic'] : '',
    teaches: typeof r['teaches'] === 'string' ? r['teaches'] : '',
    keyVisual: typeof r['keyVisual'] === 'string' ? r['keyVisual'] : '',
    contentLevel: r['contentLevel'] === 'substantive' ? 'substantive' : 'low',
  };
}

export async function describeSlide(png: Buffer): Promise<SlideNote> {
  const baseUrl = (process.env.LOCAL_BASE_URL ?? 'http://localhost:8000/v1').replace(/\/$/, '');
  const apiKey = process.env.LOCAL_API_KEY ?? '';
  // Model + soft-token budget from the consolidated vision registry. Default
  // gemma-4-12B-it-qat-4bit @ 560 (describe-bench winner) — NOT the old E4B-8bit,
  // whose broken-for-vision MLX conversion silently dropped the image (slide
  // vision was a no-op). The 560 budget needs the patched omlx (resolution knob).
  const { model, budget } = visionModel('slideNote');

  const dataUri = `data:image/png;base64,${png.toString('base64')}`;

  const body = JSON.stringify({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: INSTRUCTION },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 300,
    temperature: 0.2,
    // Resolution knob (patched omlx) + repetition penalty — matches the bench
    // config; the penalty prevents gemma's greedy-decode loop on dense slides,
    // the budget raises effective resolution. Both ignored by non-gemma models.
    ...(budget ? { vision_soft_tokens_per_image: budget } : {}),
    repetition_penalty: 1.3,
  });

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[slide-vision] non-OK response: ${res.status} ${res.statusText}`);
      return { ...SAFE_DEFAULT };
    }

    let outer: unknown;
    try {
      outer = await res.json();
    } catch {
      console.warn('[slide-vision] response body is not valid JSON');
      return { ...SAFE_DEFAULT };
    }

    const content =
      (outer as { choices?: Array<{ message?: { content?: string } }> })
        ?.choices?.[0]?.message?.content ?? '';

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('[slide-vision] message.content is not valid JSON:', content.slice(0, 100));
      return { ...SAFE_DEFAULT };
    }

    return coerce(parsed);
  } catch (err) {
    console.warn('[slide-vision] fetch failed:', err instanceof Error ? err.message : err);
    return { ...SAFE_DEFAULT };
  }
}
