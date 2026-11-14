import { NextResponse } from 'next/server';
import type { Grant } from '@/lib/auth/authorize';
import { authorizeRequest, forbidden } from '@/lib/auth/route-auth';
import { getWhatIf, type WhatIfRow } from '@/lib/db/what-if-queries';
import { canManageWhatIf, canReadWhatIf } from './ownership';

const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 });

/**
 * Shared check for every what-if route: the access table (via authorizeRequest, so
 * routes outside the middleware are covered too), then that the what-if exists under
 * this course, then ownership. An unfinished what-if the caller may not read is a 404,
 * not a 403, so its existence is not revealed.
 */
export async function guardWhatIf(
  req: Request, code: string, id: string, need: 'read' | 'manage',
): Promise<{ grant: Grant; whatIf: WhatIfRow; response?: undefined } | { response: Response }> {
  const auth = await authorizeRequest(req);
  if (auth.response) return { response: auth.response };
  const whatIf = await getWhatIf(id);
  if (!whatIf || whatIf.courseCode !== code) return { response: notFound() };
  if (need === 'manage') {
    if (!canManageWhatIf(auth.grant, whatIf)) return { response: forbidden() };
  } else if (!canReadWhatIf(auth.grant, whatIf)) {
    return { response: notFound() };
  }
  return { grant: auth.grant, whatIf };
}
