import { NextResponse } from 'next/server';

export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    aiProvider: process.env.AI_PROVIDER ?? 'openai',
    aiModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
    time: new Date().toISOString(),
  });
}
