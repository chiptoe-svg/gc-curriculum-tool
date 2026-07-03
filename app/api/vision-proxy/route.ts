import { NextResponse, type NextRequest } from 'next/server';
import { visionOffloadConfig } from '@/lib/ai/vision-offload';

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

  // Phase 1 — DGX (override model; drop omlx-only params SGLang doesn't know).
  if (off) {
    const dgxBody: Record<string, unknown> = { ...body, model: off.model };
    delete dgxBody['vision_soft_tokens_per_image'];
    delete dgxBody['chat_template_kwargs'];
    try {
      const res = await forward(`${off.baseURL.replace(/\/$/, '')}/chat/completions`, off.apiKey, dgxBody);
      if (res.ok) {
        return new NextResponse(await res.text(), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      console.warn(`[vision-proxy] DGX non-OK ${res.status} at ${off.baseURL}; falling back to omlx`);
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      console.warn(`[vision-proxy] DGX error at ${off.baseURL}; falling back to omlx:`, (e as Error).message, '| cause:', cause?.code ?? cause?.message ?? '');
    }
  }

  // Phase 2 — local omlx fallback (Docling's configured caption model).
  const localBody: Record<string, unknown> = { ...body, model: localModel };
  const res = await forward(`${localBase}/chat/completions`, localKey, localBody);
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
