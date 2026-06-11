/**
 * Admin-route auth — dual-accept transition (audit: admin `?slug=` hardening).
 *
 * Admin routes sit behind faculty Basic Auth (middleware, the primary gate) and
 * historically carried a second factor as a `?slug=` query param. A query-string
 * secret leaks to access logs and the `Referer` header. This helper migrates
 * that second factor to an `Authorization: Bearer` header WITHOUT a hard cutover
 * that could lock anyone out:
 *
 *   1. `Authorization: Bearer <ADMIN_TOKEN>` — the target state, a distinct
 *      rotatable admin token (timing-safe, fail-closed when unset).
 *   2. `Authorization: Bearer <slug>` — transitional: the existing slug secret
 *      carried in the header instead of the URL, so it's out of logs/Referer
 *      before a distinct ADMIN_TOKEN is even provisioned.
 *   3. Legacy `?slug=` / body slug — still accepted (logged) so no caller breaks
 *      mid-migration. Removed once every caller sends the header.
 *
 * Returns true when ANY path authenticates. Internally still gated on
 * `isValidSlug` for the slug paths, so the second-factor property is preserved
 * (the admin-routes-gated regression test asserts every route calls this).
 */

import { isValidSlug } from '@/lib/slug';
import { authorizedForBearer } from '@/lib/auth/bearer';

export function checkAdminAuth(req: Request, opts?: { slug?: string }): boolean {
  const header = req.headers.get('authorization');

  // (1) Distinct admin token, when provisioned.
  if (authorizedForBearer(header, process.env.ADMIN_TOKEN?.trim())) return true;

  // (2) Transitional: the slug secret presented in the Bearer header (keeps it
  //     out of the query string / access logs / Referer).
  if (header && header.toLowerCase().startsWith('bearer ')) {
    const presented = header.slice(7).trim();
    if (isValidSlug(presented)) return true;
  }

  // (3) Legacy fallback: ?slug= (query) or body slug. Logged so we can confirm
  //     every caller has moved to the header before removing this path.
  let slug = opts?.slug;
  if (slug === undefined) {
    try {
      slug = new URL(req.url).searchParams.get('slug') ?? '';
    } catch {
      slug = '';
    }
  }
  if (isValidSlug(slug)) {
    console.warn('[admin-auth] legacy query/body slug accepted — migrate caller to Authorization: Bearer');
    return true;
  }

  return false;
}
