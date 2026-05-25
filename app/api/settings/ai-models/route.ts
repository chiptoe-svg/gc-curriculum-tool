import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import {
  AI_FUNCTION_IDS,
  DEFAULT_TIERS,
  FUNCTION_DESCRIPTIONS,
  FUNCTION_LABELS,
  TIER_TO_MODEL,
  listAllFunctionSettings,
  upsertFunctionSetting,
  resetFunctionSetting,
  type AIFunctionId,
  type ModelTier,
} from '@/lib/ai/function-settings';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

// GET /api/settings/ai-models?slug=...
// Returns all function settings + the tier→model map + the per-function
// labels/descriptions. The UI uses this single payload to render the form.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const settings = await listAllFunctionSettings();
  return NextResponse.json({
    settings,
    tierToModel: TIER_TO_MODEL,
    defaults: DEFAULT_TIERS,
    labels: FUNCTION_LABELS,
    descriptions: FUNCTION_DESCRIPTIONS,
    functionIds: AI_FUNCTION_IDS,
  });
}

// PUT /api/settings/ai-models?slug=...
// Body: { functionId, tier, customModel? }
// Upserts a setting row. tier='custom' requires customModel.
export async function PUT(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const functionId = body.functionId as string;
  const tier = body.tier as string;
  const customModel = typeof body.customModel === 'string' ? body.customModel : null;

  if (!AI_FUNCTION_IDS.includes(functionId as AIFunctionId)) {
    return NextResponse.json({ error: `unknown functionId: ${functionId}` }, { status: 400 });
  }
  if (!['light', 'default', 'heavy', 'custom'].includes(tier)) {
    return NextResponse.json({ error: `invalid tier: ${tier}` }, { status: 400 });
  }
  if (tier === 'custom' && (!customModel || !customModel.trim())) {
    return NextResponse.json({ error: 'customModel is required when tier is "custom"' }, { status: 400 });
  }

  await upsertFunctionSetting({
    functionId: functionId as AIFunctionId,
    tier: tier as ModelTier,
    customModel,
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/settings/ai-models?slug=...&functionId=...
// Removes a stored override so the function falls back to its compiled
// default tier.
export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const functionId = url.searchParams.get('functionId') ?? '';
  if (!AI_FUNCTION_IDS.includes(functionId as AIFunctionId)) {
    return NextResponse.json({ error: `unknown functionId: ${functionId}` }, { status: 400 });
  }
  await resetFunctionSetting(functionId as AIFunctionId);
  return NextResponse.json({ ok: true });
}
