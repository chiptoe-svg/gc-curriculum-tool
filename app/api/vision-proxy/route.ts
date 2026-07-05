import { NextResponse, type NextRequest } from 'next/server';
import { visionOffloadConfig } from '@/lib/ai/vision-offload';
import { recordRealSuccess, recordRealFallback } from '@/lib/ai/vision-offload-health';
import { canonicalizeAdaptive } from '@/lib/ai/vision-canonicalize';
import { withVisionSlot } from '@/lib/ai/vision-offload-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Vision proxy for Docling-serve picture captioning.
 *
 * Docling calls the VLM endpoint (`DOCLING_VLM_URL`) itself, so it can't get the
 * DGX-primary / omlx-fallback behavior our code paths have. Pointing DOCLING_VLM_URL
 * at THIS route gives it exactly that: forward each caption request to the DGX
 * (VISION_OFFLOAD) and, on any failure, fall back to the local omlx — the "DGX is
 * the primary carrier, omlx handles it if necessary" split, without Docling knowing.
 *
 * Captions always try the DGX first (no size threshold — they ARE the offloaded
 * caption load). Bearer-gated by DOCLING_VLM_API_KEY; excluded from faculty Basic
 * Auth in the middleware matcher (self-authenticating, like /api/transcribe).
 */

/**
 * Find the first data-URL image in a chat-completions body and return its decoded
 * bytes plus a setter that swaps the URL in place (mutates the body's messages).
 */
function extractImage(body: Record<string, unknown>): { buffer: Buffer; set: (dataUrl: string) => void } | null {
  const messages = body['messages'];
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    const content = (m as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: string; image_url?: { url?: string } };
      if (p?.type === 'image_url' && typeof p.image_url?.url === 'string' && p.image_url.url.startsWith('data:')) {
        const b64 = p.image_url.url.split(',', 2)[1] ?? '';
        return {
          buffer: Buffer.from(b64, 'base64'),
          set: (dataUrl: string) => { p.image_url!.url = dataUrl; },
        };
      }
    }
  }
  return null;
}

async function forward(url: string, apiKey: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  // Require the bearer to match DOCLING_VLM_API_KEY when it's set (fail-open only
  // when no token is configured — the route is still self-hosted + LAN-internal).
  const expected = process.env.DOCLING_VLM_API_KEY?.trim();
  if (expected) {
    const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (got !== expected) return new NextResponse('Unauthorized', { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse('Bad JSON', { status: 400 });
  }

  const off = visionOffloadConfig();
  const localBase = (process.env.LOCAL_BASE_URL ?? 'http://localhost:8000/v1').replace(/\/$/, '');
  const localModel = process.env.DOCLING_VLM_MODEL ?? 'gemma-4-12B-it-qat-4bit';
  const localKey = process.env.LOCAL_API_KEY ?? '';

  // Canonicalize the figure crop adaptively (ride native, cap 1120) and pick the
  // budget tier. Swaps the image in-place; both backends then get the canonical
  // pixels + the same B (DGX max_soft_tokens / omlx vision_soft_tokens_per_image).
  let budget: number | null = null;
  const img = extractImage(body);
  if (img) {
    try {
      const canon = await canonicalizeAdaptive(img.buffer);
      img.set(`data:image/png;base64,${canon.png.toString('base64')}`);
      budget = canon.budget;
    } catch (e) {
      console.warn('[vision-proxy] canonicalize failed; forwarding original crop:', (e as Error).message);
    }
  }

  // Phase 1 — DGX (override model; drop the omlx knob; send max_soft_tokens=B).
  if (off) {
    const dgxBody: Record<string, unknown> = { ...body, model: off.model };
    delete dgxBody['vision_soft_tokens_per_image'];
    delete dgxBody['chat_template_kwargs'];
    if (budget) dgxBody['max_soft_tokens'] = budget;
    try {
      // Weighted DGX gate (shared with OCR + slides) — keeps in-flight ≤ 8 slots.
      const res = await withVisionSlot(budget ?? 560, () =>
        forward(`${off.baseURL.replace(/\/$/, '')}/chat/completions`, off.apiKey, dgxBody),
      );
      if (res.ok) {
        recordRealSuccess();
        return new NextResponse(await res.text(), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      recordRealFallback(`caption DGX HTTP ${res.status}`);
      console.warn(`[vision-proxy] DGX non-OK ${res.status} at ${off.baseURL}; falling back to omlx`);
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      recordRealFallback(`caption DGX error: ${cause?.code ?? (e as Error).message}`);
      console.warn(`[vision-proxy] DGX error at ${off.baseURL}; falling back to omlx:`, (e as Error).message, '| cause:', cause?.code ?? cause?.message ?? '');
    }
  }

  // Phase 2 — local omlx fallback (Docling's configured caption model).
  const localBody: Record<string, unknown> = { ...body, model: localModel };
  if (budget) localBody['vision_soft_tokens_per_image'] = budget;
  const res = await forward(`${localBase}/chat/completions`, localKey, localBody);
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
