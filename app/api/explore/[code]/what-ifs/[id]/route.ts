import { NextResponse } from 'next/server';
import { deleteWhatIf, renameWhatIf } from '@/lib/db/what-if-queries';
import { deleteLocal, keyFromLocalUrl } from '@/lib/storage/local-storage';
import { canManageWhatIf } from '@/lib/what-if/ownership';
import { guardWhatIf } from '@/lib/what-if/route-guard';

interface Ctx { params: Promise<{ code: string; id: string }> }

const TITLE_MAX = 120;

/** GET /api/explore/[code]/what-ifs/[id] → { whatIf, canManage } */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const { code: rawCode, id } = await params;
  const g = await guardWhatIf(req, decodeURIComponent(rawCode), id, 'read');
  if (g.response) return g.response;
  return NextResponse.json({ whatIf: g.whatIf, canManage: canManageWhatIf(g.grant, g.whatIf) });
}

/** PATCH /api/explore/[code]/what-ifs/[id]  Body: { title: string } (1-120 characters). */
export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { code: rawCode, id } = await params;
  const g = await guardWhatIf(req, decodeURIComponent(rawCode), id, 'manage');
  if (g.response) return g.response;

  let body: { title?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch { /* handled as a missing title */ }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > TITLE_MAX) {
    return NextResponse.json({ error: `A title of 1 to ${TITLE_MAX} characters is required.` }, { status: 400 });
  }
  await renameWhatIf(id, title);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/explore/[code]/what-ifs/[id] → 204. Removes the stored attachment files too. */
export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const { code: rawCode, id } = await params;
  const g = await guardWhatIf(req, decodeURIComponent(rawCode), id, 'manage');
  if (g.response) return g.response;

  const attachments = await deleteWhatIf(id);
  for (const a of attachments) {
    const key = keyFromLocalUrl(a.blobUrl);
    if (!key) continue;
    try { await deleteLocal(key); } catch { /* the record is gone; a leftover file is harmless */ }
  }
  return new Response(null, { status: 204 });
}
