import { NextResponse } from 'next/server';
import type { Grant } from '@/lib/auth/authorize';
import { authorizeRequest, forbidden } from '@/lib/auth/route-auth';
import { isCrossSiteRequest } from '@/lib/auth/cross-site';
import { getWhatIf, type WhatIfRow } from '@/lib/db/what-if-queries';
import { canManageWhatIf, canReadWhatIf } from './ownership';

export const SKILLS_ONLY_MESSAGE = 'This version was saved from a cluster and holds skills only.';
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shared check for every what-if route, in this order:
 *  1. authorizeRequest: the access table (covers routes outside the middleware); its 401/403 pass through.
 *  2. For methods other than GET/HEAD, the cross-site test (the middleware's, copied), 403 `cross_origin_blocked`.
 *  3. `id` must be a uuid, else 404 (no database query).
 *  4. The what-if must exist and belong to `code`, else 404.
 *  5. Not readable by this grant (unfinished and not the owner or an admin): 404, so existence is not revealed.
 *  6. need 'manage' and not a manager: 403.
 *  7. `leadsToModel` on a skills-only what-if: 409.
 * `code` must be the decoded course code exactly as stored: the guard compares exactly, so callers pass
 * Next's decoded `params.code` unchanged (do not normalize or upper-case it).
 */
export async function guardWhatIf(
  req: Request, code: string, id: string, need: 'read' | 'manage', opts: { leadsToModel?: boolean } = {},
): Promise<{ grant: Grant; whatIf: WhatIfRow; response?: undefined } | { response: Response }> {
  const auth = await authorizeRequest(req);
  if (auth.response) return { response: auth.response };
  if (!['GET', 'HEAD'].includes(req.method.toUpperCase()) && isCrossSiteRequest(req)) {
    return {
      response: NextResponse.json(
        { error: 'cross_origin_blocked', message: 'This request looks cross-site; admin changes must come from the app itself.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }
  if (!UUID.test(id)) return { response: notFound() };
  const whatIf = await getWhatIf(id);
  if (!whatIf || whatIf.courseCode !== code) return { response: notFound() };
  if (!canReadWhatIf(auth.grant, whatIf)) return { response: notFound() };
  if (need === 'manage' && !canManageWhatIf(auth.grant, whatIf)) return { response: forbidden() };
  // A skills-only what-if (saved from a cluster) has no conversation or page: nothing that reaches a model may run on it.
  if (opts.leadsToModel && whatIf.skills && !whatIf.profile) {
    return { response: NextResponse.json({ error: SKILLS_ONLY_MESSAGE }, { status: 409 }) };
  }
  return { grant: auth.grant, whatIf };
}
