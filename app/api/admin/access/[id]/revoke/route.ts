import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { revokeGrant, isValidGrantId } from '@/lib/auth/grant-admin';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST /api/admin/access/[id]/revoke — sets revoked_at. Idempotent. Unlike
// PATCH/reissue, revoking a CLI admin grant is generally allowed (killing
// access is usually safe; only re-minting/editing one is refused — see L1
// in grant-admin.ts) — EXCEPT the last live one: revokeGrant refuses that
// specific case (F3, security review 2026-10-07) so the owner can't lock
// themselves out of every /admin surface from this panel. Recovery from
// that state is CLI-only: `pnpm access:grant "<name> (admin)" --courses "*"
// --can capture,create,admin --no-expiry` (see docs/STATE.md).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Content-type gate before auth/parsing (fix round 1, M2) — see route.ts.
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: 'content-type must be application/json' }, { status: 415, headers: NO_STORE });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  if (!isValidGrantId(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 400, headers: NO_STORE });
  }

  const result = await revokeGrant(id);
  if (result === 'not-found') return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
  if (result === 'last-admin') {
    return NextResponse.json(
      { error: 'This is the last admin link — create another admin link from the command line first' },
      { status: 409, headers: NO_STORE },
    );
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
