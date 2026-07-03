import { NextResponse } from 'next/server';
import { getOffloadHealthSnapshot } from '@/lib/ai/vision-offload-health';

export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    aiProvider: process.env.AI_PROVIDER ?? 'openai',
    aiModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
    // Vision-offload canary — `down` here means DGX offload is failing and vision
    // is silently on the slower/lower-quality local fallback. See lib/ai/vision-offload-health.ts.
    visionOffload: getOffloadHealthSnapshot(),
    time: new Date().toISOString(),
  });
}
