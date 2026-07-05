/**
 * Per-slide vision note via a local omlx vision model (gemma-4).
 *
 * Uses the OpenAI chat-completions protocol at LOCAL_BASE_URL with an
 * image_url data-URI part. On any failure (network, non-OK status, bad JSON,
 * parse error) returns a safe default so the calling worker can silently skip
 * uninformative slides without aborting the ingestion pipeline.
 */

import { visionModel } from '@/lib/ai/vision-models';
import { visionOffloadConfig, twoPhaseOffload, shouldOffload } from '@/lib/ai/vision-offload';
import { recordRealFallback } from '@/lib/ai/vision-offload-health';
import { canonicalize } from '@/lib/ai/vision-canonicalize';
import { withVisionSlot } from '@/lib/ai/vision-offload-gate';

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

interface SlideBackend {
  baseUrl: string;
  apiKey: string;
  model: string;
  budget?: number;
  offload: boolean;
}

/** Local omlx backend (gemma-4-12B @ knob 560) from the vision registry + env. */
function localSlideBackend(): SlideBackend {
  const { model, budget } = visionModel('slideNote');
  return {
    baseUrl: (process.env.LOCAL_BASE_URL ?? 'http://localhost:8000/v1').replace(/\/$/, ''),
    apiKey: process.env.LOCAL_API_KEY ?? '',
    model,
    budget,
    offload: false,
  };
}

/**
 * One slide against one backend. THROWS on transport failure (non-OK status,
 * timeout, network) so a batch orchestrator can fall back; returns a note
 * (possibly SAFE_DEFAULT) on any 200 response. The omlx resolution knob is sent
 * ONLY to the local backend — SGLang (the DGX) doesn't know it.
 */
async function describeSlideOn(png: Buffer, be: SlideBackend): Promise<SlideNote> {
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  const body = JSON.stringify({
    model: be.model,
    messages: [
      { role: 'user', content: [
        { type: 'text', text: INSTRUCTION },
        { type: 'image_url', image_url: { url: dataUri } },
      ] },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 300,
    temperature: 0.2,
    // Same budget B to both backends (image is canonical): omlx honors it via the
    // resolution knob; the DGX router uses max_soft_tokens as its budget/ceiling.
    ...(be.budget
      ? be.offload
        ? { max_soft_tokens: be.budget }
        : { vision_soft_tokens_per_image: be.budget }
      : {}),
    repetition_penalty: 1.3,
  });

  const res = await fetch(`${be.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${be.apiKey}` },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`slide-vision ${be.offload ? 'offload' : 'local'} non-OK: ${res.status} ${res.statusText}`);
  }

  let outer: unknown;
  try {
    outer = await res.json();
  } catch {
    console.warn('[slide-vision] response body is not valid JSON');
    return { ...SAFE_DEFAULT };
  }
  const content =
    (outer as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.warn('[slide-vision] message.content is not valid JSON:', content.slice(0, 100));
    return { ...SAFE_DEFAULT };
  }
  return coerce(parsed);
}

/**
 * A single slide — LOCAL only, fully graceful (never throws; SAFE_DEFAULT on any
 * failure). Kept for single-slide callers; batch ingestion uses describeSlides.
 */
export async function describeSlide(png: Buffer): Promise<SlideNote> {
  try {
    return await describeSlideOn(png, localSlideBackend());
  } catch (err) {
    console.warn('[slide-vision] fetch failed:', err instanceof Error ? err.message : err);
    return { ...SAFE_DEFAULT };
  }
}

/**
 * A batch of slides — OFFLOAD to the DGX (VISION_OFFLOAD_*) at high concurrency
 * with LOCAL fallback at low concurrency (two-phase; see vision-offload.ts). The
 * "DGX = all vision" path: the DGX 26B is higher-quality and much faster under
 * load than the local dense 12B for slide description. Each slide is graceful
 * (SAFE_DEFAULT on failure), preserving skip-uninformative-slides behavior.
 */
export async function describeSlides(pngs: Buffer[]): Promise<SlideNote[]> {
  const local = localSlideBackend();
  const slideBudget = local.budget ?? 560;
  const off = visionOffloadConfig();
  // Small slide sets stay local (fast); shunt big decks to the DGX (keeps the box
  // free for v2v). See shouldOffload / VISION_OFFLOAD_MIN_ITEMS.
  const offBackend: SlideBackend | null = shouldOffload(off, pngs.length) && off
    ? { baseUrl: off.baseURL.replace(/\/$/, ''), apiKey: off.apiKey, model: off.model, budget: slideBudget, offload: true }
    : null;
  // Canonical render each slide at the slideNote budget so both backends see the
  // identical resolution (DGX max_soft_tokens / omlx knob = the same B).
  const canon = await Promise.all(pngs.map((p) => canonicalize(p, slideBudget)));
  return twoPhaseOffload<SlideNote>(canon.length, {
    // Weighted DGX gate (shared with OCR + captions) — keeps in-flight ≤ 8 slots.
    offload: offBackend ? (i) => withVisionSlot(slideBudget, () => describeSlideOn(canon[i]!.png, offBackend)) : null,
    local: async (i) => {
      try {
        return await describeSlideOn(canon[i]!.png, local);
      } catch (err) {
        console.warn('[slide-vision] local fallback failed:', err instanceof Error ? err.message : err);
        return { ...SAFE_DEFAULT };
      }
    },
    offloadConcurrency: off?.concurrency ?? 12,
    localConcurrency: 4, // slides are lighter than OCR; matches the prior mapWithConcurrency(4)
    onFallback: (n, total, err) => {
      recordRealFallback(`slides ${n}/${total}: ${err}`);
      console.warn(`[slide-vision] offload: ${n}/${total} slide(s) fell back to local (first error: ${err})`);
    },
  });
}
