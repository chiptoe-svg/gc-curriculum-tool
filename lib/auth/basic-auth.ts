/**
 * Faculty Basic Auth helpers — Phase 2 stopgap.
 *
 * The local Mac deploy binds Next.js to 0.0.0.0 so other GC faculty on
 * Clemson LAN can reach it. The faculty surfaces (/capture, /explore,
 * /program, /admin, /settings, their /api/* counterparts) have no
 * authentication of their own; we gate them in middleware with HTTP
 * Basic Auth as a quick "not anyone on the LAN can poke this" measure.
 *
 * Real per-user auth (magic-link / SSO) is deferred to a later
 * deployment-planning phase — see
 * docs/superpowers/plans/2026-05-25-phase2-hybrid-deploy.md.
 *
 * The Vercel deploy leaves FACULTY_BASIC_AUTH unset → these helpers
 * are no-ops there (the middleware skips the gate entirely). Public
 * preview / partner routes are excluded by `requiresBasicAuth`
 * regardless of env var, since they have their own auth model.
 */

/** Paths whose prefixes are intentionally public or self-authenticating. */
const PUBLIC_PREFIXES = [
  '/partners',
  '/api/partners',
  // Public read-only surfaces. The HTTP landing at "/" lists every
  // course; "/view/[code]" renders the latest captured profile read-only.
  // Both are intentionally reachable by anyone on the LAN — the value
  // is "transparent curriculum, anyone can read; only faculty can edit."
  // Edit pages link to the HTTPS Tailscale Funnel where Basic Auth
  // gates them.
  '/view',
  // The wiki MCP server is self-authenticating via a bearer token
  // (WIKI_MCP_TOKEN, checked in app/api/mcp/route.ts) — agents present a
  // machine token, not the faculty Basic Auth credential. Skip the Basic
  // Auth gate here; the route owns its auth.
  '/api/mcp',
  // Static public explainer page for the sibling "ask_procurement" project,
  // served from public/procurement.html. Intentionally reachable by anyone —
  // it is a high-level overview with no faculty data.
  '/procurement.html',
  // Static public questionnaire for procurement SMEs (sibling ask_procurement
  // project), plus its intake endpoint that stores the submitted answers +
  // uploaded files to disk. No faculty data; public on purpose.
  '/sme-questions.html',
  '/api/procurement-intake',
] as const;

/**
 * Returns true if the given pathname should be guarded by faculty
 * Basic Auth (assuming the env var that enables the gate is set).
 *
 * Special case: the bare home "/" path is public (it's the new landing).
 * Everything else not in PUBLIC_PREFIXES is gated.
 */
export function requiresBasicAuth(pathname: string): boolean {
  if (pathname === '/') return false;
  return !PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Returns true if the request carries an `Authorization: Basic <b64>`
 * header that decodes to exactly the expected `user:password` string.
 *
 * `expected` comes from the FACULTY_BASIC_AUTH env var — format is
 * literally `username:password` (no encoding). Comparison is exact;
 * we don't try to be clever about case or whitespace.
 */
export function authorizedForBasicAuth(
  authorizationHeader: string | null | undefined,
  expected: string,
): boolean {
  const header = authorizationHeader ?? '';
  if (!header.toLowerCase().startsWith('basic ')) return false;
  const b64 = header.slice(6).trim();
  if (!b64) return false;
  try {
    // atob() exists in the Next.js middleware runtime (Edge-compatible).
    const decoded = atob(b64);
    return decoded === expected;
  } catch {
    return false;
  }
}
