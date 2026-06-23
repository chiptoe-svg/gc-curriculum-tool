/**
 * Bearer-token check for agent-facing endpoints — the wiki MCP server at
 * /api/mcp (`WIKI_MCP_TOKEN`) and the spine-search endpoint at
 * /api/curriculum/search (`CURRICULUM_SEARCH_TOKEN`, used by voicelab).
 *
 * Deliberately separate from faculty Basic Auth (`lib/auth/basic-auth.ts`):
 * agents present a machine token, never the human faculty credential, so the
 * two can be rotated/revoked independently and an agent token leak never
 * exposes the faculty password.
 *
 * FAIL-CLOSED: when `expected` is empty/unset this ALWAYS returns false. An
 * endpoint guarded by this must never silently open up just because its token
 * env var (`WIKI_MCP_TOKEN`) is missing — the same fail-closed discipline the
 * provider layer uses for `AI_PROVIDER`.
 */

import { timingSafeEqual } from 'node:crypto';

export function authorizedForBearer(
  authorizationHeader: string | null | undefined,
  expected: string | undefined | null,
): boolean {
  if (!expected) return false; // fail-closed: no token configured ⇒ deny all
  const header = authorizationHeader ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return false;
  const token = header.slice(7).trim();
  if (!token) return false;
  return constantTimeEqual(token, expected);
}

/**
 * Constant-time string compare. Length is compared first (a length mismatch
 * short-circuits) — this leaks only the token's length, which is not secret
 * for a random fixed-width token; the byte content comparison is timing-safe.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
