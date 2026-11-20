import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { DEFAULT_RERANK_MODEL } from '@/lib/ai/rerank';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { getRerankOverride, rerankEnabledNow, setRerankOverride } from '@/lib/settings/app-settings';

// GET/PUT /api/settings/search?slug=… — the reranker override (spec 2026-11-20-settings-evidence).
// PUT is admin-only: it is not listed in lib/auth/authorize.ts classify(), so it falls to 'admin'.

async function guard(req: Request): Promise<Response | null> {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  return null;
}

async function state() {
  return {
    rerank: {
      override: await getRerankOverride(),
      effective: await rerankEnabledNow(),
      model: process.env.RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL,
    },
    embedding: { model: DEFAULT_EMBEDDING_MODEL },
  };
}

export async function GET(req: Request): Promise<Response> {
  const denied = await guard(req);
  if (denied) return denied;
  return NextResponse.json(await state());
}

export async function PUT(req: Request): Promise<Response> {
  const denied = await guard(req);
  if (denied) return denied;
  let body: { rerank?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const v = body.rerank;
  if (!(v === 'on' || v === 'off' || v === null)) {
    return NextResponse.json({ error: 'rerank must be "on", "off" or null (follow the server default)' }, { status: 400 });
  }
  await setRerankOverride(v);
  return NextResponse.json(await state());
}
