/**
 * Per-slide vision note via a local omlx vision model (gemma-4).
 *
 * Uses the OpenAI chat-completions protocol at LOCAL_BASE_URL with an
 * image_url data-URI part. On any failure (network, non-OK status, bad JSON,
 * parse error) returns a safe default so the calling worker can silently skip
 * uninformative slides without aborting the ingestion pipeline.
 */

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
  // gemma-4-12B-it-qat-4bit, NOT the E4B-8bit this used to default to: the E4B
  // MLX conversion is broken for vision (126-param mismatch in mlx-vlm → omlx
  // loads it non-strictly and it silently drops the image, returning "I cannot
  // see the image"), so middle-tier slide-vision was a no-op. 12B-qat-4bit
  // ingests the image and returns substantive notes, ~7GB, ~3s warm (validated
  // 2026-06-23 via the real describeSlide path on stock omlx). E4B stays on disk
  // — it's voicelab's audio/perception model, just not vision-capable.
  const model = process.env.SLIDE_VISION_MODEL?.trim() || 'gemma-4-12B-it-qat-4bit';

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
