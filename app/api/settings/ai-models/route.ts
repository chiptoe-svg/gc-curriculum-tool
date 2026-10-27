import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import {
  AI_FUNCTION_IDS,
  DEFAULT_ROLES,
  FUNCTION_DESCRIPTIONS,
  FUNCTION_LABELS,
  listAllFunctionSettings,
  upsertFunctionSetting,
  resetFunctionSetting,
  type AIFunctionId,
  type StoredTier,
} from '@/lib/ai/function-settings';
import { MODEL_ROLES, ROLE_SETTINGS } from '@/lib/ai/models';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

// GET /api/settings/ai-models?slug=...
// Returns all function settings + the role settings + the per-function
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
    roles: ROLE_SETTINGS,
    defaults: DEFAULT_ROLES,
    labels: FUNCTION_LABELS,
    descriptions: FUNCTION_DESCRIPTIONS,
    functionIds: AI_FUNCTION_IDS,
  });
}

// PUT /api/settings/ai-models?slug=...
// Body: { functionId, tier: judge|converse|write|extract|custom, customModel? }
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
  // Old tier names (light/default/heavy) are read but no longer written.
  if (![...MODEL_ROLES, 'custom'].includes(tier)) {
    return NextResponse.json({ error: `invalid tier: ${tier}` }, { status: 400 });
  }
  if (tier === 'custom' && (!customModel || !customModel.trim())) {
    return NextResponse.json({ error: 'customModel is required when tier is "custom"' }, { status: 400 });
  }

  await upsertFunctionSetting({
    functionId: functionId as AIFunctionId,
    tier: tier as StoredTier,
    customModel,
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/settings/ai-models?slug=...&functionId=...
// Removes a stored override so the function falls back to its compiled
// role.
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
