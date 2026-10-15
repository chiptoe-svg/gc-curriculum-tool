import { NextResponse } from 'next/server';

// Shared by the /api/admin/bundles/* routes (P2 bundle review, spec
// 2026-10-13-bundle-membership-p2-design.md §5). Not a route: Next only
// serves files named route.ts.
export const NO_STORE = { 'Cache-Control': 'no-store' };
export const ID_RE = /^[a-z0-9-]{1,80}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ONET_RELEASE = '31.0';
export const POSITIONS = new Set(['core', 'related', 'fringe']);

export function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export function jsonOk(body: unknown): Response {
  return NextResponse.json(body, { headers: NO_STORE });
}

/** Body of a JSON POST, or {} when it does not parse to an object. Call only after hasJsonContentType. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const b: unknown = await req.json().catch(() => ({}));
  return b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

export function bodySlug(body: Record<string, unknown>): string {
  return typeof body.slug === 'string' ? body.slug : '';
}
