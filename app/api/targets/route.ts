import { NextResponse } from 'next/server';
import { listTargets } from '@/lib/db/career-targets-queries';

export async function GET(): Promise<Response> {
  try {
    const targets = await listTargets();
    return NextResponse.json(targets);
  } catch (err) {
    console.error('GET /api/targets failed', err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
