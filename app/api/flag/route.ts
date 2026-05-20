import { NextResponse } from 'next/server';
import { z } from 'zod';
import { insertFlag } from '@/lib/db/queries';

const flagSchema = z.object({
  runId: z.string().uuid(),
  flagType: z.enum(['coverage', 'prerequisite_gap', 'kud_draft', 'target_chain_coverage', 'target_chain_scaffolding']),
  target: z.string().min(1),
  note: z.string().min(1).max(2000),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = flagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await insertFlag(parsed.data);
  return NextResponse.json(result);
}
