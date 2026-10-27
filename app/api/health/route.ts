import { NextResponse } from 'next/server';
import { getOffloadHealthSnapshot } from '@/lib/ai/vision-offload-health';
import { TIER_TO_MODEL } from '@/lib/ai/models';

export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    aiProvider: process.env.AI_PROVIDER ?? 'openai',
    // Tier → model map; per-function choices are on /settings.
    aiTiers: TIER_TO_MODEL,
    // Vision-offload canary — `down` here means DGX offload is failing and vision
    // is silently on the slower/lower-quality local fallback. See lib/ai/vision-offload-health.ts.
    visionOffload: getOffloadHealthSnapshot(),
    time: new Date().toISOString(),
  });
}
