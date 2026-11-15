import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { searchCatalog } from '@/lib/builder/library';

/** GET /api/build/catalog?q=… → Clemson catalog courses the tool does not track yet. */
export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return NextResponse.json({ courses: await searchCatalog(q.slice(0, 80)) });
}
