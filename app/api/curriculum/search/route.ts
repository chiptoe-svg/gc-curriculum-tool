import { NextResponse } from 'next/server';
import { authorizedForBearer } from '@/lib/auth/bearer';
import { curriculumSearchTool } from '@/lib/ai/wiki/curriculum-search-tool';

export const dynamic = 'force-dynamic';

/**
 * GET /api/curriculum/search?q=&k=&courseCode=
 *
 * Read-only retrieval over the cross-course evidence spine (the `program`
 * Weaviate tenant). Thin Bearer-auth'd wrapper around the existing
 * `search_curriculum` tool, for non-agent clients (voicelab). Returns chunks.
 */
export async function GET(req: Request): Promise<Response> {
  if (!authorizedForBearer(req.headers.get('authorization'), process.env.CURRICULUM_SEARCH_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ error: 'missing q' }, { status: 400 });
  const kRaw = parseInt(url.searchParams.get('k') ?? '', 10);
  const k = Number.isFinite(kRaw) && kRaw > 0 ? Math.min(kRaw, 20) : 8;
  const courseCode = url.searchParams.get('courseCode') || undefined;
  try {
    const result = await curriculumSearchTool.execute({ query: q, k, courseCode });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: `search failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
