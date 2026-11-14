import { NextResponse } from 'next/server';
import { listWhatIfMessages } from '@/lib/db/what-if-queries';
import { guardWhatIf } from '@/lib/what-if/route-guard';

interface Ctx { params: Promise<{ code: string; id: string }> }

/** GET /api/explore/[code]/what-ifs/[id]/messages → { messages } (owner or admin only). */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const { code: rawCode, id } = await params;
  const g = await guardWhatIf(req, decodeURIComponent(rawCode), id, 'manage');
  if (g.response) return g.response;
  return NextResponse.json({ messages: await listWhatIfMessages(id) });
}
