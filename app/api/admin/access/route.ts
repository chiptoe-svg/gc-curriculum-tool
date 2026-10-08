import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { listCourses } from '@/lib/db/courses-queries';
import {
  createGrant,
  listGrantsForAdmin,
  validateLabel,
  validateEmail,
  validateExpiresAt,
  resolveScope,
  buildCan,
  buildAccessLink,
} from '@/lib/auth/grant-admin';

// Faculty access panel (spec: docs/superpowers/specs/2026-10-07-faculty-access-panel-design.md).
// Auth: two factors, like every /api/admin/* route — (1) the middleware grant
// gate (lib/auth/gate.ts: the request's grant must pass authorize(), i.e. an
// admin-capable personal link) is the primary gate; (2) checkAdminAuth is the
// in-route second factor (tests/api/admin-routes-gated.test.ts asserts every
// admin route enforces it). Slug goes in the query (GET) / body (POST) — NEVER
// an Authorization: Bearer header, which would override the browser's
// automatic Basic Auth (see the comment in app/admin/SandboxGrantsPanel.tsx).
// Every response carries Cache-Control: no-store (the token appears here only).

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const grants = await listGrantsForAdmin();
  return NextResponse.json({ grants }, { headers: NO_STORE });
}

// POST body: { label, email, courses: string[] | '*', canCreate: boolean, expiresAt: string | null, slug }
export async function POST(req: Request): Promise<Response> {
  // Content-type gate before auth/parsing (fix round 1, M2) — a plain HTML
  // form can never set this content type, so this alone blocks the
  // simple-form CSRF vector regardless of cached Basic Auth credentials.
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: 'content-type must be application/json' }, { status: 415, headers: NO_STORE });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const labelR = validateLabel(body.label);
  if ('error' in labelR) return NextResponse.json({ error: labelR.error }, { status: 400, headers: NO_STORE });

  const emailR = validateEmail(body.email);
  if ('error' in emailR) return NextResponse.json({ error: emailR.error }, { status: 400, headers: NO_STORE });

  const known = (await listCourses()).map((c) => c.code);
  const scopeR = resolveScope(body.courses, known);
  if ('error' in scopeR) return NextResponse.json({ error: scopeR.error }, { status: 400, headers: NO_STORE });

  const expiresR = validateExpiresAt(body.expiresAt);
  if ('error' in expiresR) return NextResponse.json({ error: expiresR.error }, { status: 400, headers: NO_STORE });

  // `can` is built here, never from the body — see grant-admin.ts: the panel
  // cannot grant 'admin' because nothing passes a user-supplied `can` through.
  const can = buildCan(body.canCreate === true);

  const minted = await createGrant({ label: labelR.label, email: emailR.email, scope: scopeR.scope, can, expiresAt: expiresR.expiresAt });
  const { token, ...grant } = minted;
  const link = buildAccessLink(token, process.env.PUBLIC_HTTPS_ORIGIN?.trim() || undefined);
  return NextResponse.json({ grant, link }, { headers: NO_STORE });
}
