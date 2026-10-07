/**
 * `true` iff `req`'s Content-Type is exactly `application/json` (an
 * optional `; charset=...` param is fine). Used as a CSRF defense (fix
 * round 1, M2) on the state-changing /api/admin/access routes: a plain HTML
 * form can only set `enctype` to `multipart/form-data`,
 * `application/x-www-form-urlencoded`, or `text/plain` — never
 * `application/json` — so requiring this content type blocks the simple
 * cross-site form-POST vector. `Request.json()` itself ignores the
 * declared content type entirely, so this check has to be explicit and
 * separate from body parsing.
 */
export function hasJsonContentType(req: Request): boolean {
  const ct = req.headers.get('content-type') ?? '';
  return ct.toLowerCase().split(';')[0]!.trim() === 'application/json';
}
