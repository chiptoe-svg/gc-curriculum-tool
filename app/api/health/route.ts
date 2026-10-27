import { NextResponse } from 'next/server';
import { getOffloadHealthSnapshot } from '@/lib/ai/vision-offload-health';
import { MODEL_ROLES, ROLE_SETTINGS } from '@/lib/ai/models';

export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    aiProvider: process.env.AI_PROVIDER ?? 'openai',
    // Role → model and effort; per-function choices are on /settings.
    aiRoles: Object.fromEntries(MODEL_ROLES.map(r => [r, { model: ROLE_SETTINGS[r].model, effort: ROLE_SETTINGS[r].effort ?? null }])),
    // Vision-offload canary — `down` here means DGX offload is failing and vision
    // is silently on the slower/lower-quality local fallback. See lib/ai/vision-offload-health.ts.
    visionOffload: getOffloadHealthSnapshot(),
    time: new Date().toISOString(),
  });
}
